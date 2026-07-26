import { CacheApiStore, CompositeCacheStore, KvCacheStore, NoopCacheStore } from './cache/cache-store.js';
import { SERVICE_NAME } from './constants/app.js';
import { parseConfig } from './config/parse.js';
import { toErrorResponse } from './errors/to-response.js';
import { compose } from './middleware/compose.js';
import { errorBoundary } from './middleware/error.js';
import { finalizeResponse } from './middleware/finalize.js';
import { requestLogging } from './middleware/logging.js';
import { createLogger } from './observability/logger.js';
import { createMetricsRecorder } from './observability/metrics.js';
import { router } from './routes/router.js';
import type { Deps, RequestContext } from './types/context.js';
import type { Env } from './types/env.js';
import type { CacheStore, Clock, Fetcher } from './types/io.js';
import { resolveRequestId } from './utils/id.js';

/** Overrides for the app's ambient collaborators. Tests inject all three. */
export interface AppOptions {
  readonly fetch?: Fetcher;
  readonly clock?: Clock;
  readonly cache?: CacheStore;
}

export interface App {
  fetch(request: Request, env: Env, executionCtx: ExecutionContext): Promise<Response>;
}

const systemClock: Clock = { now: () => Date.now() };
const defaultFetcher: Fetcher = (input, init) => fetch(input, init);

/**
 * Build the application. The fetch handler is a thin shell: it resolves config
 * and collaborators, assembles the {@link RequestContext}, and runs the request
 * through the middleware pipeline (finalise → logging → error boundary →
 * router). A last-resort catch guarantees a well-formed response even if the
 * error boundary itself fails.
 */
export function createApp(options: AppOptions = {}): App {
  const clock = options.clock ?? systemClock;
  const fetcher = options.fetch ?? defaultFetcher;
  const pipeline = compose([finalizeResponse(), requestLogging(), errorBoundary()], router);

  return {
    async fetch(request: Request, env: Env, executionCtx: ExecutionContext): Promise<Response> {
      const requestId = resolveRequestId(request);
      const config = parseConfig(env);
      const log = createLogger({
        level: config.logLevel,
        base: { requestId, service: SERVICE_NAME },
        now: () => clock.now(),
      });

      try {
        const cache = options.cache ?? buildCache(env);
        const deps: Deps = {
          fetch: fetcher,
          clock,
          cache,
          ...(env.METADATA_KV ? { kv: env.METADATA_KV } : {}),
          ...(env.LINKS_KV ? { links: env.LINKS_KV } : {}),
          ...(env.METRICS ? { metrics: env.METRICS } : {}),
        };
        const ctx: RequestContext = {
          request,
          url: new URL(request.url),
          env,
          config,
          deps,
          log,
          metrics: createMetricsRecorder(clock),
          requestId,
          signal: request.signal,
          waitUntil: (promise) => {
            executionCtx.waitUntil(promise);
          },
        };
        return await pipeline(ctx);
      } catch (error) {
        // The error boundary should have handled this; this is belt-and-braces.
        log.error('unhandled pipeline error', { error: String(error) });
        return toErrorResponse(error, requestId);
      }
    },
  };
}

/**
 * Assemble the durable cache from available bindings: the per-colo Cache API,
 * plus KV when bound. Falls back to a no-op store when neither is present (e.g.
 * a minimal test runtime), which keeps the service correct, just cache-less.
 */
function buildCache(env: Env): CacheStore {
  const stores: CacheStore[] = [];
  const cacheStorage = (globalThis as { caches?: CacheStorage }).caches;
  if (cacheStorage?.default) {
    stores.push(new CacheApiStore(cacheStorage.default));
  }
  if (env.METADATA_KV) {
    stores.push(new KvCacheStore(env.METADATA_KV));
  }
  if (stores.length === 0) return new NoopCacheStore();
  if (stores.length === 1) {
    const [only] = stores;
    return only ?? new NoopCacheStore();
  }
  return new CompositeCacheStore(stores);
}
