import { describe, expect, it } from 'vitest';
import { MemoryCacheStore } from '../../src/cache/cache-store.js';
import { TtlLruCache } from '../../src/cache/memo.js';
import { createLogger } from '../../src/observability/logger.js';
import type { Clock } from '../../src/types/io.js';
import { resolveRequestId } from '../../src/utils/id.js';

function mutableClock(): { clock: Clock; set: (ms: number) => void } {
  let now = 0;
  return { clock: { now: () => now }, set: (ms) => (now = ms) };
}

describe('MemoryCacheStore', () => {
  it('stores and retrieves values', async () => {
    const { clock } = mutableClock();
    const store = new MemoryCacheStore(clock);
    await store.set('k', new Uint8Array([1, 2, 3]), 60);
    expect(Array.from((await store.get('k'))!)).toEqual([1, 2, 3]);
  });

  it('expires values after their TTL', async () => {
    const { clock, set } = mutableClock();
    const store = new MemoryCacheStore(clock);
    await store.set('k', new Uint8Array([1]), 1);
    set(2000);
    expect(await store.get('k')).toBeUndefined();
  });

  it('evicts the least-recently-used entry when full', async () => {
    const { clock } = mutableClock();
    const store = new MemoryCacheStore(clock, 2);
    await store.set('a', new Uint8Array([1]), 60);
    await store.set('b', new Uint8Array([2]), 60);
    await store.get('a'); // touch a → b becomes LRU
    await store.set('c', new Uint8Array([3]), 60);
    expect(await store.get('b')).toBeUndefined();
    expect(await store.get('a')).toBeDefined();
    expect(await store.get('c')).toBeDefined();
  });
});

describe('TtlLruCache', () => {
  it('honours TTL and eviction', () => {
    const cache = new TtlLruCache<number>(2);
    cache.set('a', 1, 1000);
    cache.set('b', 2, 1000);
    expect(cache.get('a', 0)).toBe(1);
    expect(cache.get('a', 2000)).toBeUndefined(); // expired
    cache.set('c', 3, 1000);
    cache.set('d', 4, 1000);
    expect(cache.size).toBeLessThanOrEqual(2);
  });

  it('clears', () => {
    const cache = new TtlLruCache<number>();
    cache.set('a', 1, 1000);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('createLogger', () => {
  it('emits structured JSON at or above the configured level', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', sink: (l) => lines.push(l), now: () => 0 });
    log.debug('suppressed');
    log.info('kept', { a: 1 });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!) as { level: string; message: string; a: number };
    expect(parsed.level).toBe('info');
    expect(parsed.message).toBe('kept');
    expect(parsed.a).toBe(1);
  });

  it('suppresses everything at level silent', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'silent', sink: (l) => lines.push(l) });
    log.error('nope');
    expect(lines).toHaveLength(0);
  });

  it('merges base fields into children', () => {
    const lines: string[] = [];
    const log = createLogger({
      level: 'debug',
      base: { svc: 'x' },
      sink: (l) => lines.push(l),
      now: () => 0,
    });
    log.child({ requestId: 'r1' }).info('hi');
    const parsed = JSON.parse(lines[0]!) as { svc: string; requestId: string };
    expect(parsed.svc).toBe('x');
    expect(parsed.requestId).toBe('r1');
  });
});

describe('resolveRequestId', () => {
  it('prefers cf-ray', () => {
    const req = new Request('https://x/', { headers: { 'cf-ray': '7abc-DFW' } });
    expect(resolveRequestId(req)).toBe('7abc-DFW');
  });

  it('accepts a well-formed x-request-id', () => {
    const req = new Request('https://x/', { headers: { 'x-request-id': 'req-123_ABC' } });
    expect(resolveRequestId(req)).toBe('req-123_ABC');
  });

  it('generates a UUID when nothing usable is supplied', () => {
    const req = new Request('https://x/', { headers: { 'x-request-id': 'has spaces!' } });
    expect(resolveRequestId(req)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
