import { beforeAll, describe, expect, it } from 'vitest';
import type { Fetcher } from '../../src/types/io.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { memoryKv } from '../helpers/memory-kv.js';

/**
 * Range support on generated archives. The layout is deterministic once sizes
 * (and, for ZIP, CRC-32s) are known, so any byte window can be served directly —
 * which is what makes these downloads resumable and download-manager friendly.
 */

const A_URL = 'https://files.example/a.mkv';
const B_URL = 'https://files.example/b.mkv';
const A = new Uint8Array(5000).map((_, i) => (i * 31 + 7) & 0xff);
const B = new Uint8Array(1200).map((_, i) => (i * 17 + 3) & 0xff);
const FILES: Record<string, Uint8Array> = { [A_URL]: A, [B_URL]: B };

interface Summary {
  readonly code: string;
  readonly tar: string;
  readonly zip: string;
  readonly tarBytes: number;
  readonly zipBytes: number;
  readonly complete?: boolean;
}

function fileOrigin(): Fetcher {
  return (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const data = FILES[url];
    if (!data) return Promise.resolve(new Response('nope', { status: 404 }));

    if ((init?.method ?? 'GET').toUpperCase() === 'HEAD') {
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { 'content-length': String(data.byteLength), 'accept-ranges': 'bytes' },
        }),
      );
    }
    const headers = new Headers((init?.headers ?? {}) as HeadersInit);
    const match = /bytes=(\d+)-(\d+)?/.exec(headers.get('range') ?? '');
    if (match?.[1]) {
      const start = Number(match[1]);
      const end = match[2] === undefined ? data.byteLength - 1 : Number(match[2]);
      const slice = data.subarray(start, end + 1);
      return Promise.resolve(
        new Response(slice, {
          status: 206,
          headers: {
            'content-length': String(slice.byteLength),
            'content-range': `bytes ${start}-${end}/${data.byteLength}`,
          },
        }),
      );
    }
    return Promise.resolve(
      new Response(data, { status: 200, headers: { 'content-length': String(data.byteLength) } }),
    );
  };
}

let harness: Harness;
let summary: Summary;

beforeAll(async () => {
  harness = createHarness({
    fetch: fileOrigin(),
    env: { ALLOW_ANY_ARCHIVE_HOST: 'true', LINKS_KV: memoryKv() },
  });
  const created = await harness.request('/__/bundle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: [{ url: A_URL }, { url: B_URL }], name: 'ranged' }),
  });
  summary = (await created.json()) as Summary;
  // ZIP needs its checksums before it can be laid out (and therefore seeked).
  const prepared = await harness.request(`/__/bundle/${summary.code}/prepare`, { method: 'POST' });
  expect(((await prepared.json()) as Summary).complete).toBe(true);
});

async function body(path: string, init?: RequestInit): Promise<Uint8Array> {
  const res = await harness.request(path, init);
  return new Uint8Array(await res.arrayBuffer());
}

describe.each([
  ['tar', () => summary.tar, () => summary.tarBytes],
  ['zip', () => summary.zip, () => summary.zipBytes],
])('%s bundle — range support', (_format, path, size) => {
  it('advertises byte ranges on GET and HEAD', async () => {
    const get = await harness.request(path());
    expect(get.headers.get('accept-ranges')).toBe('bytes');
    expect(get.headers.get('etag')).toBeTruthy();

    const head = await harness.request(path(), { method: 'HEAD' });
    expect(head.headers.get('accept-ranges')).toBe('bytes');
    expect(head.headers.get('content-length')).toBe(String(size()));
    expect(await head.text()).toBe('');
  });

  it('answers a mid-archive range with 206 and a correct Content-Range', async () => {
    const res = await harness.request(path(), { headers: { range: 'bytes=100-199' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 100-199/${size()}`);
    expect(res.headers.get('content-length')).toBe('100');
    expect((await res.arrayBuffer()).byteLength).toBe(100);
  });

  it('reassembles byte-identically from chunks', async () => {
    const whole = await body(path());
    expect(whole.byteLength).toBe(size());

    for (const chunk of [512, 1024, 4096]) {
      const joined = new Uint8Array(whole.byteLength);
      let at = 0;
      while (at < whole.byteLength) {
        const end = Math.min(at + chunk - 1, whole.byteLength - 1);
        const part = await body(path(), { headers: { range: `bytes=${at}-${end}` } });
        expect(part.byteLength, `chunk ${chunk} at ${at}`).toBe(end - at + 1);
        joined.set(part, at);
        at = end + 1;
      }
      expect(joined, `chunk size ${chunk}`).toEqual(whole);
    }
  });

  it('serves an open-ended range (resume) and a suffix range', async () => {
    const whole = await body(path());
    const resumed = await body(path(), { headers: { range: `bytes=${size() - 300}-` } });
    expect(resumed).toEqual(whole.subarray(whole.byteLength - 300));

    const suffix = await body(path(), { headers: { range: 'bytes=-128' } });
    expect(suffix).toEqual(whole.subarray(whole.byteLength - 128));
  });

  it('rejects an unsatisfiable range with 416', async () => {
    const res = await harness.request(path(), { headers: { range: 'bytes=99999999-' } });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${size()}`);
  });

  it('uses a stable ETag, honours If-None-Match and If-Range', async () => {
    const first = await harness.request(path());
    const etag = first.headers.get('etag');
    expect(etag).toBeTruthy();
    expect((await harness.request(path())).headers.get('etag')).toBe(etag);

    const notModified = await harness.request(path(), { headers: { 'if-none-match': etag ?? '' } });
    expect(notModified.status).toBe(304);

    // A matching If-Range keeps the range; a stale one falls back to the full body.
    const kept = await harness.request(path(), {
      headers: { range: 'bytes=0-9', 'if-range': etag ?? '' },
    });
    expect(kept.status).toBe(206);

    const dropped = await harness.request(path(), {
      headers: { range: 'bytes=0-9', 'if-range': '"stale"' },
    });
    expect(dropped.status).toBe(200);
    expect(dropped.headers.get('content-length')).toBe(String(size()));
  });
});
