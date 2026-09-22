import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { authenticate } from '../../common/middleware/authenticate';
import { authorize } from '../../common/middleware/authorize';
import { calculateQuote, createShipment, listShipments } from './shipments.service';
import { createShipmentSchema, listShipmentsSchema, quoteSchema } from './shipments.validation';

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

// ─── GET /shipments — CUSTOMER (own) + ADMIN (all) ───────────────────────────

router.get(
  '/',
  authenticate,
  authorize('CUSTOMER', 'ADMIN'),
  async (req: Request, res: Response) => {
    const query = listShipmentsSchema.parse(req.query);
    // CUSTOMER always scoped to own shipments; ADMIN sees all
    const ownerId = req.user!.role === 'CUSTOMER' ? req.user!.id : undefined;
    const result = await listShipments(query, ownerId);

    res.status(StatusCodes.OK).json(
      successResponse('Shipments retrieved successfully', result),
    );
  },
);

// ─── GET /shipments/my — explicit customer-scoped alias ──────────────────────
// Must be defined before /:id to avoid route collision

router.get(
  '/my',
  authenticate,
  authorize('CUSTOMER'),
  async (req: Request, res: Response) => {
    const query = listShipmentsSchema.parse(req.query);
    const result = await listShipments(query, req.user!.id);

    res.status(StatusCodes.OK).json(
      successResponse('Your shipments retrieved successfully', result),
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
