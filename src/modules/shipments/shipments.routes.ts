import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { authenticate } from '../../common/middleware/authenticate';
import { authorize } from '../../common/middleware/authorize';
import {
  calculateQuote,
  cancelShipment,
  createShipment,
  getShipmentById,
  getShipmentTracking,
  listShipments,
  pickupShipment,
  searchShipments,
  transitionShipmentStatus,
  updateShipment,
} from './shipments.service';
import {
  cancelShipmentSchema,
  createShipmentSchema,
  listShipmentsSchema,
  pickupSchema,
  quoteSchema,
  searchShipmentsSchema,
  statusTransitionSchema,
  updateShipmentSchema,
} from './shipments.validation';

const router = Router();

// ─── POST /shipments/quote ────────────────────────────────────────────────────

router.post(
  '/quote',
  authenticate,
  authorize('CUSTOMER'),
  async (req: Request, res: Response) => {
    const input = quoteSchema.parse(req.body);
    const quote = await calculateQuote(input);
    res.status(StatusCodes.OK).json(successResponse('Quote calculated successfully', quote));
  },
);

// ─── GET /shipments/search — Step 16 ─────────────────────────────────────────
// Must be before /:id to avoid route collision

router.get(
  '/search',
  authenticate,
  authorize('CUSTOMER', 'ADMIN'),
  async (req: Request, res: Response) => {
    const query = searchShipmentsSchema.parse(req.query);
    const result = await searchShipments(query, req.user!.id, req.user!.role);
    res.status(StatusCodes.OK).json(successResponse('Search results', result));
  },
);

// ─── GET /shipments — Step 15 ─────────────────────────────────────────────────

router.get(
  '/',
  authenticate,
  authorize('CUSTOMER', 'ADMIN'),
  async (req: Request, res: Response) => {
    const query = listShipmentsSchema.parse(req.query);
    const ownerId = req.user!.role === 'CUSTOMER' ? req.user!.id : undefined;
    const result = await listShipments(query, ownerId);
    res.status(StatusCodes.OK).json(successResponse('Shipments retrieved successfully', result));
  },
);

// ─── GET /shipments/my — Step 15 alias ───────────────────────────────────────

router.get(
  '/my',
  authenticate,
  authorize('CUSTOMER'),
  async (req: Request, res: Response) => {
    const query = listShipmentsSchema.parse(req.query);
    const result = await listShipments(query, req.user!.id);
    res.status(StatusCodes.OK).json(successResponse('Your shipments retrieved successfully', result));
  },
);

// ─── POST /shipments — Step 14 ───────────────────────────────────────────────

router.post(
  '/',
  authenticate,
  authorize('CUSTOMER'),
  async (req: Request, res: Response) => {
    const input = createShipmentSchema.parse(req.body);
    const result = await createShipment(req.user!.id, input, req.id);
    res.status(StatusCodes.CREATED).json(successResponse('Shipment created successfully', result));
  },
);

// ─── GET /shipments/:id/tracking — Step 18 ───────────────────────────────────
// Must be registered BEFORE /:id to avoid Express matching /:id first

router.get(
  '/:id/tracking',
  authenticate,
  authorize('CUSTOMER', 'COURIER', 'ADMIN'),
  async (req: Request, res: Response) => {
    const events = await getShipmentTracking(
      String(req.params.id),
      req.user!.id,
      req.user!.role,
    );

    res.status(StatusCodes.OK).json(
      successResponse('Tracking timeline retrieved successfully', { events }),
    );
  },
);

// ─── GET /shipments/:id — Step 16 ────────────────────────────────────────────

router.get(
  '/:id',
  authenticate,
  authorize('CUSTOMER', 'COURIER', 'ADMIN'),
  async (req: Request, res: Response) => {
    const shipment = await getShipmentById(String(req.params.id), req.user!.id, req.user!.role);
    res.status(StatusCodes.OK).json(successResponse('Shipment retrieved successfully', { shipment }));
  },
);

// ─── POST /shipments/:id/pickup — Step 21 ────────────────────────────────────
// Must be before PATCH /:id to avoid collision

router.post(
  '/:id/pickup',
  authenticate,
  authorize('COURIER'),
  async (req: Request, res: Response) => {
    const payload = pickupSchema.parse(req.body);
    const result = await pickupShipment(String(req.params.id), req.user!.id, payload, req.id);
    res.status(StatusCodes.OK).json(successResponse('Shipment picked up successfully', result));
  },
);

// ─── PATCH /shipments/:id/status — Step 21 ───────────────────────────────────
// Must be before PATCH /:id to avoid collision

router.patch(
  '/:id/status',
  authenticate,
  authorize('COURIER', 'ADMIN'),
  async (req: Request, res: Response) => {
    const payload = statusTransitionSchema.parse(req.body);
    const result = await transitionShipmentStatus(
      String(req.params.id),
      req.user!.id,
      req.user!.role,
      payload,
      req.id,
    );
    res.status(StatusCodes.OK).json(successResponse('Shipment status updated successfully', result));
  },
);

// ─── PATCH /shipments/:id — Step 17 ──────────────────────────────────────────

router.patch(
  '/:id',
  authenticate,
  authorize('CUSTOMER', 'ADMIN'),
  async (req: Request, res: Response) => {
    const payload = updateShipmentSchema.parse(req.body);
    const shipment = await updateShipment(String(req.params.id), req.user!.id, req.user!.role, payload, req.id);
    res.status(StatusCodes.OK).json(successResponse('Shipment updated successfully', { shipment }));
  },
);

// ─── POST /shipments/:id/cancel — Step 17 ────────────────────────────────────

router.post(
  '/:id/cancel',
  authenticate,
  authorize('CUSTOMER', 'ADMIN'),
  async (req: Request, res: Response) => {
    const payload = cancelShipmentSchema.parse(req.body);
    const result = await cancelShipment(String(req.params.id), req.user!.id, req.user!.role, payload, req.id);
    res.status(StatusCodes.OK).json(successResponse('Shipment cancelled successfully', result));
  },
);

// ─── DELETE /shipments/:id — Step 17 (alias for cancel) ──────────────────────

router.delete(
  '/:id',
  authenticate,
  authorize('CUSTOMER', 'ADMIN'),
  async (req: Request, res: Response) => {
    const payload = cancelShipmentSchema.parse(req.body);
    const result = await cancelShipment(String(req.params.id), req.user!.id, req.user!.role, payload, req.id);
    res.status(StatusCodes.OK).json(successResponse('Shipment cancelled successfully', result));
  },
);

export default router;
