import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import jwt from 'jsonwebtoken';
import { errorResponse } from '../response';
import { verifyAccessToken } from '../../modules/auth/auth.token';

/**
 * authenticate — Bearer token middleware
 *
 * Extracts and verifies the JWT from the `Authorization: Bearer <token>` header.
 * On success attaches `req.user = { id, role, email }` and calls next().
 * On failure responds immediately with 401 — never calls next(err) for auth
 * failures so downstream error handlers don't accidentally expose stack traces.
 */
export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization ?? '';

  if (!authHeader.startsWith('Bearer ')) {
    res.status(StatusCodes.UNAUTHORIZED).json(
      errorResponse(
        'Authentication required',
        [{ code: 'MISSING_TOKEN', message: 'Authorization: Bearer <token> header is required' }],
        req.id,
      ),
    );
    return;
  }

  const token = authHeader.slice(7).trim();

  if (!token) {
    res.status(StatusCodes.UNAUTHORIZED).json(
      errorResponse(
        'Authentication required',
        [{ code: 'MISSING_TOKEN', message: 'Bearer token is empty' }],
        req.id,
      ),
    );
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
    next();
  } catch (err) {
    // Distinguish expired from other JWT errors for clearer client messaging
    const isExpired = err instanceof jwt.TokenExpiredError;
    res.status(StatusCodes.UNAUTHORIZED).json(
      errorResponse(
        isExpired ? 'Access token has expired' : 'Invalid access token',
        [
          {
            code: isExpired ? 'TOKEN_EXPIRED' : 'TOKEN_INVALID',
            message: isExpired
              ? 'Your session has expired. Use /auth/refresh-token to get a new access token.'
              : 'The provided token is malformed or its signature is invalid.',
          },
        ],
        req.id,
      ),
    );
  }
};

/**
 * authenticateOptional — same as authenticate but never rejects the request.
 * If a valid token is present it populates req.user; otherwise just calls next().
 * Used on routes that work both authenticated and unauthenticated (e.g. logout).
 */
export const authenticateOptional = (
  req: Request,
  _res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization ?? '';

  if (!authHeader.startsWith('Bearer ')) {
    next();
    return;
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    next();
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.user = { id: payload.sub, role: payload.role, email: payload.email };
  } catch {
    // Invalid or expired — silently ignore, logout still proceeds
  }

  next();
};
