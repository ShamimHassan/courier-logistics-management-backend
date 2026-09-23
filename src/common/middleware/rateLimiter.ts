import rateLimit from 'express-rate-limit';

/**
 * Global rate limiter — 100 requests per minute per IP.
 * Applied to all routes in app.ts.
 */
export const globalLimiter = rateLimit({
  windowMs:       60 * 1_000, // 1 minute
  max:            100,
  standardHeaders: 'draft-7',
  legacyHeaders:  false,
  message: {
    success: false,
    message: 'Too many requests — please slow down',
    errors:  [{ code: 'RATE_LIMIT_EXCEEDED', message: 'You have exceeded the request limit. Try again in a minute.' }],
  },
  skip: (req) => {
    // Skip rate limiting for SSLCommerz IPN/callback endpoints (server-to-server)
    return req.path.startsWith('/api/v1/payments/sslcommerz/');
  },
});

/**
 * Strict limiter for auth endpoints — 5 requests per minute per IP.
 * Applied to login and register routes.
 */
export const authLimiter = rateLimit({
  windowMs:       60 * 1_000,
  max:            5,
  standardHeaders: 'draft-7',
  legacyHeaders:  false,
  message: {
    success: false,
    message: 'Too many login attempts',
    errors:  [{ code: 'AUTH_RATE_LIMIT_EXCEEDED', message: 'Too many login attempts. Please wait a minute before trying again.' }],
  },
});

/**
 * Checkout limiter — 10 requests per minute per IP.
 * Applied to the payment checkout initiation endpoint.
 */
export const checkoutLimiter = rateLimit({
  windowMs:       60 * 1_000,
  max:            10,
  standardHeaders: 'draft-7',
  legacyHeaders:  false,
  message: {
    success: false,
    message: 'Too many payment attempts',
    errors:  [{ code: 'CHECKOUT_RATE_LIMIT_EXCEEDED', message: 'Too many checkout attempts. Please wait a minute.' }],
  },
});
