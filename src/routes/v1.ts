import { Router, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../common/response';
import { env } from '../config/env';
import { authenticate } from '../common/middleware/authenticate';
import { authorize } from '../common/middleware/authorize';
import authRoutes from '../modules/auth/auth.routes';
import usersRoutes from '../modules/users/users.routes';

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

router.use('/auth', authRoutes);
router.use('/users', usersRoutes);

// ─── Admin-only stub for RBAC test ────────────────────────────────────────────
router.get('/admin/test', authenticate, authorize('ADMIN'), (_req: Request, res: Response) => {
  res.status(StatusCodes.OK).json(
    successResponse('Admin access confirmed', null),
  );
});

export default router;
