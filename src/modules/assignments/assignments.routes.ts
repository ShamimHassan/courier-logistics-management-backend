import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { authenticate } from '../../common/middleware/authenticate';
import { authorize } from '../../common/middleware/authorize';
import { acceptAssignment, rejectAssignment } from './assignments.service';
import { rejectAssignmentSchema } from './assignments.validation';

const router = Router();

// All assignment routes require COURIER role
router.use(authenticate, authorize('COURIER'));

// ─── PATCH /assignments/:id/accept ────────────────────────────────────────────

router.patch(
  '/:id/accept',
  async (req: Request, res: Response) => {
    const result = await acceptAssignment(
      String(req.params.id),
      req.user!.id,
      req.id,
    );

    res.status(StatusCodes.OK).json(
      successResponse('Assignment accepted successfully', result),
    );
  },
);

// ─── PATCH /assignments/:id/reject ────────────────────────────────────────────

router.patch(
  '/:id/reject',
  async (req: Request, res: Response) => {
    const payload = rejectAssignmentSchema.parse(req.body);
    const result = await rejectAssignment(
      String(req.params.id),
      req.user!.id,
      payload,
      req.id,
    );

    res.status(StatusCodes.OK).json(
      successResponse('Assignment rejected successfully', result),
    );
  },
);

export default router;
