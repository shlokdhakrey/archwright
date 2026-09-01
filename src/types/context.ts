import type { Config } from './config.js';
import type { Env } from './env.js';
import type { CacheStore, Clock, Fetcher } from './io.js';
import type { Logger } from './logging.js';
import type { MetricsRecorder } from './metrics.js';

/**
 * Side-effecting collaborators, resolved once per request from globals and
 * bindings. Injecting them (rather than reaching for `globalThis`) is what makes
 * the whole request path unit-testable in a plain Node runtime.
 */
export interface Deps {
  readonly fetch: Fetcher;
  readonly clock: Clock;
  readonly cache: CacheStore;
  readonly kv?: KVNamespace;
  /** KV namespace backing short links; absent when the feature is disabled. */
  readonly links?: KVNamespace;
  /** Bucket backing `r2://` sources; absent when no bucket is bound. */
  readonly bucket?: R2Bucket;
  readonly metrics?: AnalyticsEngineDataset;
}

/** Everything a handler needs, assembled by the middleware pipeline. */
export interface RequestContext {
  readonly request: Request;
  readonly url: URL;
  readonly env: Env;
  readonly config: Config;
  readonly deps: Deps;
  readonly log: Logger;
  readonly metrics: MetricsRecorder;
  readonly requestId: string;
  /** Aborts when the client disconnects; propagate it to all origin fetches. */
  readonly signal: AbortSignal;
  /** Extend the request's lifetime for post-response work (logging, metrics). */
  readonly waitUntil: (promise: Promise<unknown>) => void;
}
