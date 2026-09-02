import { Header, Status } from '../constants/http.js';
import { normalizeError, toErrorResponse } from '../errors/index.js';
import { renderNotFoundPage } from '../ui/pages/not-found.js';
import { isAbortError } from '../utils/async.js';
import type { Middleware } from './types.js';

/** Non-standard status used by Cloudflare/nginx when the client disconnects. */
const CLIENT_CLOSED_REQUEST = 499;

/**
 * The error boundary. It converts any thrown value into a uniform JSON error
 * response and records it against the request id — 5xx at `error`, 4xx at
 * `warn`. A client disconnect (abort) is expected, not an error: it is logged at
 * `info` and answered with a 499 that the (already gone) client will never see.
 */
export function errorBoundary(): Middleware {
  return async (ctx, next): Promise<Response> => {
    try {
      return await next();
    } catch (error) {
      if (isAbortError(error) || ctx.signal.aborted) {
        ctx.log.info('request aborted by client', { path: ctx.url.pathname });
        return new Response(null, {
          status: CLIENT_CLOSED_REQUEST,
          headers: { 'x-request-id': ctx.requestId },
        });
      }

      const httpError = normalizeError(error);
      const fields = {
        status: httpError.status,
        code: httpError.code,
        method: ctx.request.method,
        path: ctx.url.pathname,
      };
      if (httpError.status >= 500) {
        ctx.log.error('request failed', { ...fields, error: describeError(error) });
      } else {
        ctx.log.warn('request rejected', { ...fields, message: httpError.message });
      }
      // A browser that wandered onto a dead link deserves the site's own 404,
      // not a JSON payload. API clients still get JSON.
      if (
        httpError.status === Status.NOT_FOUND &&
        ctx.config.serveUi &&
        (ctx.request.headers.get('accept') ?? '').includes('text/html')
      ) {
        return new Response(renderNotFoundPage(), {
          status: Status.NOT_FOUND,
          headers: {
            [Header.CONTENT_TYPE]: 'text/html; charset=utf-8',
            [Header.CACHE_CONTROL]: 'no-store',
            [Header.X_REQUEST_ID]: ctx.requestId,
          },
        });
      }
      return toErrorResponse(error, ctx.requestId);
    }
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.cause instanceof Error
      ? `${error.name}: ${error.message} (cause: ${error.cause.name}: ${error.cause.message})`
      : `${error.name}: ${error.message}`;
  }
  return String(error);
}
