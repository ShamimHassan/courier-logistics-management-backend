import { z } from 'zod';

export const assignCourierSchema = z.object({
  courierId: z.string().cuid('courierId must be a valid user ID'),
});

export const unassignedListSchema = z.object({
  page: z
    .string()
    .optional()
    .transform((v) => Math.max(1, parseInt(v ?? '1', 10) || 1)),
  limit: z
    .string()
    .optional()
    .transform((v) => Math.min(100, Math.max(1, parseInt(v ?? '20', 10) || 20))),
});

export type AssignCourierInput = z.infer<typeof assignCourierSchema>;
export type UnassignedListQuery = z.infer<typeof unassignedListSchema>;
