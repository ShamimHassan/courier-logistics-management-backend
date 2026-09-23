import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { z } from 'zod';
import { successResponse } from '../../common/response';
import { authenticate } from '../../common/middleware/authenticate';
import { listNotifications, markNotificationRead } from './notifications.service';

const router = Router();

router.use(authenticate); // all roles

// ─── GET /notifications ───────────────────────────────────────────────────────

const listQuerySchema = z.object({
  page:  z.string().optional().transform((v) => Math.max(1, parseInt(v ?? '1',  10) || 1)),
  limit: z.string().optional().transform((v) => Math.min(100, Math.max(1, parseInt(v ?? '20', 10) || 20))),
  read:  z.enum(['true', 'false']).optional().transform((v) =>
    v === 'true' ? true : v === 'false' ? false : undefined
  ),
});

router.get('/', async (req: Request, res: Response) => {
  const query = listQuerySchema.parse(req.query);
  const result = await listNotifications(req.user!.id, query);
  res.status(StatusCodes.OK).json(
    successResponse('Notifications retrieved successfully', result),
  );
});

// ─── PATCH /notifications/:id/read ───────────────────────────────────────────

router.patch('/:id/read', async (req: Request, res: Response) => {
  const notification = await markNotificationRead(String(req.params.id), req.user!.id);
  res.status(StatusCodes.OK).json(
    successResponse('Notification marked as read', { notification }),
  );
});

export default router;
