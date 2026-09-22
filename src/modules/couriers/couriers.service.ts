import { AssignmentStatus, Role } from '../../../prisma/generated/client/enums';
import { prisma } from '../../config/database';
import { ConflictError, NotFoundError } from '../../common/errors/AppError';
import type { SetAvailabilityInput } from './couriers.validation';

// ─── Active assignment statuses (conflict check) ──────────────────────────────
// These are AssignmentStatus values — not ShipmentStatus.
// A courier with any of these open assignments cannot go unavailable.
const ACTIVE_ASSIGNMENT_STATUSES: AssignmentStatus[] = [
  AssignmentStatus.ACCEPTED,
  AssignmentStatus.IN_PROGRESS,
];

// ─── Prisma select ────────────────────────────────────────────────────────────

const courierProfileSelect = {
  id: true,
  userId: true,
  approvalStatus: true,
  vehicleType: true,
  vehiclePlateNumber: true,
  driverLicenseNumber: true,
  available: true,
  averageRating: true,
  totalRatings: true,
  totalDeliveries: true,
  totalEarnings: true,
  coverageRadiusKm: true,
  notes: true,
  createdAt: true,
  updatedAt: true,
  serviceZones: {
    select: {
      id: true,
      isPrimary: true,
      assignedAt: true,
      zone: {
        select: {
          id: true,
          name: true,
          code: true,
          city: true,
          region: true,
        },
      },
    },
    orderBy: { isPrimary: 'desc' as const },
  },
} as const;

// ─── GET /couriers/me ─────────────────────────────────────────────────────────

export const getCourierMe = async (userId: string) => {
  const profile = await prisma.courierProfile.findUnique({
    where: { userId },
    select: courierProfileSelect,
  });

  if (!profile) {
    throw NotFoundError('Courier profile not found', [
      { code: 'NO_COURIER_PROFILE', message: 'No courier profile is linked to your account' },
    ]);
  }

  // Earnings summary — active (non-completed/cancelled) assignments
  const earningsSummary = await prisma.courierAssignment.aggregate({
    where: {
      courierId: profile.id,
      status: AssignmentStatus.COMPLETED,
    },
    _sum: { earnings: true },
    _count: { id: true },
  });

  return {
    ...profile,
    earningsSummary: {
      totalEarnings: earningsSummary._sum.earnings ?? 0,
      completedDeliveries: earningsSummary._count.id,
    },
  };
};

// ─── PATCH /couriers/me/availability ─────────────────────────────────────────

interface SetAvailabilityOptions {
  userId: string;
  payload: SetAvailabilityInput;
  actorIp?: string;
  actorUserAgent?: string;
  requestId?: string;
}

export const setCourierAvailability = async ({
  userId,
  payload,
  actorIp,
  actorUserAgent,
  requestId,
}: SetAvailabilityOptions) => {
  const profile = await prisma.courierProfile.findUnique({
    where: { userId },
    select: { id: true, available: true },
  });

  if (!profile) {
    throw NotFoundError('Courier profile not found');
  }

  // No-op if already in the desired state — still succeeds
  if (profile.available === payload.available) {
    return getCourierMe(userId);
  }

  // ── Conflict check: refuse to go unavailable with active assignments ────────
  if (!payload.available) {
    const activeAssignments = await prisma.courierAssignment.findMany({
      where: {
        courierId: profile.id,
        status: { in: ACTIVE_ASSIGNMENT_STATUSES },
        deletedAt: null,
      },
      select: {
        id: true,
        status: true,
        shipment: {
          select: {
            trackingNumber: true,
            status: true,
          },
        },
      },
    });

    if (activeAssignments.length > 0) {
      const list = activeAssignments
        .map((a) => `${a.shipment.trackingNumber} (${a.status})`)
        .join(', ');

      throw ConflictError(
        `Cannot set unavailable: you have ${activeAssignments.length} active assignment(s)`,
        [
          {
            code: 'ACTIVE_ASSIGNMENTS',
            message: `Complete or hand off these assignments first: ${list}`,
          },
        ],
      );
    }
  }

  // ── Persist in a transaction: update + audit log ───────────────────────────
  const [updatedProfile] = await prisma.$transaction([
    prisma.courierProfile.update({
      where: { id: profile.id },
      data: { available: payload.available },
      select: courierProfileSelect,
    }),
    prisma.auditLog.create({
      data: {
        actorId: userId,
        actorRole: Role.COURIER,
        action: payload.available ? 'COURIER_SET_AVAILABLE' : 'COURIER_SET_UNAVAILABLE',
        entityType: 'CourierProfile',
        entityId: profile.id,
        ipAddress: actorIp ?? null,
        userAgent: actorUserAgent ?? null,
        requestId: requestId ?? null,
        oldValues: { available: profile.available },
        newValues: { available: payload.available },
        reason: payload.available
          ? 'Courier marked themselves as available'
          : 'Courier marked themselves as unavailable',
      },
    }),
  ]);

  // Fetch earnings summary to return the full enriched profile
  const earningsSummary = await prisma.courierAssignment.aggregate({
    where: {
      courierId: profile.id,
      status: AssignmentStatus.COMPLETED,
    },
    _sum: { earnings: true },
    _count: { id: true },
  });

  return {
    ...updatedProfile,
    earningsSummary: {
      totalEarnings: earningsSummary._sum.earnings ?? 0,
      completedDeliveries: earningsSummary._count.id,
    },
  };
};
