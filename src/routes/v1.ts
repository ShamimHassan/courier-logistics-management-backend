import { Router } from 'express';

const router = Router();

router.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'CourierFlow API v1',
    data: {
      version: '1.0.0',
      endpoints: {
        health: '/api/v1/health',
      },
    },
  });
});

export default router;
