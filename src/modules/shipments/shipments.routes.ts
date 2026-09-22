import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { authenticate } from '../../common/middleware/authenticate';
import { authorize } from '../../common/middleware/authorize';
import { calculateQuote, createShipment } from './shipments.service';
import { createShipmentSchema, quoteSchema } from './shipments.validation';

const router = Router();

// ─── POST /shipments/quote ────────────────────────────────────────────────────

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

// ─── POST /shipments ──────────────────────────────────────────────────────────

router.post(
  '/',
  authenticate,
  authorize('CUSTOMER'),
  async (req: Request, res: Response) => {
    const input = createShipmentSchema.parse(req.body);
    const result = await createShipment(req.user!.id, input, req.id);

    res.status(StatusCodes.CREATED).json(
      successResponse('Shipment created successfully', result),
    );
  },
);

export default router;
