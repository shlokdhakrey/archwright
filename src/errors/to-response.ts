import { Header, Status } from '../constants/http.js';
import { HttpError, InternalServerError } from './http-error.js';

/** Shape of the JSON body returned for every error. */
export interface ErrorPayload {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly status: number;
    readonly requestId: string;
    readonly details?: Record<string, unknown>;
  };
}

/** Coerce any thrown value into an {@link HttpError}. */
export function normalizeError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  return new InternalServerError(error);
}

const GENERIC_MESSAGE: Record<number, string> = {
  [Status.INTERNAL_SERVER_ERROR]: 'Internal server error',
  [Status.BAD_GATEWAY]: 'Bad gateway',
  [Status.SERVICE_UNAVAILABLE]: 'Service temporarily unavailable',
  [Status.GATEWAY_TIMEOUT]: 'Gateway timeout',
};

/**
 * Serialise an error into a JSON {@link Response}. Non-exposed errors (5xx) get
 * a generic message so internals never reach the client; the real cause is left
 * for the logging middleware to record against the request id.
 */
export function toErrorResponse(error: unknown, requestId: string): Response {
  const httpError = normalizeError(error);
  const message = httpError.expose ? httpError.message : (GENERIC_MESSAGE[httpError.status] ?? 'Error');

  const payload: ErrorPayload = {
    error: {
      code: httpError.code,
      message,
      status: httpError.status,
      requestId,
      ...(httpError.expose && httpError.details ? { details: httpError.details } : {}),
    },
  };

  const headers = new Headers({
    [Header.CONTENT_TYPE]: 'application/json; charset=utf-8',
    [Header.CACHE_CONTROL]: 'no-store',
    [Header.X_REQUEST_ID]: requestId,
    ...httpError.extraHeaders,
  });

  return new Response(`${JSON.stringify(payload)}\n`, { status: httpError.status, headers });
}
