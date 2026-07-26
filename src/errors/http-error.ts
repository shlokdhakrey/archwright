import { Status } from '../constants/http.js';

/** Machine-readable, stable error codes returned in the JSON body. */
export type ErrorCode =
  | 'bad_request'
  | 'invalid_range'
  | 'forbidden'
  | 'not_found'
  | 'method_not_allowed'
  | 'not_acceptable'
  | 'range_not_satisfiable'
  | 'payload_too_large'
  | 'unsupported_entry'
  | 'malformed_archive'
  | 'internal_error'
  | 'upstream_error'
  | 'upstream_timeout'
  | 'service_unavailable';

interface HttpErrorInit {
  readonly status: number;
  readonly code: ErrorCode;
  readonly message: string;
  /** When false, the message is replaced by a generic one for clients (5xx). */
  readonly expose?: boolean;
  /** Extra response headers (e.g. `Content-Range` on 416, `Allow` on 405). */
  readonly headers?: Record<string, string>;
  /** Structured, client-safe context. */
  readonly details?: Record<string, unknown>;
  readonly cause?: unknown;
}

/**
 * The single error type the request pipeline understands. Every failure is
 * normalised to an `HttpError` before serialisation, so responses are uniform
 * and never leak stack traces or internal URLs.
 */
export class HttpError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly expose: boolean;
  readonly extraHeaders: Readonly<Record<string, string>>;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(init: HttpErrorInit) {
    super(init.message, init.cause !== undefined ? { cause: init.cause } : undefined);
    this.name = 'HttpError';
    this.status = init.status;
    this.code = init.code;
    this.expose = init.expose ?? true;
    this.extraHeaders = init.headers ?? {};
    if (init.details) this.details = init.details;
  }
}

export class BadRequestError extends HttpError {
  constructor(message = 'Bad request', details?: Record<string, unknown>) {
    super({ status: Status.BAD_REQUEST, code: 'bad_request', message, ...(details ? { details } : {}) });
  }
}

export class ForbiddenError extends HttpError {
  constructor(message = 'Forbidden', details?: Record<string, unknown>) {
    super({ status: Status.FORBIDDEN, code: 'forbidden', message, ...(details ? { details } : {}) });
  }
}

export class NotFoundError extends HttpError {
  constructor(message = 'Not found', details?: Record<string, unknown>) {
    super({ status: Status.NOT_FOUND, code: 'not_found', message, ...(details ? { details } : {}) });
  }
}

export class MethodNotAllowedError extends HttpError {
  constructor(allow: readonly string[]) {
    super({
      status: Status.METHOD_NOT_ALLOWED,
      code: 'method_not_allowed',
      message: `Method not allowed. Allowed: ${allow.join(', ')}`,
      headers: { allow: allow.join(', ') },
    });
  }
}

export class RangeNotSatisfiableError extends HttpError {
  constructor(resourceSize: number) {
    super({
      status: Status.RANGE_NOT_SATISFIABLE,
      code: 'range_not_satisfiable',
      message: 'Requested range not satisfiable',
      headers: { 'content-range': `bytes */${resourceSize}` },
      details: { resourceSize },
    });
  }
}

export class PayloadTooLargeError extends HttpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      status: Status.PAYLOAD_TOO_LARGE,
      code: 'payload_too_large',
      message,
      ...(details ? { details } : {}),
    });
  }
}

export class UnsupportedEntryError extends HttpError {
  constructor(message: string, details?: Record<string, unknown>) {
    super({
      status: Status.NOT_IMPLEMENTED,
      code: 'unsupported_entry',
      message,
      ...(details ? { details } : {}),
    });
  }
}

export class MalformedArchiveError extends HttpError {
  constructor(
    message = 'The archive is malformed or unsupported',
    details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super({
      status: Status.BAD_GATEWAY,
      code: 'malformed_archive',
      message,
      ...(details ? { details } : {}),
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

export class UpstreamError extends HttpError {
  constructor(
    message = 'Upstream origin returned an error',
    details?: Record<string, unknown>,
    cause?: unknown,
  ) {
    super({
      status: Status.BAD_GATEWAY,
      code: 'upstream_error',
      message,
      ...(details ? { details } : {}),
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

export class UpstreamTimeoutError extends HttpError {
  constructor(message = 'Upstream origin timed out', cause?: unknown) {
    super({
      status: Status.GATEWAY_TIMEOUT,
      code: 'upstream_timeout',
      message,
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

export class ServiceUnavailableError extends HttpError {
  constructor(message = 'Service temporarily unavailable', cause?: unknown) {
    super({
      status: Status.SERVICE_UNAVAILABLE,
      code: 'service_unavailable',
      message,
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}

export class InternalServerError extends HttpError {
  constructor(cause?: unknown) {
    super({
      status: Status.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      message: 'Internal server error',
      expose: false,
      ...(cause !== undefined ? { cause } : {}),
    });
  }
}
