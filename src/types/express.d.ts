import type { Role } from '../../prisma/generated/client/enums';

declare global {
  namespace Express {
    interface Request {
      /** Set by requestIdMiddleware — always present */
      id: string;
      /**
       * Set by authenticate middleware after Bearer token verification.
       * Only present on routes that use `authenticate`.
       */
      user?: {
        id: string;
        role: Role;
        email: string;
      };
    }
  }
}

export {};
