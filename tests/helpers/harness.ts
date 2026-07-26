import { createApp } from '../../src/app.js';
import { MemoryCacheStore } from '../../src/cache/cache-store.js';
import { resetDirectoryMemo } from '../../src/cache/central-directory-cache.js';
import type { Env } from '../../src/types/env.js';
import type { Clock, Fetcher } from '../../src/types/io.js';

export interface HarnessOptions {
  readonly fetch: Fetcher;
  readonly env?: Partial<Env>;
  readonly now?: number;
}

export interface Harness {
  request(path: string, init?: RequestInit): Promise<Response>;
  settle(): Promise<void>;
  readonly waited: Promise<unknown>[];
}

const DEFAULT_NOW = 1_700_000_000_000;

/**
 * Spin up the real application with injected collaborators: a mock origin fetch,
 * an in-memory cache, and a fixed clock. This exercises the entire request
 * pipeline — routing, middleware, ZIP parsing, streaming — exactly as
 * production, without a network or the workerd pool.
 */
export function createHarness(options: HarnessOptions): Harness {
  resetDirectoryMemo();
  const clock: Clock = { now: () => options.now ?? DEFAULT_NOW };
  const cache = new MemoryCacheStore(clock);
  const app = createApp({ fetch: options.fetch, clock, cache });
  const waited: Promise<unknown>[] = [];

  const executionCtx = {
    waitUntil: (promise: Promise<unknown>): void => {
      waited.push(Promise.resolve(promise));
    },
    passThroughOnException: (): void => undefined,
    props: {},
  } as unknown as ExecutionContext;

  const env: Env = {
    CONTROL_PREFIX: '__',
    CORS_ALLOW_ORIGIN: '*',
    LOG_LEVEL: 'silent',
    ...options.env,
  };

  return {
    async request(path: string, init?: RequestInit): Promise<Response> {
      const url = path.startsWith('http') ? path : `https://worker.example${path}`;
      return app.fetch(new Request(url, init), env, executionCtx);
    },
    waited,
    async settle(): Promise<void> {
      await Promise.allSettled(waited);
    },
  };
}
