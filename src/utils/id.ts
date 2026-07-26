/** Correlation-id resolution for a request. */

const SAFE_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Resolve a stable request id, preferring Cloudflare's `cf-ray` (which ties the
 * log line to the dashboard), then a well-formed client-supplied
 * `x-request-id`, and finally a fresh UUID. Client input is accepted only if it
 * matches a strict token pattern, preventing log/header injection.
 */
export function resolveRequestId(request: Request): string {
  const ray = request.headers.get('cf-ray');
  if (ray && SAFE_ID.test(ray)) return ray;

  const supplied = request.headers.get('x-request-id');
  if (supplied && SAFE_ID.test(supplied)) return supplied;

  return crypto.randomUUID();
}
