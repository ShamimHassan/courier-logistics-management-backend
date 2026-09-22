import { prisma } from '../../config/database';
import { BadRequestError, NotFoundError } from '../../common/errors/AppError';
import type { QuoteInput } from './shipments.validation';

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
