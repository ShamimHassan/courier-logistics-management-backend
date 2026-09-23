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

// ─── Pricing rule schemas ─────────────────────────────────────────────────────

import { ServiceType } from '../../../prisma/generated/client/enums';

export const createPricingRuleSchema = z.object({
  originZoneId:       z.string().cuid().optional(),
  destinationZoneId:  z.string().cuid().optional(),
  serviceType:        z.enum([ServiceType.STANDARD, ServiceType.EXPRESS, ServiceType.OVERNIGHT]),
  minWeightKg:        z.number().nonnegative().default(0),
  maxWeightKg:        z.number().positive(),
  basePrice:          z.number().int().positive(),
  weightSurchargePerKg: z.number().int().nonnegative().default(0),
  expressFee:         z.number().int().nonnegative().default(0),
  insuranceFeePercent: z.number().nonnegative().default(0),
  taxRatePercent:     z.number().nonnegative().default(5),
  codFeePercent:      z.number().nonnegative().default(0),
  codFeeMin:          z.number().int().nonnegative().default(0),
  effectiveFrom:      z.string().optional().transform((v) => v ? new Date(v) : new Date()).pipe(z.date()),
  effectiveUntil:     z.string().optional().transform((v) => v ? new Date(v) : undefined).pipe(z.date().optional()),
});

export const updatePricingRuleSchema = z.object({
  isActive:           z.boolean().optional(),
  effectiveUntil:     z.string().optional().transform((v) => v ? new Date(v) : undefined).pipe(z.date().optional()),
  basePrice:          z.number().int().positive().optional(),
  weightSurchargePerKg: z.number().int().nonnegative().optional(),
  taxRatePercent:     z.number().nonnegative().optional(),
}).strict();

export type CreatePricingRuleInput = z.infer<typeof createPricingRuleSchema>;
export type UpdatePricingRuleInput = z.infer<typeof updatePricingRuleSchema>;

// ─── User management schemas ──────────────────────────────────────────────────

import { Role, UserStatus } from '../../../prisma/generated/client/enums';

export const listUsersSchema = z.object({
  page:    z.string().optional().transform((v) => Math.max(1, parseInt(v ?? '1',  10) || 1)),
  limit:   z.string().optional().transform((v) => Math.min(100, Math.max(1, parseInt(v ?? '20', 10) || 20))),
  role:    z.enum([Role.ADMIN, Role.COURIER, Role.CUSTOMER]).optional(),
  status:  z.enum([UserStatus.ACTIVE, UserStatus.SUSPENDED, UserStatus.PENDING_APPROVAL]).optional(),
  search:  z.string().trim().max(100).optional(),
});

export const updateUserStatusSchema = z.object({
  status: z.enum([UserStatus.ACTIVE, UserStatus.SUSPENDED]),
  reason: z.string().trim().min(3).max(500).optional(),
});

export const updateUserRoleSchema = z.object({
  role: z.enum([Role.ADMIN, Role.COURIER, Role.CUSTOMER]),
  reason: z.string().trim().min(3).max(500),
});

export type ListUsersQuery        = z.infer<typeof listUsersSchema>;
export type UpdateUserStatusInput = z.infer<typeof updateUserStatusSchema>;
export type UpdateUserRoleInput   = z.infer<typeof updateUserRoleSchema>;

// ─── Audit log query schema ───────────────────────────────────────────────────

export const auditLogQuerySchema = z.object({
  page:       z.string().optional().transform((v) => Math.max(1, parseInt(v ?? '1',  10) || 1)),
  limit:      z.string().optional().transform((v) => Math.min(100, Math.max(1, parseInt(v ?? '20', 10) || 20))),
  actorId:    z.string().cuid().optional(),
  entityType: z.string().trim().max(100).optional(),
  entityId:   z.string().cuid().optional(),
  action:     z.string().trim().max(100).optional(),
  fromDate:   z.string().optional().transform((v) => v ? new Date(v) : undefined).pipe(z.date().optional()),
  toDate:     z.string().optional().transform((v) => v ? new Date(v) : undefined).pipe(z.date().optional()),
});

export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;
