import { z } from 'zod';

// ─── Accept (no body needed) ──────────────────────────────────────────────────
// Accept has no required body — the assignment ID in the URL is sufficient.

// ─── Reject ───────────────────────────────────────────────────────────────────

export const REJECT_REASONS = [
  'VEHICLE_ISSUE',
  'PERSONAL_EMERGENCY',
  'WRONG_ZONE',
  'PACKAGE_CONFLICT',
  'OTHER',
] as const;

export type RejectReason = (typeof REJECT_REASONS)[number];

export const rejectAssignmentSchema = z.object({
  reason: z.enum(REJECT_REASONS, {
    error: `reason must be one of: ${REJECT_REASONS.join(', ')}`,
  }),
  notes: z.string().trim().max(500).optional(),
});

export type RejectAssignmentInput = z.infer<typeof rejectAssignmentSchema>;
