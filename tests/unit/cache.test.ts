import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryCacheStore } from '../../src/cache/cache-store.js';
import { loadArchive, resetDirectoryMemo } from '../../src/cache/central-directory-cache.js';
import { BytesRangeReader } from '../../src/http/bytes-range-reader.js';
import type { Validators } from '../../src/types/http.js';
import { buildZip } from '../helpers/build-zip.js';

const clock = { now: () => 1_000_000 };
const limits = { maxBytes: 1 << 26, maxEntries: 100_000 };

async function reader(validators?: Validators): Promise<BytesRangeReader> {
  const zip = await buildZip([{ name: 'a.txt', data: 'payload' }]);
  return new BytesRangeReader(zip, validators);
}

function params(r: BytesRangeReader): Parameters<typeof loadArchive>[0] {
  return {
    reader: r,
    cacheKey: 'https://origin/a.zip',
    cache: new MemoryCacheStore(clock),
    clock,
    limits,
    ttlSeconds: 3600,
    background: (promise) => {
      void promise;
    },
  };
}

describe('loadArchive caching', () => {
  beforeEach(() => {
    resetDirectoryMemo();
  });

  it('serves from the in-isolate memo on the second call when the origin has a validator', async () => {
    const base = params(await reader({ etag: '"v1"' }));
    const first = await loadArchive(base);
    const second = await loadArchive(base);
    expect(first.source).toBe('origin');
    expect(second.source).toBe('memo');
  });

  it('does not cache when the origin exposes no validator', async () => {
    const base = params(await reader());
    const first = await loadArchive(base);
    const second = await loadArchive(base);
    expect(first.source).toBe('origin');
    expect(second.source).toBe('origin');
  });

  it('rehydrates from the durable cache across isolates (memo cleared)', async () => {
    const cache = new MemoryCacheStore(clock);
    const writes: Promise<unknown>[] = [];
    const base = {
      ...params(await reader({ etag: '"v2"' })),
      cache,
      background: (p: Promise<unknown>) => {
        writes.push(p);
      },
    };
    const first = await loadArchive(base);
    await Promise.all(writes); // flush the background cache write
    resetDirectoryMemo(); // simulate a fresh isolate

    const second = await loadArchive({ ...base, reader: await reader({ etag: '"v2"' }) });
    expect(first.source).toBe('origin');
    expect(second.source).toBe('cache');
  });
});
