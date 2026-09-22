import { Router, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../common/response';
import { env } from '../config/env';
import authRoutes from '../modules/auth/auth.routes';

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

export default router;
