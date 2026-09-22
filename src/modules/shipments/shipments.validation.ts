import { z } from 'zod';
import { ServiceType, ShipmentStatus } from '../../../prisma/generated/client/enums';

const bangladeshPhoneRegex = /^(?:\+8801|01)[3-9]\d{8}$/;

const normalizePhone = (v: string) => {
  const t = v.trim();
  return t.startsWith('01') ? `+880${t.slice(1)}` : t;
};

// ─── Reusable address sub-schema ─────────────────────────────────────────────

const addressSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(100),
  phone: z
    .string()
    .trim()
    .regex(bangladeshPhoneRegex, 'Phone must be a valid Bangladesh mobile number')
    .transform(normalizePhone),
  street: z.string().trim().min(5, 'Street address must be at least 5 characters').max(300),
  city: z.string().trim().min(2, 'City is required').max(100),
  region: z.string().trim().min(2, 'Region is required').max(100),
  zip: z.string().trim().max(20).optional(),
  country: z.string().trim().default('Bangladesh'),
  zoneId: z.string().cuid('zoneId must be a valid zone ID'),
  label: z.string().trim().max(100).optional(),
});

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

// ─── Create shipment request ──────────────────────────────────────────────────

export const createShipmentSchema = z.object({
  // Sender address (snapshot — stored as new Address record)
  sender: addressSchema,

  // Recipient address (snapshot)
  recipient: addressSchema,

  // Parcel details
  parcel: z.object({
    weightKg: z
      .number({ error: 'parcel.weightKg must be a number' })
      .positive('parcel weight must be greater than 0')
      .max(500),
    lengthCm: z
      .number({ error: 'parcel.lengthCm must be a number' })
      .positive()
      .max(300),
    widthCm: z
      .number({ error: 'parcel.widthCm must be a number' })
      .positive()
      .max(300),
    heightCm: z
      .number({ error: 'parcel.heightCm must be a number' })
      .positive()
      .max(300),
    category: z.string().trim().max(100).optional(),
    description: z.string().trim().max(500).optional(),
    declaredValue: z
      .number()
      .int('declaredValue must be an integer (BDT)')
      .nonnegative()
      .default(0),
    isFragile: z.boolean().default(false),
    insuranceEnabled: z.boolean().default(false),
  }),

  // Service details
  serviceType: z.enum(
    [ServiceType.STANDARD, ServiceType.EXPRESS, ServiceType.OVERNIGHT],
    { error: 'serviceType must be STANDARD, EXPRESS, or OVERNIGHT' },
  ),

  // Optional delivery metadata
  codAmount: z
    .number()
    .int('codAmount must be an integer')
    .nonnegative()
    .optional()
    .default(0),
  deliveryInstructions: z.string().trim().max(500).optional(),
  specialNotes: z.string().trim().max(500).optional(),
});

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;

// ─── List shipments query params ─────────────────────────────────────────────

/** Columns the client is allowed to sort on — all others → 400 */
const ALLOWED_SORT_FIELDS = ['createdAt', 'updatedAt', 'totalAmount', 'status'] as const;
export type AllowedSortField = (typeof ALLOWED_SORT_FIELDS)[number];

export const listShipmentsSchema = z.object({
  // Pagination — clamped to sane bounds, never throw on out-of-range
  page: z
    .string()
    .optional()
    .transform((v) => {
      const n = parseInt(v ?? '1', 10);
      return isNaN(n) || n < 1 ? 1 : n;
    }),

  limit: z
    .string()
    .optional()
    .transform((v) => {
      const n = parseInt(v ?? '20', 10);
      if (isNaN(n) || n < 1) return 20;
      return Math.min(n, 100); // cap at 100
    }),

  // Filters — all optional
  status: z
    .enum(Object.values(ShipmentStatus) as [ShipmentStatus, ...ShipmentStatus[]])
    .optional(),

  serviceType: z
    .enum(Object.values(ServiceType) as [ServiceType, ...ServiceType[]])
    .optional(),

  zoneId: z.string().cuid().optional(),

  fromDate: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined))
    .pipe(z.date().optional()),

  toDate: z
    .string()
    .optional()
    .transform((v) => (v ? new Date(v) : undefined))
    .pipe(z.date().optional()),

  // Sorting — unknown field throws 400 (caught by Zod .enum)
  sortBy: z
    .enum(ALLOWED_SORT_FIELDS, {
      error: `sortBy must be one of: ${ALLOWED_SORT_FIELDS.join(', ')}`,
    })
    .optional()
    .default('createdAt'),

  sortOrder: z
    .enum(['asc', 'desc'])
    .optional()
    .default('desc'),
});

export type ListShipmentsQuery = z.infer<typeof listShipmentsSchema>;
