import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { authenticate } from '../../common/middleware/authenticate';
import { authorize } from '../../common/middleware/authorize';
import { assignCourier, listUnassignedShipments } from './admin.service';
import { assignCourierSchema, unassignedListSchema } from './admin.validation';

const router = Router();

// All admin routes require ADMIN role
router.use(authenticate, authorize('ADMIN'));

// ─── POST /admin/shipments/:id/assign ────────────────────────────────────────

router.post(
  '/shipments/:id/assign',
  async (req: Request, res: Response) => {
    const payload = assignCourierSchema.parse(req.body);
    const result = await assignCourier(
      String(req.params.id),
      payload,
      req.user!.id,
      req.id,
    );

    res.status(StatusCodes.CREATED).json(
      successResponse('Courier assigned successfully', result),
    );
  },
);

// ─── GET /admin/assignments/unassigned ───────────────────────────────────────

router.get(
  '/assignments/unassigned',
  async (req: Request, res: Response) => {
    const query = unassignedListSchema.parse(req.query);
    const result = await listUnassignedShipments(query);

    res.status(StatusCodes.OK).json(
      successResponse('Unassigned shipments retrieved successfully', result),
    );
  },
);

export default router;
