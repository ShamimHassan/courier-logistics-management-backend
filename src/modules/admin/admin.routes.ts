import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { authenticate } from '../../common/middleware/authenticate';
import { authorize } from '../../common/middleware/authorize';
import {
  assignCourier,
  createPricingRule,
  getDashboardStats,
  listAdminUsers,
  listAuditLogs,
  listUnassignedShipments,
  updatePricingRule,
  updateUserRole,
  updateUserStatus,
} from './admin.service';
import {
  assignCourierSchema,
  auditLogQuerySchema,
  createPricingRuleSchema,
  listUsersSchema,
  unassignedListSchema,
  updatePricingRuleSchema,
  updateUserRoleSchema,
  updateUserStatusSchema,
} from './admin.validation';

const router = Router();

// All admin routes require ADMIN role
router.use(authenticate, authorize('ADMIN'));

// ─── POST /admin/shipments/:id/assign ────────────────────────────────────────

router.post('/shipments/:id/assign', async (req: Request, res: Response) => {
  const payload = assignCourierSchema.parse(req.body);
  const result  = await assignCourier(String(req.params.id), payload, req.user!.id, req.id);
  res.status(StatusCodes.CREATED).json(successResponse('Courier assigned successfully', result));
});

// ─── GET /admin/assignments/unassigned ───────────────────────────────────────

router.get('/assignments/unassigned', async (req: Request, res: Response) => {
  const query  = unassignedListSchema.parse(req.query);
  const result = await listUnassignedShipments(query);
  res.status(StatusCodes.OK).json(successResponse('Unassigned shipments retrieved successfully', result));
});

// ─── POST /admin/pricing-rules ───────────────────────────────────────────────

router.post('/pricing-rules', async (req: Request, res: Response) => {
  const input = createPricingRuleSchema.parse(req.body);
  const rule  = await createPricingRule(input, req.user!.id);
  res.status(StatusCodes.CREATED).json(successResponse('Pricing rule created successfully', { rule }));
});

// ─── PATCH /admin/pricing-rules/:id ──────────────────────────────────────────

router.patch('/pricing-rules/:id', async (req: Request, res: Response) => {
  const input = updatePricingRuleSchema.parse(req.body);
  const rule  = await updatePricingRule(String(req.params.id), input, req.user!.id);
  res.status(StatusCodes.OK).json(successResponse('Pricing rule updated successfully', { rule }));
});

// ─── GET /admin/users ────────────────────────────────────────────────────────

router.get('/users', async (req: Request, res: Response) => {
  const query  = listUsersSchema.parse(req.query);
  const result = await listAdminUsers(query);
  res.status(StatusCodes.OK).json(successResponse('Users retrieved successfully', result));
});

// ─── PATCH /admin/users/:id/status ───────────────────────────────────────────

router.patch('/users/:id/status', async (req: Request, res: Response) => {
  const input   = updateUserStatusSchema.parse(req.body);
  const updated = await updateUserStatus(String(req.params.id), input, req.user!.id, req.id);
  res.status(StatusCodes.OK).json(successResponse('User status updated successfully', { user: updated }));
});

// ─── PATCH /admin/users/:id/role ─────────────────────────────────────────────

router.patch('/users/:id/role', async (req: Request, res: Response) => {
  const input   = updateUserRoleSchema.parse(req.body);
  const updated = await updateUserRole(String(req.params.id), input, req.user!.id, req.id);
  res.status(StatusCodes.OK).json(successResponse('User role updated successfully', { user: updated }));
});

// ─── GET /admin/audit-logs ───────────────────────────────────────────────────

router.get('/audit-logs', async (req: Request, res: Response) => {
  const query  = auditLogQuerySchema.parse(req.query);
  const result = await listAuditLogs(query);
  res.status(StatusCodes.OK).json(successResponse('Audit logs retrieved successfully', result));
});

// ─── GET /admin/dashboard-stats ──────────────────────────────────────────────

router.get('/dashboard-stats', async (_req: Request, res: Response) => {
  const stats = await getDashboardStats();
  res.status(StatusCodes.OK).json(successResponse('Dashboard stats retrieved successfully', stats));
});

// ─── POST /admin/hubs — proxy to hubs module (convenience route) ─────────────
// Note: Full hub routes are at /hubs (public GET) and /hubs for admin POST/PATCH

export default router;
