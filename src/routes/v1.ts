import { Router, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../common/response';
import { env } from '../config/env';
import { authenticate } from '../common/middleware/authenticate';
import { authorize } from '../common/middleware/authorize';
import authRoutes          from '../modules/auth/auth.routes';
import usersRoutes         from '../modules/users/users.routes';
import couriersRoutes      from '../modules/couriers/couriers.routes';
import shipmentsRoutes     from '../modules/shipments/shipments.routes';
import adminRoutes         from '../modules/admin/admin.routes';
import assignmentsRoutes   from '../modules/assignments/assignments.routes';
import notificationsRoutes from '../modules/notifications/notifications.routes';
import hubsRoutes          from '../modules/hubs/hubs.routes';
import paymentsRoutes      from '../modules/payments/payments.routes';

const router = Router();

router.get('/', (_req: Request, res: Response) => {
  res.status(StatusCodes.OK).json(
    successResponse('CourierFlow API v1', {
      version: '1.0.0',
      endpoints: {
        health: '/api/v1/health',
        auth: {
          register: '/api/v1/auth/register',
          login: '/api/v1/auth/login',
          refreshToken: '/api/v1/auth/refresh-token',
          logout: '/api/v1/auth/logout',
          googleLogin: '/api/v1/auth/google',
          googleCallback: '/api/v1/auth/google/callback',
        },
        users: {
          me: '/api/v1/users/me',
          updateProfile: 'PATCH /api/v1/users/me',
          changePassword: 'PATCH /api/v1/users/me/password',
        },
        couriers: {
          me: 'GET /api/v1/couriers/me',
          earnings: 'GET /api/v1/couriers/me/earnings',
          availability: 'PATCH /api/v1/couriers/me/availability',
        },
        shipments: {
          list: 'GET /api/v1/shipments',
          myList: 'GET /api/v1/shipments/my',
          search: 'GET /api/v1/shipments/search',
          quote: 'POST /api/v1/shipments/quote',
          create: 'POST /api/v1/shipments',
          detail: 'GET /api/v1/shipments/:id',
          tracking: 'GET /api/v1/shipments/:id/tracking',
          pickup: 'POST /api/v1/shipments/:id/pickup',
          status: 'PATCH /api/v1/shipments/:id/status',
          deliveryAttempt: 'POST /api/v1/shipments/:id/delivery-attempts',
          rating: 'POST /api/v1/shipments/:id/rating',
          update: 'PATCH /api/v1/shipments/:id',
          cancel: 'POST /api/v1/shipments/:id/cancel',
        },
        payments: {
          checkout: 'POST /api/v1/payments/shipments/:id/checkout',
          ipn: 'POST /api/v1/payments/sslcommerz/ipn',
          success: 'POST /api/v1/payments/sslcommerz/success',
          fail: 'POST /api/v1/payments/sslcommerz/fail',
          cancel: 'POST /api/v1/payments/sslcommerz/cancel',
          detail: 'GET /api/v1/payments/:id',
          byShipment: 'GET /api/v1/payments/shipments/:shipmentId',
        },
        notifications: {
          list: 'GET /api/v1/notifications',
          markRead: 'PATCH /api/v1/notifications/:id/read',
        },
        admin: {
          assign: 'POST /api/v1/admin/shipments/:id/assign',
          unassigned: 'GET /api/v1/admin/assignments/unassigned',
          createPricingRule: 'POST /api/v1/admin/pricing-rules',
          updatePricingRule: 'PATCH /api/v1/admin/pricing-rules/:id',
          users: 'GET /api/v1/admin/users',
          updateUserStatus: 'PATCH /api/v1/admin/users/:id/status',
          updateUserRole: 'PATCH /api/v1/admin/users/:id/role',
          auditLogs: 'GET /api/v1/admin/audit-logs',
          dashboardStats: 'GET /api/v1/admin/dashboard-stats',
        },
        hubs: {
          list: 'GET /api/v1/hubs',
          detail: 'GET /api/v1/hubs/:id',
          create: 'POST /api/v1/hubs',
          update: 'PATCH /api/v1/hubs/:id',
        },
        assignments: {
          accept: 'PATCH /api/v1/assignments/:id/accept',
          reject: 'PATCH /api/v1/assignments/:id/reject',
        },
      },
    }),
  );
});

router.get('/health', (_req: Request, res: Response) => {
  res.status(StatusCodes.OK).json(
    successResponse('Service is healthy', {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: env.NODE_ENV,
    }),
  );
});

router.use('/auth',          authRoutes);
router.use('/users',         usersRoutes);
router.use('/couriers',      couriersRoutes);
router.use('/shipments',     shipmentsRoutes);
router.use('/payments',      paymentsRoutes);
router.use('/admin',         adminRoutes);
router.use('/assignments',   assignmentsRoutes);
router.use('/notifications', notificationsRoutes);
router.use('/hubs',          hubsRoutes);

// ─── Admin-only stub for RBAC test (Step 10 backward compat) ─────────────────
router.get('/admin/test', authenticate, authorize('ADMIN'), (_req: Request, res: Response) => {
  res.status(StatusCodes.OK).json(successResponse('Admin access confirmed', null));
});

export default router;
