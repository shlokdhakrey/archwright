import { SERVICE_NAME } from '../constants/app.js';
import type { RequestContext } from '../types/context.js';
import { jsonResponse } from './respond.js';

/**
 * Liveness probe. Deliberately dependency-free — it never touches the origin —
 * so it stays green even when an upstream is down, and can back an uptime check
 * or a load-balancer health probe.
 */
export function healthHandler(ctx: RequestContext): Response {
  return jsonResponse(
    ctx,
    {
      status: 'ok',
      service: SERVICE_NAME,
      time: new Date(ctx.deps.clock.now()).toISOString(),
    },
    200,
    { 'cache-control': 'no-store' },
  );
}
