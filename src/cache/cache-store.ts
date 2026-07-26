import type { CacheStore, Clock } from '../types/io.js';

/**
 * A cache namespace URL. Cache API keys are `Request`s, so we synthesise a
 * stable, private URL space that never collides with real traffic.
 */
const CACHE_NAMESPACE = 'https://cache.zipstream.internal/';

/**
 * {@link CacheStore} over the Workers Cache API (per-colo, free, fast).
 *
 * The value is stored as a synthetic `200` response with an explicit
 * `Cache-Control: max-age`. This sidesteps the Cache API's refusal to store
 * `206` responses — we never cache partial content, only whole serialised
 * central directories.
 */
export class CacheApiStore implements CacheStore {
  constructor(private readonly cache: Cache) {}

  private request(key: string): Request {
    return new Request(CACHE_NAMESPACE + encodeURIComponent(key), { method: 'GET' });
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const response = await this.cache.match(this.request(key));
    if (!response) return undefined;
    return new Uint8Array(await response.arrayBuffer());
  }

  async set(key: string, value: Uint8Array, ttlSeconds: number): Promise<void> {
    const response = new Response(value, {
      headers: {
        'content-type': 'application/octet-stream',
        'content-length': String(value.byteLength),
        'cache-control': `max-age=${Math.max(1, Math.floor(ttlSeconds))}`,
      },
    });
    await this.cache.put(this.request(key), response);
  }
}

/**
 * {@link CacheStore} over a KV namespace (cross-colo, eventually consistent).
 * Optional; used only when a `METADATA_KV` binding is present.
 */
export class KvCacheStore implements CacheStore {
  constructor(private readonly kv: KVNamespace) {}

  private key(key: string): string {
    return `cd:${key}`;
  }

  async get(key: string): Promise<Uint8Array | undefined> {
    const value = await this.kv.get(this.key(key), 'arrayBuffer');
    return value ? new Uint8Array(value) : undefined;
  }

  async set(key: string, value: Uint8Array, ttlSeconds: number): Promise<void> {
    // KV requires a minimum TTL of 60 seconds.
    await this.kv.put(this.key(key), value, { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) });
  }
}

/**
 * In-memory {@link CacheStore} with TTL and LRU eviction. Used by tests, and as
 * a small L1 in front of the durable stores.
 */
export class MemoryCacheStore implements CacheStore {
  private readonly map = new Map<string, { value: Uint8Array; expiresAt: number }>();

  constructor(
    private readonly clock: Clock,
    private readonly maxEntries = 64,
  ) {}

  get(key: string): Promise<Uint8Array | undefined> {
    const entry = this.map.get(key);
    if (!entry) return Promise.resolve(undefined);
    if (this.clock.now() > entry.expiresAt) {
      this.map.delete(key);
      return Promise.resolve(undefined);
    }
    // LRU touch.
    this.map.delete(key);
    this.map.set(key, entry);
    return Promise.resolve(entry.value);
  }

  set(key: string, value: Uint8Array, ttlSeconds: number): Promise<void> {
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
    this.map.set(key, { value, expiresAt: this.clock.now() + ttlSeconds * 1000 });
    return Promise.resolve();
  }
}

/** A no-op store used when caching is disabled. */
export class NoopCacheStore implements CacheStore {
  get(): Promise<Uint8Array | undefined> {
    return Promise.resolve(undefined);
  }
  set(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Reads from stores in order (first hit wins) and writes through to all of them.
 * A durable-store failure never breaks a request — the read/write is best-effort.
 */
export class CompositeCacheStore implements CacheStore {
  constructor(private readonly stores: readonly CacheStore[]) {}

  async get(key: string): Promise<Uint8Array | undefined> {
    for (const store of this.stores) {
      try {
        const value = await store.get(key);
        if (value !== undefined) return value;
      } catch {
        // ignore and try the next tier
      }
    }
    return undefined;
  }

  async set(key: string, value: Uint8Array, ttlSeconds: number): Promise<void> {
    await Promise.allSettled(this.stores.map((store) => store.set(key, value, ttlSeconds)));
  }
}
