import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export const requestIdMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const existing = req.header('X-Request-ID');
  const requestId = existing?.trim() ? existing.trim() : randomUUID();

  req.id = requestId;
  res.setHeader('X-Request-ID', requestId);

  next();
};
