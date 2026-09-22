import {
  AssignmentStatus,
  CourierApprovalStatus,
  Role,
  ShipmentStatus,
  UserStatus,
} from '../../../prisma/generated/client/enums';
import { prisma } from '../../config/database';
import { AppError, BadRequestError, ConflictError, NotFoundError } from '../../common/errors/AppError';
import type { AssignCourierInput, UnassignedListQuery } from './admin.validation';

// ─── POST /admin/shipments/:id/assign ────────────────────────────────────────

export const assignCourier = async (
  shipmentId: string,
  input: AssignCourierInput,
  adminUserId: string,
  requestId?: string,
) => {
  const { courierId } = input;

  // courierId in the request body is a USER id — resolve to CourierProfile
  const courierProfile = await prisma.courierProfile.findUnique({
    where: { userId: courierId },
    select: {
      id: true,
      userId: true,
      approvalStatus: true,
      available: true,
      serviceZones: {
        select: { zoneId: true },
      },
      user: { select: { id: true, name: true, status: true } },
    },
  });

  if (!courierProfile) {
    throw NotFoundError('Courier not found', [
      { field: 'courierId', code: 'COURIER_NOT_FOUND', message: 'No courier profile found for this user ID' },
    ]);
  }

  // Validate courier eligibility before entering the transaction
  if (courierProfile.user.status !== UserStatus.ACTIVE) {
    throw BadRequestError('Courier account is not active', [
      { code: 'COURIER_INACTIVE', message: 'The courier account must be ACTIVE' },
    ]);
  }
  if (courierProfile.approvalStatus !== CourierApprovalStatus.APPROVED) {
    throw BadRequestError('Courier is not approved', [
      { code: 'COURIER_NOT_APPROVED', message: 'Only APPROVED couriers can be assigned to shipments' },
    ]);
  }
  if (!courierProfile.available) {
    throw ConflictError('Courier is not available', [
      { code: 'COURIER_UNAVAILABLE', message: 'Courier must be available (available: true) before assignment' },
    ]);
  }

  // Pre-fetch shipment to check zones before the transaction
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: {
      id: true,
      trackingNumber: true,
      status: true,
      originZoneId: true,
      destinationZoneId: true,
      customerId: true,
    },
  });

  if (!shipment) {
    throw NotFoundError('Shipment not found');
  }

  const assignableStatuses: ShipmentStatus[] = [
    ShipmentStatus.CONFIRMED,
    ShipmentStatus.ASSIGNMENT_PENDING,
  ];

  if (!assignableStatuses.includes(shipment.status as ShipmentStatus)) {
    throw BadRequestError(
      `Shipment cannot be assigned in status "${shipment.status}"`,
      [{
        code: 'INVALID_SHIPMENT_STATUS',
        message: `Shipment must be CONFIRMED or ASSIGNMENT_PENDING. Current status: ${shipment.status}`,
      }],
    );
  }

  // Verify courier covers both origin and destination zones
  const courierZoneIds = new Set(courierProfile.serviceZones.map((z) => z.zoneId));
  const missingZones: string[] = [];
  if (shipment.originZoneId && !courierZoneIds.has(shipment.originZoneId)) {
    missingZones.push(`origin zone (${shipment.originZoneId})`);
  }
  if (shipment.destinationZoneId && !courierZoneIds.has(shipment.destinationZoneId)) {
    missingZones.push(`destination zone (${shipment.destinationZoneId})`);
  }
  if (missingZones.length > 0) {
    throw BadRequestError(
      `Courier does not cover required zones`,
      [{
        code: 'ZONE_MISMATCH',
        message: `Courier's service zones do not include: ${missingZones.join(', ')}`,
      }],
    );
  }

  // ── Transaction: all-or-nothing assignment ────────────────────────────────
  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Re-fetch shipment inside transaction for consistency
      const freshShipment = await tx.shipment.findUnique({
        where: { id: shipmentId, deletedAt: null },
        select: { id: true, status: true, trackingNumber: true, customerId: true },
      });

      if (!freshShipment || !assignableStatuses.includes(freshShipment.status as ShipmentStatus)) {
        throw new AppError('Shipment is no longer in an assignable status', 409, [
          { code: 'SHIPMENT_STATUS_CHANGED', message: 'Shipment status changed before assignment could complete' },
        ]);
      }

      // 2. Verify no active assignment already exists (double-booking guard)
      const existingAssignment = await tx.courierAssignment.findFirst({
        where: {
          shipmentId,
          status: {
            in: [
              AssignmentStatus.OFFERED,
              AssignmentStatus.ACCEPTED,
              AssignmentStatus.IN_PROGRESS,
            ] as AssignmentStatus[],
          },
          deletedAt: null,
        },
        select: { id: true },
      });

      if (existingAssignment) {
        throw new AppError('Shipment already has an active assignment', 409, [
          { code: 'ALREADY_ASSIGNED', message: 'This shipment already has an active courier assignment' },
        ]);
      }

      // 3. Create CourierAssignment
      const assignment = await tx.courierAssignment.create({
        data: {
          shipmentId,
          courierId: courierProfile.id,
          status: AssignmentStatus.OFFERED,
          acceptedAt: null,
          earnings: 0,
        },
        select: {
          id: true,
          status: true,
          createdAt: true,
        },
      });

      // 4. Mark courier as unavailable (busy)
      await tx.courierProfile.update({
        where: { id: courierProfile.id },
        data: { available: false },
      });

      // 5. Update shipment status → ASSIGNED
      await tx.shipment.update({
        where: { id: shipmentId },
        data: { status: ShipmentStatus.ASSIGNED },
      });

      // 6. TrackingEvent
      await tx.trackingEvent.create({
        data: {
          shipmentId,
          eventType: ShipmentStatus.ASSIGNED,
          notes: `Courier assigned: ${courierProfile.user.name}`,
          actorId: adminUserId,
          actorRole: Role.ADMIN,
        },
      });

      // 7. AuditLog
      await tx.auditLog.create({
        data: {
          actorId: adminUserId,
          actorRole: Role.ADMIN,
          action: 'COURIER_ASSIGNED',
          entityType: 'CourierAssignment',
          entityId: assignment.id,
          requestId: requestId ?? null,
          newValues: {
            shipmentId,
            courierId: courierProfile.id,
            assignmentId: assignment.id,
          } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      });

      // 8. Notifications: courier + customer
      await tx.notification.createMany({
        data: [
          {
            recipientId: courierProfile.userId,
            type: 'ASSIGNMENT_OFFERED',
            title: 'New delivery assignment',
            message: `You have been assigned to deliver shipment ${freshShipment.trackingNumber}. Accept or reject within 15 minutes.`,
            shipmentId,
          },
          {
            recipientId: freshShipment.customerId,
            type: 'COURIER_ASSIGNED',
            title: 'Courier assigned to your shipment',
            message: `A courier has been assigned to shipment ${freshShipment.trackingNumber} and will pick it up soon.`,
            shipmentId,
          },
        ],
      });

      return { assignment, trackingNumber: freshShipment.trackingNumber };
    });

    return {
      assignmentId: result.assignment.id,
      assignmentStatus: result.assignment.status,
      shipmentId,
      shipmentStatus: ShipmentStatus.ASSIGNED,
      trackingNumber: result.trackingNumber,
      courierId: courierProfile.userId,
      courierName: courierProfile.user.name,
      createdAt: result.assignment.createdAt,
    };
  } catch (err) {
    // Catch Prisma P2002 unique constraint (concurrent duplicate assignment attempt)
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === 'P2002'
    ) {
      throw ConflictError('Shipment already assigned', [
        { code: 'ALREADY_ASSIGNED', message: 'A concurrent request already assigned this shipment' },
      ]);
    }
    throw err;
  }
};

// ─── GET /admin/assignments/unassigned ───────────────────────────────────────

export const listUnassignedShipments = async (query: UnassignedListQuery) => {
  const { page, limit } = query;
  const skip = (page - 1) * limit;

  // Shipments that are CONFIRMED or ASSIGNMENT_PENDING with no active assignment
  const where = {
    deletedAt: null,
    status: { in: [ShipmentStatus.CONFIRMED, ShipmentStatus.ASSIGNMENT_PENDING] as ShipmentStatus[] },
    assignments: {
      none: {
        status: {
          in: [
            AssignmentStatus.OFFERED,
            AssignmentStatus.ACCEPTED,
            AssignmentStatus.IN_PROGRESS,
          ] as AssignmentStatus[],
        },
        deletedAt: null,
      },
    },
  };

  const [totalCount, shipments] = await Promise.all([
    prisma.shipment.count({ where }),
    prisma.shipment.findMany({
      where,
      select: {
        id: true,
        trackingNumber: true,
        status: true,
        serviceType: true,
        totalAmount: true,
        weightKg: true,
        createdAt: true,
        originZone: { select: { id: true, name: true, code: true } },
        destinationZone: { select: { id: true, name: true, code: true } },
        senderAddress: { select: { city: true, region: true } },
        recipientAddress: { select: { city: true, region: true } },
        customer: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' }, // oldest first — prioritise waiting shipments
      skip,
      take: limit,
    }),
  ]);

  return {
    shipments,
    meta: {
      page,
      limit,
      totalCount,
      totalPages: Math.ceil(totalCount / limit),
    },
  };
};
