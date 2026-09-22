export interface SuccessEnvelope<T> {
  success: true;
  message: string;
  data: T;
  meta?: Record<string, unknown>;
}

export interface ErrorEnvelope {
  success: false;
  message: string;
  errors: { field?: string; message: string; code?: string }[];
  requestId: string;
  stack?: string;
}

export function successResponse<T>(
  message: string,
  data: T,
  meta?: Record<string, unknown>,
): SuccessEnvelope<T> {
  return {
    success: true,
    message,
    data,
    ...(meta !== undefined && Object.keys(meta).length > 0 ? { meta } : {}),
  };
}

export function errorResponse(
  message: string,
  errors: { field?: string; message: string; code?: string }[] = [],
  requestId: string,
  stack?: string,
): ErrorEnvelope {
  return {
    success: false,
    message,
    errors,
    requestId,
    ...(stack ? { stack } : {}),
  };
}
