import { Header } from '../constants/http.js';
import type { RequestContext } from '../types/context.js';

/** Serialise `data` as a pretty JSON response with the request id attached. */
export function jsonResponse(
  ctx: RequestContext,
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  const merged = new Headers({
    [Header.CONTENT_TYPE]: 'application/json; charset=utf-8',
    [Header.X_REQUEST_ID]: ctx.requestId,
    ...headers,
  });
  return new Response(`${JSON.stringify(data, null, 2)}\n`, { status, headers: merged });
}

/** Cache headers derived from a resource's validators plus a max-age. */
export function cacheHeaders(
  ctx: RequestContext,
  validators: { etag?: string; lastModified?: string },
  maxAgeSeconds = ctx.config.cacheTtlSeconds,
): Record<string, string> {
  return {
    [Header.CACHE_CONTROL]: `public, max-age=${maxAgeSeconds}`,
    ...(validators.etag ? { [Header.ETAG]: validators.etag } : {}),
    ...(validators.lastModified ? { [Header.LAST_MODIFIED]: validators.lastModified } : {}),
  };
}
