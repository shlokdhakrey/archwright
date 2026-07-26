/**
 * Apply conservative security headers to every response. `nosniff` is the
 * important one for a byte service: it stops a client from re-interpreting a
 * `Content-Type` we inferred from an extension. `Cross-Origin-Resource-Policy:
 * cross-origin` is intentional — this is a public file service meant to be
 * embeddable.
 */
export function applySecurityHeaders(response: Response): void {
  setIfAbsent(response, 'x-content-type-options', 'nosniff');
  setIfAbsent(response, 'referrer-policy', 'no-referrer');
  setIfAbsent(response, 'cross-origin-resource-policy', 'cross-origin');
}

function setIfAbsent(response: Response, name: string, value: string): void {
  if (!response.headers.has(name)) response.headers.set(name, value);
}
