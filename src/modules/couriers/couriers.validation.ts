import { z } from 'zod';

/**
 * PATCH /couriers/me/availability
 * Body must contain exactly { available: boolean }.
 */
export const setAvailabilitySchema = z.object({
  available: z.boolean({ error: 'available must be a boolean (true or false)' }),
}).strict();

export type SetAvailabilityInput = z.infer<typeof setAvailabilitySchema>;
