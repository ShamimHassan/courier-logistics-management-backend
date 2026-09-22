import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { authenticate } from '../../common/middleware/authenticate';
import { authorize } from '../../common/middleware/authorize';
import { changePassword, getMe, updateMe } from './users.service';
import { changePasswordSchema, updateProfileSchema } from './users.validation';

const router = Router();

// All routes require authentication
router.use(authenticate);

// ─── GET /users/me ────────────────────────────────────────────────────────────

router.get('/me', async (req: Request, res: Response) => {
  // req.user is guaranteed by the authenticate middleware above
  const user = await getMe(req.user!.id);

  res.status(StatusCodes.OK).json(
    successResponse('Profile retrieved successfully', { user }),
  );
});

// ─── PATCH /users/me ──────────────────────────────────────────────────────────

router.patch('/me', async (req: Request, res: Response) => {
  const payload = updateProfileSchema.parse(req.body);
  const user = await updateMe(req.user!.id, payload);

  res.status(StatusCodes.OK).json(
    successResponse('Profile updated successfully', { user }),
  );
});

// ─── PATCH /users/me/password ─────────────────────────────────────────────────
// CUSTOMER and ADMIN only — COURIERs do not use email/password auth by default

router.patch(
  '/me/password',
  authorize('CUSTOMER', 'ADMIN'),
  async (req: Request, res: Response) => {
    const payload = changePasswordSchema.parse(req.body);
    const result = await changePassword(req.user!.id, payload);

    res.status(StatusCodes.OK).json(
      successResponse(result.message, null),
    );
  },
);

export default router;
