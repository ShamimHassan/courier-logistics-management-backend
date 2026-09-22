import { randomBytes } from 'node:crypto';
import { Role, ShipmentStatus } from '../../../prisma/generated/client/enums';
import { prisma } from '../../config/database';
import { BadRequestError, NotFoundError } from '../../common/errors/AppError';
import type { CreateShipmentInput, QuoteInput } from './shipments.validation';

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

import type { ListShipmentsQuery } from './shipments.validation';

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
