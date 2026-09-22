import { StatusCodes } from 'http-status-codes';

export interface AppErrorDetails {
  field?: string;
  message: string;
  code?: string;
}

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errors: AppErrorDetails[];

  constructor(
    message: string,
    statusCode: number = StatusCodes.INTERNAL_SERVER_ERROR,
    errors: AppErrorDetails[] = [],
  ) {
    super(message);
    this.name = 'AppError';

    this.statusCode = statusCode;
    this.isOperational = statusCode < StatusCodes.INTERNAL_SERVER_ERROR;
    this.errors = errors;

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, AppError);
    }
  }
}

export const BadRequestError = (message = 'Bad request', errors: AppErrorDetails[] = []): AppError =>
  new AppError(message, StatusCodes.BAD_REQUEST, errors);

export const UnauthorizedError = (message = 'Unauthorized', errors: AppErrorDetails[] = []): AppError =>
  new AppError(message, StatusCodes.UNAUTHORIZED, errors);

export const ForbiddenError = (message = 'Forbidden', errors: AppErrorDetails[] = []): AppError =>
  new AppError(message, StatusCodes.FORBIDDEN, errors);

export const NotFoundError = (message = 'Resource not found', errors: AppErrorDetails[] = []): AppError =>
  new AppError(message, StatusCodes.NOT_FOUND, errors);

export const ConflictError = (message = 'Resource conflict', errors: AppErrorDetails[] = []): AppError =>
  new AppError(message, StatusCodes.CONFLICT, errors);

export const UnprocessableEntityError = (
  message = 'Unprocessable entity',
  errors: AppErrorDetails[] = [],
): AppError => new AppError(message, StatusCodes.UNPROCESSABLE_ENTITY, errors);
