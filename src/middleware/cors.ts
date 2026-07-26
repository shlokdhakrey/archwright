import { Header } from '../constants/http.js';
import type { RequestContext } from '../types/context.js';

const ALLOW_METHODS = 'GET, HEAD, OPTIONS, POST';
const ALLOW_HEADERS = 'Range, If-Range, If-None-Match, If-Modified-Since, Content-Type';
const EXPOSE_HEADERS =
  'Content-Length, Content-Range, Content-Disposition, ETag, Last-Modified, Accept-Ranges, X-Request-Id';

/**
 * Resolve the `Access-Control-Allow-Origin` value for this request. `*` allows
 * everyone; otherwise the configured value is treated as a comma-separated
 * allowlist and the request `Origin` is reflected when it matches (falling back
 * to a lone configured origin).
 */
export function resolveAllowOrigin(ctx: RequestContext): string | undefined {
  const configured = ctx.config.corsAllowOrigin;
  if (configured === '*') return '*';

  const allowed = new Set(
    configured
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
  );
  const origin = ctx.request.headers.get('origin');
  if (origin && allowed.has(origin)) return origin;
  if (allowed.size === 1) return [...allowed][0];
  return undefined;
}

/** Apply CORS headers to a response, without clobbering any already present. */
export function applyCors(response: Response, ctx: RequestContext): void {
  const allowOrigin = resolveAllowOrigin(ctx);
  if (allowOrigin === undefined) return;

  setIfAbsent(response, 'access-control-allow-origin', allowOrigin);
  setIfAbsent(response, 'access-control-expose-headers', EXPOSE_HEADERS);
  if (allowOrigin !== '*') {
    appendVary(response, 'Origin');
  }
}

/** Build a preflight (`OPTIONS`) response. */
export function preflightResponse(ctx: RequestContext): Response {
  const headers = new Headers({
    'access-control-allow-methods': ALLOW_METHODS,
    'access-control-allow-headers': ALLOW_HEADERS,
    'access-control-max-age': '86400',
    [Header.CACHE_CONTROL]: 'no-store',
    [Header.X_REQUEST_ID]: ctx.requestId,
  });
  const response = new Response(null, { status: 204, headers });
  applyCors(response, ctx);
  return response;
}

function setIfAbsent(response: Response, name: string, value: string): void {
  if (!response.headers.has(name)) response.headers.set(name, value);
}

function appendVary(response: Response, value: string): void {
  const existing = response.headers.get(Header.VARY);
  if (!existing) {
    response.headers.set(Header.VARY, value);
    return;
  }
  const values = existing.split(',').map((part) => part.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) {
    response.headers.set(Header.VARY, `${existing}, ${value}`);
  }
}
