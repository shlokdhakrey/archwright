import { preflightResponse } from '../middleware/cors.js';
import type { RequestContext } from '../types/context.js';

/** Answer CORS preflight and bare `OPTIONS` requests with a 204 + allow headers. */
export function optionsHandler(ctx: RequestContext): Response {
  return preflightResponse(ctx);
}
