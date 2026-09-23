import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { authenticate } from '../../common/middleware/authenticate';
import { authorize } from '../../common/middleware/authorize';
import { getCourierMe, getCourierEarnings, setCourierAvailability } from './couriers.service';
import { earningsQuerySchema, setAvailabilitySchema } from './couriers.validation';

const router = Router();

// All courier routes require authentication + COURIER role
router.use(authenticate, authorize('COURIER'));

// ─── GET /couriers/me ─────────────────────────────────────────────────────────

router.get('/me', async (req: Request, res: Response) => {
  const profile = await getCourierMe(req.user!.id);
  res.status(StatusCodes.OK).json(
    successResponse('Courier profile retrieved successfully', { profile }),
  );
});

// ─── GET /couriers/me/earnings ────────────────────────────────────────────────

router.get('/me/earnings', async (req: Request, res: Response) => {
  const query = earningsQuerySchema.parse(req.query);
  const result = await getCourierEarnings(req.user!.id, query);
  res.status(StatusCodes.OK).json(
    successResponse('Earnings retrieved successfully', result),
  );
});

// ─── PATCH /couriers/me/availability ─────────────────────────────────────────

router.patch('/me/availability', async (req: Request, res: Response) => {
  const payload = setAvailabilitySchema.parse(req.body);

  const profile = await setCourierAvailability({
    userId: req.user!.id,
    payload,
    actorIp: req.ip,
    actorUserAgent: req.get('user-agent'),
    requestId: req.id,
  });

  res.status(StatusCodes.OK).json(
    successResponse(
      `Availability set to ${payload.available ? 'available' : 'unavailable'}`,
      { profile },
    ),
  );
});

export default router;
