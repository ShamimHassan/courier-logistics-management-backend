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

// ─── Pricing rules ────────────────────────────────────────────────────────────

import type {
  AuditLogQuery,
  CreatePricingRuleInput,
  ListUsersQuery,
  UpdatePricingRuleInput,
  UpdateUserRoleInput,
  UpdateUserStatusInput,
} from './admin.validation';

export const createPricingRule = async (input: CreatePricingRuleInput, adminId: string) => {
  // Bump version: find latest version for same zone/service combo
  const latest = await prisma.pricingRule.findFirst({
    where: {
      originZoneId:      input.originZoneId      ?? null,
      destinationZoneId: input.destinationZoneId ?? null,
      serviceType:       input.serviceType,
    },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  const nextVersion = (latest?.version ?? 0) + 1;

  const rule = await prisma.pricingRule.create({
    data: {
      originZoneId:        input.originZoneId        ?? null,
      destinationZoneId:   input.destinationZoneId   ?? null,
      serviceType:         input.serviceType,
      minWeightKg:         input.minWeightKg,
      maxWeightKg:         input.maxWeightKg,
      basePrice:           input.basePrice,
      weightSurchargePerKg: input.weightSurchargePerKg,
      expressFee:          input.expressFee,
      insuranceFeePercent: input.insuranceFeePercent,
      taxRatePercent:      input.taxRatePercent,
      codFeePercent:       input.codFeePercent,
      codFeeMin:           input.codFeeMin,
      version:             nextVersion,
      isActive:            true,
      effectiveFrom:       input.effectiveFrom,
      effectiveUntil:      input.effectiveUntil ?? null,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId:    adminId,
      actorRole:  Role.ADMIN,
      action:     'PRICING_RULE_CREATED',
      entityType: 'PricingRule',
      entityId:   rule.id,
      newValues:  { version: nextVersion, serviceType: input.serviceType } as any, // eslint-disable-line
    },
  });

  return rule;
};

export const updatePricingRule = async (
  ruleId: string,
  input: UpdatePricingRuleInput,
  adminId: string,
) => {
  const existing = await prisma.pricingRule.findUnique({
    where: { id: ruleId, deletedAt: null },
    select: { id: true, isActive: true, version: true },
  });
  if (!existing) throw NotFoundError('Pricing rule not found');

  const updated = await prisma.pricingRule.update({
    where: { id: ruleId },
    data: {
      ...(input.isActive         !== undefined ? { isActive:         input.isActive }         : {}),
      ...(input.effectiveUntil   !== undefined ? { effectiveUntil:   input.effectiveUntil }   : {}),
      ...(input.basePrice        !== undefined ? { basePrice:        input.basePrice }        : {}),
      ...(input.weightSurchargePerKg !== undefined ? { weightSurchargePerKg: input.weightSurchargePerKg } : {}),
      ...(input.taxRatePercent   !== undefined ? { taxRatePercent:   input.taxRatePercent }   : {}),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorId:    adminId,
      actorRole:  Role.ADMIN,
      action:     'PRICING_RULE_UPDATED',
      entityType: 'PricingRule',
      entityId:   ruleId,
      oldValues:  { isActive: existing.isActive } as any, // eslint-disable-line
      newValues:  input as any, // eslint-disable-line
    },
  });

  return updated;
};

// ─── User management ──────────────────────────────────────────────────────────

export const listAdminUsers = async (query: ListUsersQuery) => {
  const { page, limit, role, status, search } = query;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = { deletedAt: null };
  if (role)   where.role   = role;
  if (status) where.status = status;
  if (search) {
    where.OR = [
      { name:  { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [totalCount, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      select: {
        id: true, email: true, name: true, phone: true,
        role: true, status: true, profileImageUrl: true,
        lastLoginAt: true, createdAt: true,
        courierProfile: { select: { approvalStatus: true, available: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  return {
    users,
    meta: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) },
  };
};

export const updateUserStatus = async (
  userId: string,
  input: UpdateUserStatusInput,
  adminId: string,
  requestId?: string,
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    select: { id: true, status: true, email: true },
  });
  if (!user) throw NotFoundError('User not found');

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { status: input.status },
    select: { id: true, email: true, name: true, role: true, status: true },
  });

  await prisma.auditLog.create({
    data: {
      actorId:    adminId,
      actorRole:  Role.ADMIN,
      action:     input.status === UserStatus.SUSPENDED ? 'USER_SUSPENDED' : 'USER_ACTIVATED',
      entityType: 'User',
      entityId:   userId,
      requestId:  requestId ?? null,
      reason:     input.reason ?? null,
      oldValues:  { status: user.status }   as any, // eslint-disable-line
      newValues:  { status: input.status }  as any, // eslint-disable-line
    },
  });

  return updated;
};

export const updateUserRole = async (
  userId: string,
  input: UpdateUserRoleInput,
  adminId: string,
  requestId?: string,
) => {
  const user = await prisma.user.findUnique({
    where: { id: userId, deletedAt: null },
    select: { id: true, role: true, email: true },
  });
  if (!user) throw NotFoundError('User not found');

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { role: input.role },
    select: { id: true, email: true, name: true, role: true, status: true },
  });

  // If approving as COURIER, create CourierProfile if not exists
  if (input.role === Role.COURIER) {
    const existing = await prisma.courierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!existing) {
      await prisma.courierProfile.create({
        data: {
          userId,
          vehicleType:         'MOTORCYCLE',
          driverLicenseNumber: 'PENDING',
          available:            false,
        },
      });
    }
  }

  await prisma.auditLog.create({
    data: {
      actorId:    adminId,
      actorRole:  Role.ADMIN,
      action:     'USER_ROLE_CHANGED',
      entityType: 'User',
      entityId:   userId,
      requestId:  requestId ?? null,
      reason:     input.reason,
      oldValues:  { role: user.role }   as any, // eslint-disable-line
      newValues:  { role: input.role }  as any, // eslint-disable-line
    },
  });

  return updated;
};

// ─── Audit logs ───────────────────────────────────────────────────────────────

export const listAuditLogs = async (query: AuditLogQuery) => {
  const { page, limit, actorId, entityType, entityId, action, fromDate, toDate } = query;
  const skip = (page - 1) * limit;

  const where: Record<string, unknown> = {};
  if (actorId)    where.actorId    = actorId;
  if (entityType) where.entityType = entityType;
  if (entityId)   where.entityId   = entityId;
  if (action)     where.action     = { contains: action, mode: 'insensitive' };
  if (fromDate || toDate) {
    where.createdAt = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate   ? { lte: toDate   } : {}),
    };
  }

  const [totalCount, logs] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      select: {
        id: true, actorId: true, actorRole: true, action: true,
        entityType: true, entityId: true, reason: true,
        oldValues: true, newValues: true, requestId: true,
        createdAt: true,
        actor: { select: { id: true, name: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  return {
    logs,
    meta: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) },
  };
};

// ─── Dashboard stats ──────────────────────────────────────────────────────────

export const getDashboardStats = async () => {
  const now   = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekAgo  = new Date(now.getTime() - 7  * 86_400_000);
  const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

  const [
    totalShipments,
    inTransitShipments,
    deliveredShipments,
    failedShipments,
    revenueToday,
    revenueWeek,
    revenueMonth,
    activeCouriers,
    availableCouriers,
    busyCouriers,
    deliveryAttemptStats,
  ] = await Promise.all([
    prisma.shipment.count({ where: { deletedAt: null } }),
    prisma.shipment.count({ where: { deletedAt: null, status: { in: ['IN_TRANSIT', 'AT_ORIGIN_HUB', 'AT_DESTINATION_HUB', 'OUT_FOR_DELIVERY', 'ASSIGNED', 'PICKED_UP'] as any } } }),
    prisma.shipment.count({ where: { deletedAt: null, status: 'DELIVERED' as any } }),
    prisma.shipment.count({ where: { deletedAt: null, status: { in: ['DELIVERY_FAILED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURNED'] as any } } }),
    prisma.payment.aggregate({ where: { status: 'PAID' as any, paidAt: { gte: today } }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: 'PAID' as any, paidAt: { gte: weekAgo } }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: 'PAID' as any, paidAt: { gte: monthAgo } }, _sum: { amount: true } }),
    prisma.courierProfile.count({ where: { deletedAt: null, approvalStatus: 'APPROVED' as any } }),
    prisma.courierProfile.count({ where: { deletedAt: null, approvalStatus: 'APPROVED' as any, available: true } }),
    prisma.courierProfile.count({ where: { deletedAt: null, approvalStatus: 'APPROVED' as any, available: false } }),
    prisma.deliveryAttempt.groupBy({ by: ['status'], _count: { id: true } }),
  ]);

  const deliveredCount = deliveryAttemptStats.find((s) => s.status === 'DELIVERED')?._count.id ?? 0;
  const failedCount    = deliveryAttemptStats.find((s) => s.status === 'FAILED')?._count.id   ?? 0;
  const totalAttempts  = deliveredCount + failedCount;
  const successRate    = totalAttempts > 0 ? Math.round((deliveredCount / totalAttempts) * 1000) / 10 : 0;

  return {
    shipments: {
      total:     totalShipments,
      inTransit: inTransitShipments,
      delivered: deliveredShipments,
      failed:    failedShipments,
    },
    revenue: {
      today:     revenueToday._sum.amount  ?? 0,
      thisWeek:  revenueWeek._sum.amount   ?? 0,
      thisMonth: revenueMonth._sum.amount  ?? 0,
    },
    couriers: {
      active:    activeCouriers,
      available: availableCouriers,
      busy:      busyCouriers,
    },
    delivery: {
      successRate,
      totalAttempts,
    },
  };
};
