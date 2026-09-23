import { z } from 'zod';
import { Role, ShipmentStatus } from '../../../prisma/generated/client/enums';
import { prisma } from '../../config/database';
import { AppError, ConflictError, NotFoundError } from '../../common/errors/AppError';

// ─── Validation ───────────────────────────────────────────────────────────────

export const ratingSchema = z.object({
  stars: z
    .number({ error: 'stars must be a number' })
    .int('stars must be an integer')
    .min(1, 'stars minimum is 1')
    .max(5, 'stars maximum is 5'),
  comment: z.string().trim().max(500).optional(),
});

export type RatingInput = z.infer<typeof ratingSchema>;

// ─── POST /shipments/:id/rating ───────────────────────────────────────────────

export const createRating = async (
  shipmentId: string,
  customerId: string,
  payload: RatingInput,
  requestId?: string,
) => {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: {
      id: true,
      status: true,
      customerId: true,
      trackingNumber: true,
      assignments: {
        where: {
          status: 'COMPLETED',
          deletedAt: null,
        },
        select: { courierId: true },
        take: 1,
      },
    },
  });

  if (!shipment) throw NotFoundError('Shipment not found');

  // Ownership check
  if (shipment.customerId !== customerId) {
    throw new AppError('You can only rate your own shipments', 403, [
      { code: 'FORBIDDEN', message: 'Shipment does not belong to your account' },
    ]);
  }

  // Must be DELIVERED
  if (shipment.status !== ShipmentStatus.DELIVERED) {
    throw new AppError(
      `Cannot rate a shipment in status "${shipment.status}"`,
      409,
      [{ code: 'NOT_DELIVERED', message: 'Ratings can only be submitted for DELIVERED shipments' }],
    );
  }

  // Unique constraint: 1 rating per shipment
  const existing = await prisma.rating.findUnique({
    where: { shipmentId },
    select: { id: true },
  });
  if (existing) {
    throw ConflictError('This shipment has already been rated', [
      { code: 'DUPLICATE_RATING', message: 'Only one rating is allowed per shipment' },
    ]);
  }

  // Get courierId from completed assignment (if any)
  const courierId = shipment.assignments[0]?.courierId ?? null;

  // Resolve courierId (profile id) → userId for notification
  let courierUserId: string | null = null;
  if (courierId) {
    const cp = await prisma.courierProfile.findUnique({
      where: { id: courierId },
      select: { userId: true },
    });
    courierUserId = cp?.userId ?? null;
  }

  await prisma.$transaction(async (tx) => {
    // Create rating
    await tx.rating.create({
      data: {
        shipmentId,
        customerId,
        courierId: courierId ?? undefined,
        stars: payload.stars,
        comment: payload.comment ?? null,
      },
    });

    // Recalculate courier average rating (weighted avg)
    if (courierId) {
      const agg = await tx.rating.aggregate({
        where: { courierId },
        _avg: { stars: true },
        _count: { id: true },
      });

      await tx.courierProfile.update({
        where: { id: courierId },
        data: {
          averageRating: agg._avg.stars ?? payload.stars,
          totalRatings:  agg._count.id,
        },
      });
    }

    // AuditLog
    await tx.auditLog.create({
      data: {
        actorId: customerId,
        actorRole: Role.CUSTOMER,
        action: 'SHIPMENT_RATED',
        entityType: 'Rating',
        entityId: shipmentId,
        requestId: requestId ?? null,
        newValues: { stars: payload.stars, courierId } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      },
    });

    // Notify courier if applicable
    if (courierUserId) {
      await tx.notification.create({
        data: {
          recipientId: courierUserId,
          type: 'NEW_RATING',
          title: 'You received a new rating',
          message: `Customer rated shipment ${shipment.trackingNumber} ${payload.stars} star${payload.stars !== 1 ? 's' : ''}${payload.comment ? `: "${payload.comment}"` : ''}`,
          shipmentId,
        },
      });
    }
  });

  return {
    shipmentId,
    trackingNumber: shipment.trackingNumber,
    stars: payload.stars,
    comment: payload.comment ?? null,
  };
};
