import { z } from 'zod';

/**
 * PATCH /couriers/me/availability
 * Body must contain exactly { available: boolean }.
 */
export const setAvailabilitySchema = z.object({
  available: z.boolean({ error: 'available must be a boolean (true or false)' }),
}).strict();

export type SetAvailabilityInput = z.infer<typeof setAvailabilitySchema>;

// ─── Earnings query ───────────────────────────────────────────────────────────

export const earningsQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => Math.max(1, parseInt(v ?? '1', 10) || 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(100, Math.max(1, parseInt(v ?? '20', 10) || 20))),
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
});

export type EarningsQuery = z.infer<typeof earningsQuerySchema>;
