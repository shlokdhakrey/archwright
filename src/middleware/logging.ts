import type { LogFields } from '../types/logging.js';
import type { MetricsSnapshot } from '../types/metrics.js';
import type { Middleware } from './types.js';

/**
 * Log one structured line per request. The completion line captures the status
 * and the time-to-response-headers along with every timing/counter accumulated
 * by handlers. Byte-level totals are logged separately by the download handler
 * once the body finishes streaming (which happens after this line).
 */
export function requestLogging(): Middleware {
  return async (ctx, next): Promise<Response> => {
    ctx.log.debug('request started', {
      method: ctx.request.method,
      path: ctx.url.pathname,
    });

    const stop = ctx.metrics.startTimer('handler_ms');
    const response = await next();
    stop();

    ctx.log.info('request completed', {
      method: ctx.request.method,
      path: ctx.url.pathname,
      status: response.status,
      ...flatten(ctx.metrics.snapshot()),
    });

    return response;
  };
}

function flatten(snapshot: MetricsSnapshot): LogFields {
  const fields: LogFields = {};
  for (const [name, value] of Object.entries(snapshot.timings)) fields[`timing.${name}`] = value;
  for (const [name, value] of Object.entries(snapshot.counters)) fields[`count.${name}`] = value;
  for (const [name, value] of Object.entries(snapshot.gauges)) fields[`gauge.${name}`] = value;
  return fields;
}
