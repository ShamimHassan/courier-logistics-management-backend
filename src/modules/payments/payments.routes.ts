import { Router, type Request, type Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { successResponse } from '../../common/response';
import { authenticate } from '../../common/middleware/authenticate';
import { authorize } from '../../common/middleware/authorize';
import { checkoutLimiter } from '../../common/middleware/rateLimiter';
import {
  getPaymentById,
  getPaymentByShipment,
  handleCancel,
  handleFail,
  handleIPN,
  handleSuccess,
  initiateCheckout,
  refundPayment,
  refundSchema,
} from './payments.service';
import type { SSLCommerzIPNPayload } from '../../config/sslcommerz';

const router = Router();

// ─── POST /payments/shipments/:shipmentId/checkout ────────────────────────────
// Authenticated CUSTOMER — initiates SSLCommerz session and returns gateway URL

router.post(
  '/shipments/:shipmentId/checkout',
  authenticate,
  authorize('CUSTOMER'),
  checkoutLimiter,
  async (req: Request, res: Response) => {
    const result = await initiateCheckout(
      String(req.params.shipmentId),
      req.user!.id,
      req.id,
    );
    res.status(StatusCodes.OK).json(
      successResponse('Payment session initiated successfully', result),
    );
  },
);

// ─── SSLCommerz callbacks — PUBLIC (no auth middleware) ───────────────────────
// SSLCommerz POSTs form-encoded data, so we rely on the global urlencoded parser

// IPN — authoritative server-to-server notification
router.post('/sslcommerz/ipn', async (req: Request, res: Response) => {
  const result = await handleIPN(req.body as SSLCommerzIPNPayload);
  // Always 200 — SSLCommerz retries on non-200
  res.status(StatusCodes.OK).json({ received: true, ...result });
});

// Success — browser redirect after successful payment (secondary validation)
router.post('/sslcommerz/success', async (req: Request, res: Response) => {
  const result = await handleSuccess(req.body as SSLCommerzIPNPayload);
  res.status(StatusCodes.OK).json(
    successResponse(
      result.confirmed ? 'Payment confirmed' : 'Payment pending confirmation',
      result,
    ),
  );
});

// Fail — browser redirect after failed payment
router.post('/sslcommerz/fail', async (req: Request, res: Response) => {
  await handleFail(req.body as SSLCommerzIPNPayload);
  res.status(StatusCodes.OK).json(successResponse('Payment failure recorded', null));
});

// Cancel — browser redirect when customer cancels
router.post('/sslcommerz/cancel', async (req: Request, res: Response) => {
  await handleCancel(req.body as SSLCommerzIPNPayload);
  res.status(StatusCodes.OK).json(successResponse('Payment cancellation recorded', null));
});

// ─── GET /payments/:id ────────────────────────────────────────────────────────

router.get(
  '/:id',
  authenticate,
  authorize('CUSTOMER', 'ADMIN'),
  async (req: Request, res: Response) => {
    const payment = await getPaymentById(String(req.params.id), req.user!.id, req.user!.role);
    res.status(StatusCodes.OK).json(successResponse('Payment retrieved successfully', { payment }));
  },
);

// ─── GET /payments/shipments/:shipmentId ──────────────────────────────────────

router.get(
  '/shipments/:shipmentId',
  authenticate,
  authorize('CUSTOMER', 'ADMIN'),
  async (req: Request, res: Response) => {
    const payment = await getPaymentByShipment(
      String(req.params.shipmentId),
      req.user!.id,
      req.user!.role,
    );
    res.status(StatusCodes.OK).json(successResponse('Payment retrieved successfully', { payment }));
  },
);

// ─── POST /payments/:id/refund — Step 27 ─────────────────────────────────────

router.post(
  '/:id/refund',
  authenticate,
  authorize('ADMIN'),
  async (req: Request, res: Response) => {
    const input = refundSchema.parse(req.body);
    const result = await refundPayment(
      String(req.params.id),
      input,
      req.user!.id,
      req.id,
    );
    res.status(StatusCodes.OK).json(
      successResponse('Payment refunded successfully', result),
    );
  },
);

export default router;
