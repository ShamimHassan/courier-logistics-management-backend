import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { authenticate } from '../../common/middleware/authenticate';
import { authorize } from '../../common/middleware/authorize';
import { calculateQuote } from './shipments.service';
import { quoteSchema } from './shipments.validation';

const router = Router();

// ─── POST /shipments/quote ────────────────────────────────────────────────────
// Only authenticated CUSTOMER role can request a quote.
// The price is ALWAYS server-calculated — client cannot override.

router.post(
  '/quote',
  authenticate,
  authorize('CUSTOMER'),
  async (req: Request, res: Response) => {
    const input = quoteSchema.parse(req.body);
    const quote = await calculateQuote(input);

    res.status(StatusCodes.OK).json(
      successResponse('Quote calculated successfully', quote),
    );
  },
);

export default router;
