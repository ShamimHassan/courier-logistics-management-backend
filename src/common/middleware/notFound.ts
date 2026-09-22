import { Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { errorResponse } from '../response';

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(StatusCodes.NOT_FOUND).json(
    errorResponse(
      `Route ${req.method} ${req.originalUrl} not found`,
      [
        {
          field: 'path',
          message: `No route matches ${req.method} ${req.originalUrl}`,
          code: 'ROUTE_NOT_FOUND',
        },
      ],
      req.id,
    ),
  );
};
