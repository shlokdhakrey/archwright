import { Header } from '../constants/http.js';
import { applyCors } from './cors.js';
import { applySecurityHeaders } from './security-headers.js';
import type { Middleware } from './types.js';

/**
 * The outermost middleware. It decorates every response — success or error —
 * with CORS, security headers and the request id. All responses in this service
 * are freshly constructed, so their headers are mutable and can be augmented
 * here without cloning (which would break streaming bodies).
 */
export function finalizeResponse(): Middleware {
  return async (ctx, next): Promise<Response> => {
    const response = await next();
    if (!response.headers.has(Header.X_REQUEST_ID)) {
      response.headers.set(Header.X_REQUEST_ID, ctx.requestId);
    }
    applyCors(response, ctx);
    applySecurityHeaders(response);
    return response;
  };
}
