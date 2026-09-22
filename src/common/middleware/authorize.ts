import type { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import type { Role } from '../../../prisma/generated/client/enums';
import { errorResponse } from '../response';

/**
 * authorize — Role-based access control middleware factory
 *
 * Usage:
 *   router.get('/admin/route', authenticate, authorize('ADMIN'), handler)
 *   router.patch('/route',     authenticate, authorize('ADMIN', 'COURIER'), handler)
 *
 * IMPORTANT: This middleware only checks the role from the JWT.
 * Ownership / fine-grained resource checks (e.g. "can this customer
 * access THEIR OWN shipment?") must be enforced in the SERVICE layer,
 * not here. This middleware is intentionally coarse-grained.
 *
 * Always mount `authenticate` before `authorize` — this middleware
 * assumes `req.user` is already populated.
 */
export const authorize = (...allowedRoles: Role[]) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    // authenticate must run first; if it didn't, req.user is undefined
    if (!req.user) {
      res.status(StatusCodes.UNAUTHORIZED).json(
        errorResponse(
          'Authentication required',
          [{ code: 'MISSING_TOKEN', message: 'You must be authenticated to access this resource' }],
          req.id,
        ),
      );
      return;
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(StatusCodes.FORBIDDEN).json(
        errorResponse(
          'Insufficient permissions',
          [
            {
              code: 'FORBIDDEN',
              message: `This action requires one of the following roles: ${allowedRoles.join(', ')}`,
            },
          ],
          req.id,
        ),
      );
      return;
    }

    next();
  };
};
