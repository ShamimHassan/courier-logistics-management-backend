import { z } from 'zod';
import { ServiceType } from '../../../prisma/generated/client/enums';

// ─── Quote request ────────────────────────────────────────────────────────────

export const quoteSchema = z.object({
  weightKg: z
    .number({ error: 'weightKg must be a number' })
    .positive('weightKg must be greater than 0')
    .max(500, 'weightKg cannot exceed 500 kg'),

  lengthCm: z
    .number({ error: 'lengthCm must be a number' })
    .positive('lengthCm must be greater than 0')
    .max(300, 'lengthCm cannot exceed 300 cm'),

  widthCm: z
    .number({ error: 'widthCm must be a number' })
    .positive('widthCm must be greater than 0')
    .max(300, 'widthCm cannot exceed 300 cm'),

  heightCm: z
    .number({ error: 'heightCm must be a number' })
    .positive('heightCm must be greater than 0')
    .max(300, 'heightCm cannot exceed 300 cm'),

  originZoneId: z.string().cuid('originZoneId must be a valid zone ID'),

  destinationZoneId: z.string().cuid('destinationZoneId must be a valid zone ID'),

  serviceType: z.enum(
    [ServiceType.STANDARD, ServiceType.EXPRESS, ServiceType.OVERNIGHT],
    { error: 'serviceType must be STANDARD, EXPRESS, or OVERNIGHT' },
  ),

  codAmount: z
    .number()
    .int('codAmount must be an integer (paisa/taka, no decimals)')
    .nonnegative('codAmount cannot be negative')
    .optional()
    .default(0),

  insuranceValue: z
    .number()
    .int('insuranceValue must be an integer (declared value in BDT)')
    .nonnegative('insuranceValue cannot be negative')
    .optional()
    .default(0),
});

export type QuoteInput = z.infer<typeof quoteSchema>;
