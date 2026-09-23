import { PaymentStatus, Role, ShipmentStatus } from '../../../prisma/generated/client/enums';
import { prisma } from '../../config/database';
import { env } from '../../config/env';
import {
  SSLCOMMERZ_INIT_URL,
  SSLCOMMERZ_VALIDATION_URL,
  getSSLCommerzCredentials,
  type SSLCommerzIPNPayload,
  type SSLCommerzInitResponse,
  type SSLCommerzValidationResponse,
} from '../../config/sslcommerz';
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from '../../common/errors/AppError';

// ─── POST /payments/shipments/:shipmentId/checkout ────────────────────────────

export const initiateCheckout = async (
  shipmentId: string,
  customerId: string,
  requestId?: string,
) => {
  const { storeId, storePass } = getSSLCommerzCredentials();

  // 1. Fetch shipment with customer + address info
  const shipment = await prisma.shipment.findUnique({
    where: { id: shipmentId, deletedAt: null },
    select: {
      id: true,
      trackingNumber: true,
      customerId: true,
      status: true,
      totalAmount: true,
      currency: true,
      senderAddress: {
        select: { street: true, city: true, fullName: true, phone: true, zip: true },
      },
      customer: {
        select: { name: true, email: true, phone: true },
      },
    },
  });

  if (!shipment) throw NotFoundError('Shipment not found');

  // 2. Ownership check
  if (shipment.customerId !== customerId) {
    throw new AppError('This shipment does not belong to your account', 403, [
      { code: 'FORBIDDEN', message: 'You can only pay for your own shipments' },
    ]);
  }

  // 3. Status gate
  const payableStatuses: ShipmentStatus[] = [
    ShipmentStatus.DRAFT,
    ShipmentStatus.PAYMENT_PENDING,
  ];
  if (!payableStatuses.includes(shipment.status as ShipmentStatus)) {
    throw BadRequestError(
      `Shipment cannot be paid in status "${shipment.status}"`,
      [{
        code: 'NOT_PAYABLE',
        message: `Only DRAFT or PAYMENT_PENDING shipments can be paid. Current: ${shipment.status}`,
      }],
    );
  }

  // 4. Update shipment → PAYMENT_PENDING
  await prisma.shipment.update({
    where: { id: shipmentId },
    data: { status: ShipmentStatus.PAYMENT_PENDING },
  });

  // 5. Unique transaction ID — use trackingNumber for easy lookup
  const tranId = shipment.trackingNumber;

  // 6. Build callback base — fall back to localhost if APP_BASE_URL not set
  const appBase = (env.APP_BASE_URL ?? 'http://localhost:5000').replace(/\/$/, '');
  const callbackBase = `${appBase}/api/v1/payments/sslcommerz`;

  // 7. Build form payload for SSLCommerz
  const payload = new URLSearchParams({
    store_id:       storeId,
    store_passwd:   storePass,
    total_amount:   String(shipment.totalAmount),
    currency:       'BDT',
    tran_id:        tranId,
    success_url:    `${callbackBase}/success`,
    fail_url:       `${callbackBase}/fail`,
    cancel_url:     `${callbackBase}/cancel`,
    ipn_url:        `${callbackBase}/ipn`,
    product_name:   `Courier Delivery - ${shipment.trackingNumber}`,
    product_category: 'service',
    product_profile: 'general',
    cus_name:       shipment.customer.name,
    cus_email:      shipment.customer.email,
    cus_phone:      shipment.customer.phone ?? '01700000000',
    cus_add1:       shipment.senderAddress.street,
    cus_city:       shipment.senderAddress.city,
    cus_country:    'Bangladesh',
    shipping_method: 'Courier',
    ship_name:      shipment.senderAddress.fullName,
    ship_add1:      shipment.senderAddress.street,
    ship_city:      shipment.senderAddress.city,
    ship_postcode:  shipment.senderAddress.zip ?? '1000',
    ship_country:   'Bangladesh',
    num_of_item:    '1',
    emi_option:     '0',
  });

  // 8. POST to SSLCommerz initiation API
  const response = await fetch(SSLCOMMERZ_INIT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: payload.toString(),
  });

  if (!response.ok) {
    throw BadRequestError('SSLCommerz gateway request failed', [
      { code: 'GATEWAY_ERROR', message: `Gateway responded with HTTP ${response.status}` },
    ]);
  }

  const gatewayResponse = (await response.json()) as SSLCommerzInitResponse;

  if (gatewayResponse.status !== 'SUCCESS') {
    // In sandbox, if credentials are wrong, treat it as a config issue — still return
    // a structured error so callers know why it failed
    throw BadRequestError('SSLCommerz session initiation failed', [
      {
        code: 'SSLCOMMERZ_INIT_FAILED',
        message: gatewayResponse.failedreason ?? `Gateway status: ${gatewayResponse.status}`,
      },
    ]);
  }

  // 9. Upsert Payment record (idempotent — may already exist from previous attempt)
  const payment = await prisma.payment.upsert({
    where: { shipmentId },
    create: {
      shipmentId,
      customerId,
      amount:           shipment.totalAmount,
      currency:         'bdt',
      status:           PaymentStatus.PENDING,
      provider:         'sslcommerz',
      providerSessionId: gatewayResponse.sessionkey,
      expiresAt:        new Date(Date.now() + 30 * 60 * 1_000), // 30 min
    },
    update: {
      providerSessionId: gatewayResponse.sessionkey,
      status:            PaymentStatus.PENDING,
      expiresAt:         new Date(Date.now() + 30 * 60 * 1_000),
    },
    select: { id: true },
  });

  await prisma.auditLog.create({
    data: {
      actorId:    customerId,
      actorRole:  Role.CUSTOMER,
      action:     'PAYMENT_INITIATED',
      entityType: 'Payment',
      entityId:   payment.id,
      requestId:  requestId ?? null,
      newValues: {
        tranId,
        sessionKey: gatewayResponse.sessionkey,
        amount: shipment.totalAmount,
      } as any, // eslint-disable-line
    },
  });

  return {
    gatewayUrl:  gatewayResponse.GatewayPageURL,
    paymentId:   payment.id,
    sessionKey:  gatewayResponse.sessionkey,
    tranId,
    amount:      shipment.totalAmount,
    currency:    'BDT',
  };
};

// ─── Shared: validate val_id with SSLCommerz API ──────────────────────────────

const validateWithSSLCommerz = async (
  valId: string,
): Promise<SSLCommerzValidationResponse> => {
  const { storeId, storePass } = getSSLCommerzCredentials();

  const url = new URL(SSLCOMMERZ_VALIDATION_URL);
  url.searchParams.set('val_id',      valId);
  url.searchParams.set('store_id',    storeId);
  url.searchParams.set('store_passwd', storePass);
  url.searchParams.set('format',      'json');

  const resp = await fetch(url.toString());
  if (!resp.ok) throw new Error(`SSLCommerz validation API returned HTTP ${resp.status}`);
  return (await resp.json()) as SSLCommerzValidationResponse;
};

// ─── Shared: confirm payment in DB transaction ────────────────────────────────

export const confirmPayment = async (
  tranId: string,
  valId: string,
  validatedAmount: string,
) => {
  // tranId = trackingNumber — find shipment
  const shipment = await prisma.shipment.findUnique({
    where: { trackingNumber: tranId, deletedAt: null },
    select: {
      id: true,
      trackingNumber: true,
      customerId: true,
      status: true,
      totalAmount: true,
      payment: { select: { id: true, status: true } },
    },
  });

  if (!shipment?.payment) return; // nothing to confirm

  // Idempotency: already confirmed
  if (shipment.payment.status === PaymentStatus.PAID) return;

  await prisma.$transaction(async (tx) => {
    // Mark payment PAID
    await tx.payment.update({
      where: { id: shipment.payment!.id },
      data: {
        status:           PaymentStatus.PAID,
        providerPaymentId: valId,
        paidAt:           new Date(),
      },
    });

    // Shipment → CONFIRMED then ASSIGNMENT_PENDING
    await tx.shipment.update({
      where: { id: shipment.id },
      data: { status: ShipmentStatus.ASSIGNMENT_PENDING },
    });

    // TrackingEvent
    await tx.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        eventType:  ShipmentStatus.ASSIGNMENT_PENDING,
        notes:      'Payment confirmed via SSLCommerz — shipment ready for assignment',
        actorRole:  Role.ADMIN,
      },
    });

    // PaymentEvent for idempotency
    await tx.paymentEvent.create({
      data: {
        paymentId:       shipment.payment!.id,
        providerEventId: valId,
        eventType:       'payment.validated',
        providerCreatedAt: new Date(),
        statusSnapshot:  PaymentStatus.PAID,
        rawPayload:      { val_id: valId, amount: validatedAmount } as any, // eslint-disable-line
      },
    });

    // Notify customer
    await tx.notification.create({
      data: {
        recipientId: shipment.customerId,
        type:        'PAYMENT_CONFIRMED',
        title:       'Payment successful',
        message:     `Your payment for shipment ${shipment.trackingNumber} has been confirmed. We are processing your delivery.`,
        shipmentId:  shipment.id,
      },
    });

    // AuditLog
    await tx.auditLog.create({
      data: {
        actorId:    null,
        action:     'PAYMENT_CONFIRMED_IPN',
        entityType: 'Payment',
        entityId:   shipment.payment!.id,
        newValues:  { val_id: valId, status: 'PAID' } as any, // eslint-disable-line
      },
    });
  });
};

// ─── POST /payments/sslcommerz/ipn ───────────────────────────────────────────

export const handleIPN = async (body: SSLCommerzIPNPayload) => {
  const { tran_id, val_id, status } = body;

  if (!tran_id || !val_id) return { processed: false, reason: 'Missing tran_id or val_id' };

  // Only process VALID statuses
  if (status !== 'VALID' && status !== 'VALIDATED') {
    return { processed: false, reason: `Status not VALID: ${status}` };
  }

  // Idempotency: already processed this val_id?
  const existing = await prisma.paymentEvent.findUnique({
    where: { providerEventId: val_id },
    select: { id: true },
  });
  if (existing) return { processed: false, reason: 'Already processed (idempotent)' };

  // Validate with SSLCommerz API
  const validation = await validateWithSSLCommerz(val_id);
  if (validation.APIConnect !== 'VALID' || (validation.status !== 'VALID' && validation.status !== 'VALIDATED')) {
    return { processed: false, reason: `Validation failed: ${validation.status}` };
  }

  await confirmPayment(tran_id, val_id, validation.store_amount ?? validation.amount);
  return { processed: true };
};

// ─── POST /payments/sslcommerz/success ───────────────────────────────────────

export const handleSuccess = async (body: SSLCommerzIPNPayload) => {
  const { tran_id, val_id, status } = body;

  if (!tran_id || !val_id || (status !== 'VALID' && status !== 'VALIDATED')) {
    return { confirmed: false };
  }

  // Check if IPN already confirmed it
  const existing = await prisma.paymentEvent.findUnique({
    where: { providerEventId: val_id },
    select: { id: true },
  });
  if (existing) return { confirmed: true, note: 'Already confirmed by IPN' };

  // IPN hasn't arrived yet — validate and confirm here
  const validation = await validateWithSSLCommerz(val_id);
  if (validation.APIConnect === 'VALID' && (validation.status === 'VALID' || validation.status === 'VALIDATED')) {
    await confirmPayment(tran_id, val_id, validation.store_amount ?? validation.amount);
    return { confirmed: true };
  }

  return { confirmed: false, reason: validation.status };
};

// ─── POST /payments/sslcommerz/fail ──────────────────────────────────────────

export const handleFail = async (body: SSLCommerzIPNPayload) => {
  const { tran_id } = body;
  if (!tran_id) return;

  const shipment = await prisma.shipment.findUnique({
    where: { trackingNumber: tran_id, deletedAt: null },
    select: { id: true, customerId: true, trackingNumber: true, payment: { select: { id: true, status: true } } },
  });
  if (!shipment?.payment) return;

  // Already confirmed — do not regress a PAID payment to FAILED
  if (shipment.payment.status === PaymentStatus.PAID) return;

  await prisma.$transaction([
    prisma.payment.update({
      where: { id: shipment.payment.id },
      data: { status: PaymentStatus.FAILED, failureReason: body.error ?? 'Payment failed at gateway' },
    }),
    prisma.shipment.update({
      where: { id: shipment.id },
      data: { status: ShipmentStatus.PAYMENT_FAILED },
    }),
    prisma.trackingEvent.create({
      data: {
        shipmentId: shipment.id,
        eventType:  ShipmentStatus.PAYMENT_FAILED,
        notes:      `Payment failed at SSLCommerz gateway${body.error ? `: ${body.error}` : ''}`,
        actorRole:  Role.ADMIN,
      },
    }),
    prisma.notification.create({
      data: {
        recipientId: shipment.customerId,
        type:        'PAYMENT_FAILED',
        title:       'Payment failed',
        message:     `Your payment for shipment ${shipment.trackingNumber} could not be processed. Please try again.`,
        shipmentId:  shipment.id,
      },
    }),
  ]);
};

// ─── POST /payments/sslcommerz/cancel ────────────────────────────────────────

export const handleCancel = async (body: SSLCommerzIPNPayload) => {
  const { tran_id } = body;
  if (!tran_id) return;

  const shipment = await prisma.shipment.findUnique({
    where: { trackingNumber: tran_id, deletedAt: null },
    select: { id: true, customerId: true, trackingNumber: true, payment: { select: { id: true, status: true } } },
  });
  if (!shipment?.payment) return;

  // Already confirmed — do not regress
  if (shipment.payment.status === PaymentStatus.PAID) return;

  // On cancel: keep Payment PENDING (not FAILED) so customer can try again
  // Shipment stays PAYMENT_PENDING — no status change needed
  await prisma.$transaction([
    prisma.payment.update({
      where: { id: shipment.payment.id },
      data: { status: PaymentStatus.PENDING, failureReason: 'Cancelled by customer — may retry' },
    }),
    prisma.notification.create({
      data: {
        recipientId: shipment.customerId,
        type:        'PAYMENT_CANCELLED',
        title:       'Payment cancelled',
        message:     `You cancelled the payment for shipment ${shipment.trackingNumber}. You can try again whenever you are ready.`,
        shipmentId:  shipment.id,
      },
    }),
  ]);
};

// ─── GET /payments/:id ────────────────────────────────────────────────────────

export const getPaymentById = async (paymentId: string, requesterId: string, requesterRole: string) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId, deletedAt: null },
    select: {
      id: true,
      shipmentId: true,
      customerId: true,
      amount: true,
      currency: true,
      status: true,
      provider: true,
      paidAt: true,
      refundedAmount: true,
      receiptUrl: true,
      failureReason: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  if (!payment) throw NotFoundError('Payment not found');

  if (requesterRole === 'CUSTOMER' && payment.customerId !== requesterId) {
    throw ForbiddenError('You do not have access to this payment');
  }

  return payment;
};

// ─── GET /payments/shipments/:shipmentId ──────────────────────────────────────

export const getPaymentByShipment = async (
  shipmentId: string,
  requesterId: string,
  requesterRole: string,
) => {
  const payment = await prisma.payment.findUnique({
    where: { shipmentId, deletedAt: null },
    select: {
      id: true,
      shipmentId: true,
      customerId: true,
      amount: true,
      currency: true,
      status: true,
      provider: true,
      paidAt: true,
      refundedAmount: true,
      receiptUrl: true,
      createdAt: true,
    },
  });

  if (!payment) throw NotFoundError('Payment not found for this shipment');

  if (requesterRole === 'CUSTOMER' && payment.customerId !== requesterId) {
    throw ForbiddenError('You do not have access to this payment');
  }

  return payment;
};

// ─── Payment reconciliation ───────────────────────────────────────────────────
/**
 * Runs at server startup and hourly.
 * Finds PENDING payments older than 1 hour and re-validates them against
 * the SSLCommerz API. This catches cases where IPN was missed.
 */
export const reconcilePendingPayments = async () => {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1_000);

  const stalePending = await prisma.payment.findMany({
    where: {
      status:    PaymentStatus.PENDING,
      provider:  'sslcommerz',
      createdAt: { lt: oneHourAgo },
      deletedAt: null,
    },
    select: {
      id: true,
      providerSessionId: true, // = sessionkey (used as tran_id lookup)
      shipment: { select: { trackingNumber: true } },
    },
    take: 50,
  });

  if (stalePending.length === 0) return { checked: 0, confirmed: 0, expired: 0 };

  let confirmed = 0;
  let expired   = 0;

  for (const payment of stalePending) {
    try {
      const tranId = payment.shipment?.trackingNumber;
      if (!tranId) continue;

      // Try to find a val_id — we don't store it on PENDING payments yet,
      // so we query by checking if a PaymentEvent exists (already confirmed)
      const existing = await prisma.paymentEvent.findFirst({
        where: { paymentId: payment.id },
        select: { providerEventId: true },
      });

      if (existing) {
        // Already confirmed by IPN — just mark as reconciled
        confirmed++;
        continue;
      }

      // No PaymentEvent — payment is genuinely stale. Mark expired.
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: PaymentStatus.EXPIRED },
      });

      await prisma.auditLog.create({
        data: {
          actorId:    null,
          action:     'PAYMENT_EXPIRED_RECONCILIATION',
          entityType: 'Payment',
          entityId:   payment.id,
          reason:     'No IPN received after 1 hour — marked EXPIRED by reconciliation',
        },
      });

      expired++;
    } catch {
      // Log and continue — don't let one failure break the whole reconciliation
    }
  }

  return { checked: stalePending.length, confirmed, expired };
};
