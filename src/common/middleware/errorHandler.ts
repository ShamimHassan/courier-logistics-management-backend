import { NextFunction, Request, Response } from 'express';
import { StatusCodes } from 'http-status-codes';
import { ZodError } from 'zod';
import { AppError } from '../errors/AppError';
import { errorResponse } from '../response';
import { isProduction } from '../../config/env';

interface PrismaLikeError extends Error {
  code?: string;
  meta?: { target?: string[]; [k: string]: unknown };
  clientVersion?: string;
}

interface PrismaValidationLikeError extends Error {
  name: string;
}

const formatZodError = (err: ZodError<unknown>) => {
  return err.issues.map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join('.') : undefined;
    let message = issue.message;
    if (issue.code === 'invalid_type' && issue.message === 'Required') {
      message = `${field ?? 'This field'} is required`;
    }
    return { field, message, code: `ZOD_${issue.code.toUpperCase()}` };
  });
};

const formatPrismaKnownError = (err: PrismaLikeError) => {
  const target = err.meta?.target ?? [];
  const field = target.length > 0 ? target.join('.') : undefined;

  switch (err.code) {
    case 'P2002':
      return {
        statusCode: StatusCodes.CONFLICT,
        message: 'Unique constraint violation',
        errors: [
          {
            field,
            message: field
              ? `A record with this ${field} already exists`
              : 'A record with the same unique key already exists',
            code: 'PRISMA_P2002',
          },
        ],
      };
    case 'P2025':
      return {
        statusCode: StatusCodes.NOT_FOUND,
        message: 'Record not found',
        errors: [{ field, message: 'The requested record does not exist', code: 'PRISMA_P2025' }],
      };
    case 'P2003':
      return {
        statusCode: StatusCodes.BAD_REQUEST,
        message: 'Foreign key constraint violation',
        errors: [
          {
            field,
            message: field ? `Referenced ${field} does not exist` : 'Referenced record does not exist',
            code: 'PRISMA_P2003',
          },
        ],
      };
    case 'P2014':
      return {
        statusCode: StatusCodes.CONFLICT,
        message: 'Record cannot be changed because of related records',
        errors: [
          {
            field,
            message: 'Change would violate required relation (onDelete: Restrict)',
            code: 'PRISMA_P2014',
          },
        ],
      };
    default:
      return {
        statusCode: StatusCodes.INTERNAL_SERVER_ERROR,
        message: 'Database error',
        errors: [
          {
            field,
            message: isProduction ? 'An unexpected database error occurred' : err.message,
            code: err.code ? `PRISMA_${err.code}` : 'PRISMA_UNKNOWN',
          },
        ],
      };
  }
};

const isPrismaKnown = (e: unknown): e is PrismaLikeError => {
  if (typeof e !== 'object' || e === null || !('code' in e)) return false;
  const code = (e as PrismaLikeError).code;
  return typeof code === 'string' && /^P[2-5]\d{3}$/.test(code);
};

const isPrismaValidation = (e: unknown): e is PrismaValidationLikeError =>
  e instanceof Error && e.name === 'PrismaClientValidationError';

const isJsonSyntaxError = (e: unknown): e is SyntaxError & { body: unknown } =>
  e instanceof SyntaxError && 'body' in e;

interface AppErrorLike extends Error {
  statusCode: number;
  isOperational?: boolean;
  errors: AppError['errors'];
}

const isAppErrorLike = (e: unknown): e is AppErrorLike =>
  (e instanceof AppError) ||
  (e instanceof Error &&
    (e.name === 'AppError' ||
      ('statusCode' in e &&
        typeof (e as any).statusCode === 'number' &&
        'errors' in e &&
        Array.isArray((e as any).errors))));

export const errorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  let statusCode = StatusCodes.INTERNAL_SERVER_ERROR;
  let message = 'An unexpected error occurred';
  let errors: { field?: string; message: string; code?: string }[] = [];
  let stack: string | undefined;

  if (isAppErrorLike(err)) {
    statusCode = err.statusCode;
    message = err.message;
    errors = err.errors;
  } else if (err instanceof ZodError) {
    statusCode = StatusCodes.BAD_REQUEST;
    message = 'Validation failed';
    errors = formatZodError(err);
  } else if (isPrismaKnown(err)) {
    const formatted = formatPrismaKnownError(err);
    statusCode = formatted.statusCode;
    message = formatted.message;
    errors = formatted.errors;
  } else if (isPrismaValidation(err)) {
    statusCode = StatusCodes.BAD_REQUEST;
    message = 'Invalid database query';
    errors = [
      {
        message: isProduction
          ? 'Request could not be processed due to invalid input'
          : err.message.split('\n').slice(0, 2).join(' | '),
        code: 'PRISMA_VALIDATION',
      },
    ];
  } else if (isJsonSyntaxError(err) && err.message.includes('Unexpected')) {
    statusCode = StatusCodes.BAD_REQUEST;
    message = 'Invalid JSON payload';
    errors = [{ message: 'Request body contains invalid JSON', code: 'INVALID_JSON' }];
  } else if (err instanceof Error) {
    message = isProduction ? message : err.message;
  }

  if (!isProduction && err instanceof Error && err.stack) {
    stack = err.stack;
  }

  res.status(statusCode).json(errorResponse(message, errors, req.id, stack));
};
