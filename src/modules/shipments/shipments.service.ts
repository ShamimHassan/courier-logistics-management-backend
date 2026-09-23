import { randomBytes } from 'node:crypto';
import { AssignmentStatus, PaymentStatus, Role, ShipmentStatus } from '../../../prisma/generated/client/enums';
import { prisma } from '../../config/database';
import { AppError, BadRequestError, ForbiddenError, NotFoundError, UnprocessableEntityError } from '../../common/errors/AppError';
import type { CancelShipmentInput, CreateShipmentInput, ListShipmentsQuery, QuoteInput, SearchShipmentsQuery, UpdateShipmentInput } from './shipments.validation';

// ─── Quote calculation ────────────────────────────────────────────────────────

/**
 * All amounts are stored and returned as INTEGER paisa/minor-units (BDT).
 * No floating-point money — we use Math.ceil() to round up fractions.
 *
 * Calculation order:
 *  1. basePrice                    (from PricingRule)
 *  2. expressFee                   (from PricingRule, only for EXPRESS)
 *  3. weightSurcharge              (weightSurchargePerKg × max(0, weight - minWeightKg))
 *  4. codFee                       (max(codFeeMin, ceil(codFeePercent% × codAmount)))
 *  5. insuranceFee                 (ceil(insuranceFeePercent% × insuranceValue))
 *  6. taxAmount                    (ceil(taxRatePercent% × subtotal-before-tax))
 *  7. total                        = sum of all above
 */
export const calculateQuote = async (input: QuoteInput) => {
  const {
    weightKg,
    originZoneId,
    destinationZoneId,
    serviceType,
    codAmount,
    insuranceValue,
  } = input;

  // ── 1. Validate zone existence ───────────────────────────────────────────────
  const [originZone, destinationZone] = await Promise.all([
    prisma.zone.findUnique({ where: { id: originZoneId }, select: { id: true, name: true, isActive: true } }),
    prisma.zone.findUnique({ where: { id: destinationZoneId }, select: { id: true, name: true, isActive: true } }),
  ]);

  if (!originZone) {
    throw NotFoundError('Origin zone not found', [
      { field: 'originZoneId', code: 'ZONE_NOT_FOUND', message: 'The specified origin zone does not exist' },
    ]);
  }
  if (!destinationZone) {
    throw NotFoundError('Destination zone not found', [
      { field: 'destinationZoneId', code: 'ZONE_NOT_FOUND', message: 'The specified destination zone does not exist' },
    ]);
  }
  if (!originZone.isActive) {
    throw BadRequestError('Origin zone is not active', [
      { field: 'originZoneId', code: 'ZONE_INACTIVE', message: `Zone "${originZone.name}" is currently inactive` },
    ]);
  }
  if (!destinationZone.isActive) {
    throw BadRequestError('Destination zone is not active', [
      { field: 'destinationZoneId', code: 'ZONE_INACTIVE', message: `Zone "${destinationZone.name}" is currently inactive` },
    ]);
  }

  // ── 2. Look up matching PricingRule ─────────────────────────────────────────
  //   Match: zone-pair + serviceType + weight bracket (minKg <= weight < maxKg)
  //   isActive + not expired
  const now = new Date();
  const rule = await prisma.pricingRule.findFirst({
    where: {
      originZoneId,
      destinationZoneId,
      serviceType,
      isActive: true,
      deletedAt: null,
      minWeightKg: { lte: weightKg },
      maxWeightKg: { gte: weightKg },
      effectiveFrom: { lte: now },
      OR: [
        { effectiveUntil: null },
        { effectiveUntil: { gte: now } },
      ],
    },
    orderBy: { version: 'desc' }, // pick latest version if multiple match
  });

  if (!rule) {
    throw BadRequestError('No pricing rule found for this route and weight', [
      {
        code: 'NO_PRICING_RULE',
        message: `No active pricing rule exists for ${serviceType} service, ${weightKg} kg, from "${originZone.name}" to "${destinationZone.name}"`,
      },
    ]);
  }

  // ── 3. Arithmetic — all integer (paisa) ─────────────────────────────────────

  // Convert Decimal fields from Prisma to JS numbers once
  const taxRatePct        = Number(rule.taxRatePercent);       // e.g. 5.00
  const insuranceFeePct   = Number(rule.insuranceFeePercent);  // e.g. 1.00
  const codFeePct         = Number(rule.codFeePercent);        // e.g. 2.00 or 3.00
  const minWeightKg       = Number(rule.minWeightKg);

  // Base price (integer, straight from rule)
  const base = rule.basePrice;

  // Express fee (integer — only for EXPRESS serviceType)
  const expressFee = serviceType === 'EXPRESS' ? rule.expressFee : 0;

  // Weight surcharge: only the weight ABOVE the minimum bracket threshold
  const surchargeKg = Math.max(0, weightKg - minWeightKg);
  const weightSurcharge = Math.ceil(surchargeKg * rule.weightSurchargePerKg);

  // COD fee: max(codFeeMin, ceil(codFeePct% × codAmount))
  const codFee = (codAmount ?? 0) > 0
    ? Math.max(rule.codFeeMin, Math.ceil((codFeePct / 100) * (codAmount ?? 0)))
    : 0;

  // Insurance fee: ceil(insuranceFeePct% × insuranceValue)
  const insuranceFee = (insuranceValue ?? 0) > 0
    ? Math.ceil((insuranceFeePct / 100) * (insuranceValue ?? 0))
    : 0;

  // Subtotal before tax
  const subtotal = base + expressFee + weightSurcharge + codFee + insuranceFee;

  // Tax: ceil(taxRatePct% × subtotal)
  const tax = Math.ceil((taxRatePct / 100) * subtotal);

  // Grand total
  const total = subtotal + tax;

  return {
    quoteAmount: total,
    breakdown: {
      base,
      expressFee,
      weightSurcharge,
      cod: codFee,
      insurance: insuranceFee,
      tax,
      total,
    },
    currency: 'bdt',
    validForMinutes: 15,
    // Metadata the client can use to confirm the rule applied
    appliedRule: {
      id: rule.id,
      serviceType: rule.serviceType,
      minWeightKg: Number(rule.minWeightKg),
      maxWeightKg: Number(rule.maxWeightKg),
    },
  };
};

// ─── Tracking number generation ───────────────────────────────────────────────

/**
 * Format: CFY + YYYYMMDD + 6 random uppercase alphanumeric chars
 * e.g.  CFY20260922AB3X7K
 * Loops until a unique value is found (collision extremely unlikely).
 */
export const generateTrackingNumber = async (): Promise<string> => {
  const dateStr = new Date()
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, ''); // YYYYMMDD

  for (let attempt = 0; attempt < 10; attempt++) {
    const suffix = randomBytes(4)
      .toString('base64url')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 6)
      .padEnd(6, '0');

    const trackingNumber = `CFY${dateStr}${suffix}`;

    const existing = await prisma.shipment.findUnique({
      where: { trackingNumber },
      select: { id: true },
    });

    if (!existing) return trackingNumber;
  }

  // Extremely unlikely — fall back with timestamp nanoseconds
  return `CFY${dateStr}${Date.now().toString(36).toUpperCase().slice(-6)}`;
};

// ─── Create shipment ──────────────────────────────────────────────────────────

/** Full select returned to the client after creation — no sensitive fields */
const shipmentFullSelect = {
  id: true,
  trackingNumber: true,
  customerId: true,
  serviceType: true,
  status: true,
  weightKg: true,
  baseAmount: true,
  codAmount: true,
  insuranceAmount: true,
  taxAmount: true,
  totalAmount: true,
  currency: true,
  deliveryInstructions: true,
  specialNotes: true,
  createdAt: true,
  updatedAt: true,
  senderAddress: {
    select: {
      id: true, fullName: true, phone: true, street: true,
      city: true, region: true, zip: true, country: true, label: true,
      zone: { select: { id: true, name: true, code: true } },
    },
  },
  recipientAddress: {
    select: {
      id: true, fullName: true, phone: true, street: true,
      city: true, region: true, zip: true, country: true, label: true,
      zone: { select: { id: true, name: true, code: true } },
    },
  },
  parcel: {
    select: {
      id: true, weightKg: true, lengthCm: true, widthCm: true, heightCm: true,
      category: true, description: true, declaredValue: true,
      isFragile: true, insuranceEnabled: true, createdAt: true,
    },
  },
  trackingEvents: {
    select: {
      id: true, eventType: true, location: true, notes: true,
      actorId: true, actorRole: true, createdAt: true,
    },
    orderBy: { createdAt: 'asc' as const },
  },
  originZone: { select: { id: true, name: true, code: true } },
  destinationZone: { select: { id: true, name: true, code: true } },
} as const;

export const createShipment = async (
  customerId: string,
  input: CreateShipmentInput,
  requestId?: string,
) => {
  const { sender, recipient, parcel, serviceType, codAmount, deliveryInstructions, specialNotes } = input;

  // ── 1. Re-calculate quote server-side (never trust client price) ───────────
  const insuranceValue = parcel.insuranceEnabled ? parcel.declaredValue : 0;

  const quote = await calculateQuote({
    weightKg: parcel.weightKg,
    lengthCm: parcel.lengthCm,
    widthCm: parcel.widthCm,
    heightCm: parcel.heightCm,
    originZoneId: sender.zoneId,
    destinationZoneId: recipient.zoneId,
    serviceType,
    codAmount: codAmount ?? 0,
    insuranceValue,
  });

  // ── 2. Generate unique tracking number (outside transaction — needs DB read) ─
  const trackingNumber = await generateTrackingNumber();

  // ── 3. Single transaction: addresses + parcel + shipment + tracking + audit ─
  const shipment = await prisma.$transaction(async (tx) => {
    // Create sender address snapshot
    const senderAddr = await tx.address.create({
      data: {
        fullName: sender.fullName,
        phone: sender.phone,
        street: sender.street,
        city: sender.city,
        region: sender.region,
        zip: sender.zip ?? null,
        country: sender.country,
        zoneId: sender.zoneId,
        label: sender.label ?? null,
      },
    });

    // Create recipient address snapshot
    const recipientAddr = await tx.address.create({
      data: {
        fullName: recipient.fullName,
        phone: recipient.phone,
        street: recipient.street,
        city: recipient.city,
        region: recipient.region,
        zip: recipient.zip ?? null,
        country: recipient.country,
        zoneId: recipient.zoneId,
        label: recipient.label ?? null,
      },
    });

    // Create shipment with nested parcel + first tracking event
    const created = await tx.shipment.create({
      data: {
        trackingNumber,
        customerId,
        senderAddressId: senderAddr.id,
        recipientAddressId: recipientAddr.id,
        originZoneId: sender.zoneId,
        destinationZoneId: recipient.zoneId,
        serviceType,
        status: ShipmentStatus.DRAFT,
        weightKg: parcel.weightKg,
        baseAmount: quote.breakdown.base,
        codAmount: codAmount ?? 0,
        insuranceAmount: quote.breakdown.insurance,
        taxAmount: quote.breakdown.tax,
        totalAmount: quote.breakdown.total,
        currency: 'bdt',
        deliveryInstructions: deliveryInstructions ?? null,
        specialNotes: specialNotes ?? null,
        parcel: {
          create: {
            weightKg: parcel.weightKg,
            lengthCm: parcel.lengthCm,
            widthCm: parcel.widthCm,
            heightCm: parcel.heightCm,
            category: parcel.category ?? null,
            description: parcel.description ?? null,
            declaredValue: parcel.declaredValue,
            isFragile: parcel.isFragile,
            insuranceEnabled: parcel.insuranceEnabled,
          },
        },
        trackingEvents: {
          create: {
            eventType: ShipmentStatus.DRAFT,
            notes: 'Shipment created by customer',
            actorId: customerId,
            actorRole: Role.CUSTOMER,
          },
        },
      },
      select: shipmentFullSelect,
    });

    // AuditLog entry
    await tx.auditLog.create({
      data: {
        actorId: customerId,
        actorRole: Role.CUSTOMER,
        action: 'SHIPMENT_CREATED',
        entityType: 'Shipment',
        entityId: created.id,
        requestId: requestId ?? null,
        newValues: {
          trackingNumber,
          serviceType,
          totalAmount: quote.breakdown.total,
          originZoneId: sender.zoneId,
          destinationZoneId: recipient.zoneId,
        },
      },
    });

    return created;
  });

  return { shipment, quote };
};

// ─── List shipments ───────────────────────────────────────────────────────────

/** Lean select for listing — no full nesting to keep payloads small */
const shipmentListSelect = {
  id: true,
  trackingNumber: true,
  customerId: true,
  serviceType: true,
  status: true,
  weightKg: true,
  codAmount: true,
  totalAmount: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
  senderAddress: {
    select: {
      fullName: true,
      city: true,
      region: true,
      zone: { select: { id: true, name: true, code: true } },
    },
  },
  recipientAddress: {
    select: {
      fullName: true,
      city: true,
      region: true,
      zone: { select: { id: true, name: true, code: true } },
    },
  },
  originZone: { select: { id: true, name: true, code: true } },
  destinationZone: { select: { id: true, name: true, code: true } },
} as const;

export const listShipments = async (
  query: ListShipmentsQuery,
  /** Pass userId when role is CUSTOMER to scope ownership; undefined for ADMIN */
  ownerId?: string,
) => {
  const { page, limit, status, serviceType, zoneId, fromDate, toDate, sortBy, sortOrder } = query;

  // ── Build where clause ────────────────────────────────────────────────────
  const where: Record<string, unknown> = {
    deletedAt: null,
  };

  // Ownership scoping — customers only see their own shipments
  if (ownerId) {
    where.customerId = ownerId;
  }

  if (status) where.status = status;
  if (serviceType) where.serviceType = serviceType;

  // zoneId filters either origin OR destination
  if (zoneId) {
    where.OR = [
      { originZoneId: zoneId },
      { destinationZoneId: zoneId },
    ];
  }

  // Date range on createdAt
  if (fromDate || toDate) {
    where.createdAt = {
      ...(fromDate ? { gte: fromDate } : {}),
      ...(toDate   ? { lte: toDate   } : {}),
    };
  }

  // ── Count + fetch in parallel ─────────────────────────────────────────────
  const skip = (page - 1) * limit;

  const [totalCount, shipments] = await Promise.all([
    prisma.shipment.count({ where }),
    prisma.shipment.findMany({
      where,
      select: shipmentListSelect,
      orderBy: { [sortBy]: sortOrder },
      skip,
      take: limit,
    }),
  ]);

  const totalPages = Math.ceil(totalCount / limit);

  return {
    shipments,
    meta: {
      page,
      limit,
      totalCount,
      totalPages,
    },
  };
};

// ─── Shared: ownership check ──────────────────────────────────────────────────
// Returns the shipment if the caller is authorised; throws 403/404 otherwise.

const shipmentDetailSelect = {
  id: true,
  trackingNumber: true,
  customerId: true,
  serviceType: true,
  status: true,
  weightKg: true,
  baseAmount: true,
  codAmount: true,
  insuranceAmount: true,
  taxAmount: true,
  totalAmount: true,
  currency: true,
  deliveryInstructions: true,
  specialNotes: true,
  deliveryAttempts: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  originZoneId: true,
  destinationZoneId: true,
  senderAddressId: true,
  recipientAddressId: true,
  senderAddress: {
    select: {
      id: true, fullName: true, phone: true, street: true,
      city: true, region: true, zip: true, country: true, label: true,
      zone: { select: { id: true, name: true, code: true } },
    },
  },
  recipientAddress: {
    select: {
      id: true, fullName: true, phone: true, street: true,
      city: true, region: true, zip: true, country: true, label: true,
      zone: { select: { id: true, name: true, code: true } },
    },
  },
  parcel: {
    select: {
      id: true, weightKg: true, lengthCm: true, widthCm: true, heightCm: true,
      category: true, description: true, declaredValue: true,
      isFragile: true, insuranceEnabled: true, createdAt: true, updatedAt: true,
    },
  },
  trackingEvents: {
    select: {
      id: true, eventType: true, location: true, notes: true, photoUrl: true,
      actorId: true, actorRole: true, hubId: true, createdAt: true,
    },
    orderBy: { createdAt: 'desc' as const },
    take: 20,
  },
  assignments: {
    where: {
      status: {
        in: [
          AssignmentStatus.OFFERED,
          AssignmentStatus.ACCEPTED,
          AssignmentStatus.IN_PROGRESS,
        ] as AssignmentStatus[],
      },
      deletedAt: null,
    },
    select: {
      id: true,
      status: true,
      acceptedAt: true,
      earnings: true,
      courier: {
        select: {
          id: true,
          vehicleType: true,
          averageRating: true,
          user: { select: { id: true, name: true, phone: true } },
        },
      },
    },
    take: 1,
  },
  payment: {
    select: {
      id: true, status: true, amount: true, currency: true,
      provider: true, paidAt: true, receiptUrl: true, createdAt: true,
    },
  },
  deliveryAttemptLog: {
    select: {
      id: true, status: true, reason: true, attemptedAt: true,
      recipientName: true, otpVerified: true, courierNotes: true,
    },
    orderBy: { attemptedAt: 'desc' as const },
  },
  originZone: { select: { id: true, name: true, code: true } },
  destinationZone: { select: { id: true, name: true, code: true } },
} as const;

/**
 * Verify the caller can access a shipment.
 * CUSTOMER: must be the owner
 * COURIER: must have an active assignment
 * ADMIN: unrestricted
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const assertShipmentAccess = async (
  shipmentId: string,
  userId: string,
  userRole: string,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> => {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: shipmentDetailSelect,
  });

  if (!shipment) throw NotFoundError('Shipment not found');

  if (userRole === 'ADMIN') return shipment;

  if (userRole === 'CUSTOMER') {
    if (shipment.customerId !== userId) {
      throw new AppError('You do not have access to this shipment', 403, [
        { code: 'FORBIDDEN', message: 'This shipment does not belong to your account' },
      ]);
    }
    return shipment;
  }

  if (userRole === 'COURIER') {
    const courierProfile = await prisma.courierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!courierProfile) throw ForbiddenError('Courier profile not found');

    const assignment = await prisma.courierAssignment.findFirst({
      where: {
        shipmentId,
        courierId: courierProfile.id,
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

    if (!assignment) {
      throw new AppError('You do not have access to this shipment', 403, [
        { code: 'FORBIDDEN', message: 'No active assignment found for your courier account' },
      ]);
    }
    return shipment;
  }

  throw ForbiddenError('Insufficient permissions');
};

// ─── Step 16: Search shipments ────────────────────────────────────────────────

export const searchShipments = async (
  query: SearchShipmentsQuery,
  userId: string,
  userRole: string,
) => {
  const { q, page, limit } = query;
  const skip = (page - 1) * limit;

  const ownerFilter = userRole === 'CUSTOMER' ? { customerId: userId } : {};

  const where = {
    deletedAt: null,
    ...ownerFilter,
    OR: [
      { trackingNumber: { contains: q, mode: 'insensitive' as const } },
      { senderAddress:   { fullName: { contains: q, mode: 'insensitive' as const } } },
      { recipientAddress: { phone: { contains: q, mode: 'insensitive' as const } } },
      { recipientAddress: { street: { contains: q, mode: 'insensitive' as const } } },
    ],
  };

  const [totalCount, shipments] = await Promise.all([
    prisma.shipment.count({ where }),
    prisma.shipment.findMany({
      where,
      select: shipmentListSelect,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
  ]);

  return {
    shipments,
    meta: { page, limit, totalCount, totalPages: Math.ceil(totalCount / limit) },
  };
};

// ─── Step 16: Get shipment by ID ──────────────────────────────────────────────

export const getShipmentById = async (
  shipmentId: string,
  userId: string,
  userRole: string,
) => {
  return assertShipmentAccess(shipmentId, userId, userRole);
};

// ─── Step 17: Update shipment ─────────────────────────────────────────────────

/** Statuses where the customer may still edit the shipment */
const EDITABLE_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.DRAFT,
  ShipmentStatus.PAYMENT_PENDING,
];

export const updateShipment = async (
  shipmentId: string,
  userId: string,
  userRole: string,
  payload: UpdateShipmentInput,
  requestId?: string,
) => {
  const shipment = await assertShipmentAccess(shipmentId, userId, userRole);

  if (!EDITABLE_STATUSES.includes(shipment.status as ShipmentStatus)) {
    throw new AppError(
      `Shipment cannot be edited in status "${shipment.status}"`,
      409,
      [{
        code: 'NOT_EDITABLE',
        message: `Only DRAFT or PAYMENT_PENDING shipments can be edited. Current status: ${shipment.status}`,
      }],
    );
  }

  // Only customers may edit their own shipments before payment
  if (userRole !== 'ADMIN' && shipment.customerId !== userId) {
    throw ForbiddenError('You can only edit your own shipments');
  }

  await prisma.$transaction(async (tx) => {
    // Update shipment top-level fields
    const shipmentData: Record<string, unknown> = {};
    if (payload.deliveryInstructions !== undefined) shipmentData.deliveryInstructions = payload.deliveryInstructions;
    if (payload.specialNotes         !== undefined) shipmentData.specialNotes         = payload.specialNotes;

    if (Object.keys(shipmentData).length > 0) {
      await tx.shipment.update({ where: { id: shipmentId }, data: shipmentData });
    }

    // Update parcel description
    if (payload.parcelDescription !== undefined && shipment.parcel) {
      await tx.parcel.update({
        where: { shipmentId },
        data: { description: payload.parcelDescription },
      });
    }

    // Update recipient contact info
    if (payload.recipientPhone !== undefined || payload.recipientName !== undefined) {
      const addrData: Record<string, string> = {};
      if (payload.recipientPhone) addrData.phone = payload.recipientPhone;
      if (payload.recipientName)  addrData.fullName = payload.recipientName;
      await tx.address.update({
        where: { id: shipment.recipientAddressId },
        data: addrData,
      });
    }

    // AuditLog
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorRole: userRole as Role,
        action: 'SHIPMENT_UPDATED',
        entityType: 'Shipment',
        entityId: shipmentId,
        requestId: requestId ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        newValues: payload as any,
      },
    });
  });

  // Return fresh full detail
  return prisma.shipment.findUnique({
    where: { id: shipmentId },
    select: shipmentDetailSelect,
  });
};

// ─── Step 17: Cancel shipment ─────────────────────────────────────────────────

/** Statuses where cancellation is NOT allowed */
const NON_CANCELLABLE: ShipmentStatus[] = [
  ShipmentStatus.DELIVERED,
  ShipmentStatus.CANCELLED,
  ShipmentStatus.RETURNED,
];

/** Statuses that qualify for full refund */
const FULL_REFUND_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.DRAFT,
  ShipmentStatus.PAYMENT_PENDING,
  ShipmentStatus.PAYMENT_FAILED,
];

/** Statuses that qualify for partial (80%) refund */
const PARTIAL_REFUND_STATUSES: ShipmentStatus[] = [
  ShipmentStatus.CONFIRMED,
  ShipmentStatus.ASSIGNMENT_PENDING,
  ShipmentStatus.ASSIGNED,
];

export const cancelShipment = async (
  shipmentId: string,
  userId: string,
  userRole: string,
  payload: CancelShipmentInput,
  requestId?: string,
) => {
  const shipment = await assertShipmentAccess(shipmentId, userId, userRole);

  // DELIVERED → 422
  if (shipment.status === ShipmentStatus.DELIVERED) {
    throw UnprocessableEntityError('Delivered shipments cannot be cancelled', [
      { code: 'ALREADY_DELIVERED', message: 'A delivered shipment cannot be cancelled. Raise a return request instead.' },
    ]);
  }

  if (NON_CANCELLABLE.includes(shipment.status as ShipmentStatus)) {
    throw new AppError(
      `Shipment in status "${shipment.status}" cannot be cancelled`,
      409,
      [{ code: 'NOT_CANCELLABLE', message: `Cannot cancel a shipment with status: ${shipment.status}` }],
    );
  }

  // PICKED_UP or later (but not already in NON_CANCELLABLE) → no refund
  const noRefundStatuses: ShipmentStatus[] = [
    ShipmentStatus.PICKED_UP,
    ShipmentStatus.AT_ORIGIN_HUB,
    ShipmentStatus.IN_TRANSIT,
    ShipmentStatus.AT_DESTINATION_HUB,
    ShipmentStatus.OUT_FOR_DELIVERY,
    ShipmentStatus.DELIVERY_FAILED,
    ShipmentStatus.RETURN_REQUESTED,
  ];

  const isFullRefund    = FULL_REFUND_STATUSES.includes(shipment.status as ShipmentStatus);
  const isPartialRefund = PARTIAL_REFUND_STATUSES.includes(shipment.status as ShipmentStatus);
  const isNoRefund      = noRefundStatuses.includes(shipment.status as ShipmentStatus);

  // Determine refund amount
  let refundAmount = 0;
  let refundPolicy = 'NO_REFUND';
  if (isFullRefund)    { refundAmount = shipment.totalAmount; refundPolicy = 'FULL_REFUND'; }
  if (isPartialRefund) { refundAmount = Math.floor(shipment.totalAmount * 0.8); refundPolicy = 'PARTIAL_REFUND_80'; }
  if (isNoRefund)      { refundAmount = 0; refundPolicy = 'NO_REFUND'; }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // Soft-delete + status transition
    await tx.shipment.update({
      where: { id: shipmentId },
      data: {
        status: ShipmentStatus.CANCELLED,
        deletedAt: now,
      },
    });

    // TrackingEvent
    await tx.trackingEvent.create({
      data: {
        shipmentId,
        eventType: ShipmentStatus.CANCELLED,
        notes: `Cancelled: ${payload.reason}`,
        actorId: userId,
        actorRole: userRole as Role,
      },
    });

    // Flag payment for refund if eligible
    if (shipment.payment && (isFullRefund || isPartialRefund)) {
      await tx.payment.update({
        where: { id: shipment.payment.id },
        data: {
          status: PaymentStatus.REFUNDED,
          refundedAmount: refundAmount,
        },
      });
    }

    // Revoke active courier assignments
    await tx.courierAssignment.updateMany({
      where: {
        shipmentId,
        status: {
          in: [AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED],
        },
      },
      data: { status: AssignmentStatus.CANCELLED },
    });

    // AuditLog
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorRole: userRole as Role,
        action: 'SHIPMENT_CANCELLED',
        entityType: 'Shipment',
        entityId: shipmentId,
        requestId: requestId ?? null,
        oldValues: { status: shipment.status },
        newValues: { status: 'CANCELLED', reason: payload.reason, refundPolicy, refundAmount },
        reason: payload.reason,
      },
    });
  });

  return {
    shipmentId,
    trackingNumber: shipment.trackingNumber,
    status: 'CANCELLED',
    refundPolicy,
    refundAmount,
    reason: payload.reason,
  };
};

// ─── Step 18: Tracking timeline ───────────────────────────────────────────────

/**
 * Return a human-readable relative time string from a Date.
 * Examples: "just now", "3 minutes ago", "2 hours ago", "4 days ago"
 */
const humanReadableTime = (date: Date): string => {
  const diffMs = Date.now() - date.getTime();
  const diffSec = Math.floor(diffMs / 1_000);
  if (diffSec < 60)  return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60)  return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24)   return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30)  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
  const diffMo = Math.floor(diffDay / 30);
  if (diffMo < 12)   return `${diffMo} month${diffMo === 1 ? '' : 's'} ago`;
  const diffYr = Math.floor(diffMo / 12);
  return `${diffYr} year${diffYr === 1 ? '' : 's'} ago`;
};

export const getShipmentTracking = async (
  shipmentId: string,
  userId: string,
  userRole: string,
) => {
  // Reuse ownership check — throws 403/404 if not authorised
  await assertShipmentAccess(shipmentId, userId, userRole);

  const events = await prisma.trackingEvent.findMany({
    where: { shipmentId },
    select: {
      id: true,
      eventType: true,
      location: true,
      notes: true,
      actorId: true,
      actorRole: true,
      photoUrl: true,
      hubId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' }, // chronological — oldest first
  });

  return events.map((e) => ({
    ...e,
    humanReadableTime: humanReadableTime(e.createdAt),
  }));
};

// ─── Step 21: Pickup ──────────────────────────────────────────────────────────

import type { PickupInput, StatusTransitionInput } from './shipments.validation';

export const pickupShipment = async (
  shipmentId: string,
  userId: string,
  payload: PickupInput,
  requestId?: string,
) => {
  // Resolve courier profile
  const courierProfile = await prisma.courierProfile.findUnique({
    where: { userId },
    select: { id: true },
  });
  if (!courierProfile) throw ForbiddenError('No courier profile found for your account');

  // Fetch shipment
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: { id: true, status: true, trackingNumber: true, customerId: true },
  });
  if (!shipment) throw NotFoundError('Shipment not found');

  if (shipment.status !== ShipmentStatus.ASSIGNED) {
    throw new AppError(
      `Shipment cannot be picked up in status "${shipment.status}"`,
      409,
      [{ code: 'INVALID_STATUS', message: `Shipment must be ASSIGNED to pick up. Current: ${shipment.status}` }],
    );
  }

  // Verify courier has an ACCEPTED assignment for this shipment
  const assignment = await prisma.courierAssignment.findFirst({
    where: {
      shipmentId,
      courierId: courierProfile.id,
      status: AssignmentStatus.ACCEPTED,
      deletedAt: null,
    },
    select: { id: true },
  });

  if (!assignment) {
    throw new AppError('You do not have an accepted assignment for this shipment', 403, [
      { code: 'NO_ACCEPTED_ASSIGNMENT', message: 'Pickup requires an ACCEPTED assignment for this shipment' },
    ]);
  }

  await prisma.$transaction(async (tx) => {
    // Shipment → PICKED_UP
    await tx.shipment.update({
      where: { id: shipmentId },
      data: { status: ShipmentStatus.PICKED_UP },
    });

    // Assignment → IN_PROGRESS
    await tx.courierAssignment.update({
      where: { id: assignment.id },
      data: { status: AssignmentStatus.IN_PROGRESS },
    });

    // TrackingEvent
    await tx.trackingEvent.create({
      data: {
        shipmentId,
        eventType: ShipmentStatus.PICKED_UP,
        notes: `Parcel picked up. Condition: ${payload.condition}${payload.notes ? ` — ${payload.notes}` : ''}`,
        photoUrl: payload.photoUrl ?? null,
        actorId: userId,
        actorRole: Role.COURIER,
      },
    });

    // AuditLog
    await tx.auditLog.create({
      data: {
        actorId: userId,
        actorRole: Role.COURIER,
        action: 'SHIPMENT_PICKED_UP',
        entityType: 'Shipment',
        entityId: shipmentId,
        requestId: requestId ?? null,
        newValues: { status: ShipmentStatus.PICKED_UP, condition: payload.condition } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
      },
    });
  });

  return {
    shipmentId,
    trackingNumber: shipment.trackingNumber,
    status: ShipmentStatus.PICKED_UP,
    condition: payload.condition,
  };
};

// ─── Step 21: Status transition state machine ─────────────────────────────────

/**
 * Valid courier-driven transitions:
 *   PICKED_UP          → AT_ORIGIN_HUB        (hubId required)
 *   AT_ORIGIN_HUB      → IN_TRANSIT
 *   IN_TRANSIT         → AT_DESTINATION_HUB   (hubId required)
 *   AT_DESTINATION_HUB → OUT_FOR_DELIVERY
 */
const COURIER_TRANSITIONS: Partial<Record<ShipmentStatus, ShipmentStatus>> = {
  [ShipmentStatus.PICKED_UP]:          ShipmentStatus.AT_ORIGIN_HUB,
  [ShipmentStatus.AT_ORIGIN_HUB]:      ShipmentStatus.IN_TRANSIT,
  [ShipmentStatus.IN_TRANSIT]:         ShipmentStatus.AT_DESTINATION_HUB,
  [ShipmentStatus.AT_DESTINATION_HUB]: ShipmentStatus.OUT_FOR_DELIVERY,
};

/** Transitions that require a hubId */
const HUB_REQUIRED_TRANSITIONS = new Set<ShipmentStatus>([
  ShipmentStatus.AT_ORIGIN_HUB,
  ShipmentStatus.AT_DESTINATION_HUB,
]);

export const transitionShipmentStatus = async (
  shipmentId: string,
  userId: string,
  userRole: string,
  payload: StatusTransitionInput,
  requestId?: string,
) => {
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: { id: true, status: true, trackingNumber: true },
  });
  if (!shipment) throw NotFoundError('Shipment not found');

  const currentStatus = shipment.status as ShipmentStatus;
  const targetStatus  = payload.status;

  if (userRole === 'ADMIN') {
    // Admin override — any transition allowed but adminReason is required
    if (!payload.adminReason) {
      throw BadRequestError('Admin status overrides require adminReason', [
        { field: 'adminReason', code: 'ADMIN_REASON_REQUIRED', message: 'Provide adminReason when overriding shipment status as admin' },
      ]);
    }
  } else {
    // Courier — must have an active (IN_PROGRESS) assignment
    const courierProfile = await prisma.courierProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!courierProfile) throw ForbiddenError('No courier profile found for your account');

    const assignment = await prisma.courierAssignment.findFirst({
      where: {
        shipmentId,
        courierId: courierProfile.id,
        status: AssignmentStatus.IN_PROGRESS,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!assignment) {
      throw new AppError('You do not have an active assignment for this shipment', 403, [
        { code: 'NO_ACTIVE_ASSIGNMENT', message: 'Status transitions require an IN_PROGRESS assignment' },
      ]);
    }

    // Validate allowed state machine transition
    const allowedNext = COURIER_TRANSITIONS[currentStatus];
    if (allowedNext !== targetStatus) {
      throw BadRequestError(
        `Invalid status transition from ${currentStatus} to ${targetStatus}`,
        [{
          code: 'INVALID_TRANSITION',
          message: allowedNext
            ? `From ${currentStatus} the only valid next status is ${allowedNext}`
            : `No courier-driven transition is defined from status ${currentStatus}`,
        }],
      );
    }

    // hubId required for AT_ORIGIN_HUB and AT_DESTINATION_HUB
    if (HUB_REQUIRED_TRANSITIONS.has(targetStatus) && !payload.hubId) {
      throw BadRequestError(`hubId is required when transitioning to ${targetStatus}`, [
        { field: 'hubId', code: 'HUB_ID_REQUIRED', message: `Provide a hubId for ${targetStatus} transitions` },
      ]);
    }
  }

  const actorRole = userRole === 'ADMIN' ? Role.ADMIN : Role.COURIER;

  await prisma.$transaction(async (tx) => {
    await tx.shipment.update({
      where: { id: shipmentId },
      data: { status: targetStatus },
    });

    await tx.trackingEvent.create({
      data: {
        shipmentId,
        eventType: targetStatus,
        hubId: payload.hubId ?? null,
        location: payload.location ?? null,
        notes: payload.adminReason
          ? `Admin override: ${payload.adminReason}`
          : (payload.notes ?? `Status updated to ${targetStatus}`),
        actorId: userId,
        actorRole,
      },
    });

    if (userRole === 'ADMIN' && payload.adminReason) {
      await tx.auditLog.create({
        data: {
          actorId: userId,
          actorRole: Role.ADMIN,
          action: 'ADMIN_STATUS_OVERRIDE',
          entityType: 'Shipment',
          entityId: shipmentId,
          requestId: requestId ?? null,
          reason: payload.adminReason,
          oldValues: { status: currentStatus } as any, // eslint-disable-line @typescript-eslint/no-explicit-any
          newValues: { status: targetStatus } as any,   // eslint-disable-line @typescript-eslint/no-explicit-any
        },
      });
    }
  });

  return {
    shipmentId,
    trackingNumber: shipment.trackingNumber,
    previousStatus: currentStatus,
    status: targetStatus,
  };
};
