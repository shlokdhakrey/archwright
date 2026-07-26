import { beforeEach, describe, expect, it } from 'vitest';
import { collectStream, readableFromBytes } from '../../src/utils/stream.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { buildZip } from '../helpers/build-zip.js';
import { createMockOrigin, type MockOrigin } from '../helpers/mock-origin.js';

const encoder = new TextEncoder();
const STORED = new Uint8Array(4096).map((_, i) => (i * 37) & 0xff);
const TEXT = encoder.encode('The quick brown fox jumps over the lazy dog. '.repeat(400));

async function setup(): Promise<{ harness: Harness; origin: MockOrigin }> {
  const zip = await buildZip([
    { name: 'movie.bin', data: STORED, method: 'stored' },
    { name: 'folder/notes.txt', data: TEXT, method: 'deflate' },
  ]);
  const origin = createMockOrigin(zip, { url: 'https://origin.example/a.zip' });
  const harness = createHarness({ fetch: origin.fetch, env: { ARCHIVE_URL: origin.url } });
  return { harness, origin };
}

describe('download — full GET', () => {
  let harness: Harness;
  let origin: MockOrigin;
  beforeEach(async () => {
    ({ harness, origin } = await setup());
  });

  it('streams a STORED entry verbatim', async () => {
    const res = await harness.request('/movie.bin');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(STORED.byteLength));
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    expect(res.headers.get('x-zip-method')).toBe('stored');
    expect(res.headers.get('etag')).toBeTruthy();
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(STORED);
  });

  it('streams and inflates a DEFLATE entry, with Content-Length known up front', async () => {
    const res = await harness.request('/folder/notes.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(TEXT.byteLength));
    expect(res.headers.get('content-type')).toContain('text/plain');
    expect(res.headers.get('x-zip-method')).toBe('deflate');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(TEXT);
  });

  it('uses a small, bounded number of origin subrequests', async () => {
    await harness.request('/movie.bin');
    // suffix probe + local header + data stream
    expect(origin.callCount()).toBeLessThanOrEqual(3);
  });
});

describe('download — Content-Disposition', () => {
  it('defaults to attachment so a bare link downloads', async () => {
    const { harness } = await setup();
    const res = await harness.request('/movie.bin');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('honours ?inline to preview in the browser', async () => {
    const { harness } = await setup();
    const res = await harness.request('/movie.bin?inline');
    expect(res.headers.get('content-disposition')).toContain('inline');
  });

  it('honours ?download to force a save even when configured inline', async () => {
    const zip = await buildZip([{ name: 'movie.bin', data: STORED, method: 'stored' }]);
    const origin = createMockOrigin(zip, { url: 'https://origin.example/a.zip' });
    const harness = createHarness({
      fetch: origin.fetch,
      env: { ARCHIVE_URL: origin.url, CONTENT_DISPOSITION: 'inline' },
    });
    const res = await harness.request('/movie.bin?download');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('applies the override on the deflate passthrough path too', async () => {
    const { harness } = await setup();
    const res = await harness.request('/folder/notes.txt?inline', {
      headers: { 'accept-encoding': 'gzip' },
    });
    expect(res.headers.get('content-encoding')).toBe('deflate');
    expect(res.headers.get('content-disposition')).toContain('inline');
  });
});

describe('download — DEFLATE deflate passthrough (zero-copy, zero-CPU)', () => {
  it('serves a full DEFLATE download as Content-Encoding: deflate (raw passthrough) when the client accepts it', async () => {
    const { harness } = await setup();
    const res = await harness.request('/folder/notes.txt', { headers: { 'accept-encoding': 'gzip, deflate, br' } });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-encoding')).toBe('deflate');
    expect(res.headers.get('vary')).toContain('Accept-Encoding');
    // The advertised length is exactly the stored compressed size — no framing.
    expect(Number(res.headers.get('content-length'))).toBeGreaterThan(0);
    // An encoded body is not range-served in this mode.
    expect(res.headers.get('accept-ranges')).toBeNull();
    // The edge must not re-encode a body we hand through untouched.
    expect(res.headers.get('cache-control')).toContain('no-transform');

    // The raw body is bare RFC 1951 DEFLATE; inflating it (as a browser does for
    // `Content-Encoding: deflate`) yields the original bytes.
    const raw = new Uint8Array(await res.arrayBuffer());
    const decoded = await collectStream(
      readableFromBytes(raw).pipeThrough(new DecompressionStream('deflate-raw')),
    );
    expect(decoded).toEqual(TEXT);
  });

  it('gates on the reliably-forwarded gzip token (Cloudflare drops the deflate token)', async () => {
    const { harness } = await setup();
    // A browser-normalised Accept-Encoding of just "gzip" still triggers the
    // passthrough, because every client that sends it also inflates deflate.
    const res = await harness.request('/folder/notes.txt', { headers: { 'accept-encoding': 'gzip' } });
    expect(res.headers.get('content-encoding')).toBe('deflate');
  });

  it('inflates server-side when the client accepts no encoding at all', async () => {
    const { harness } = await setup();
    const res = await harness.request('/folder/notes.txt', { headers: { 'accept-encoding': 'identity' } });
    expect(res.headers.get('content-encoding')).toBeNull();
    expect(res.headers.get('accept-ranges')).toBe('bytes');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(TEXT);
  });

  it('does not encode a STORED entry (it is already a zero-copy passthrough)', async () => {
    const { harness } = await setup();
    const res = await harness.request('/movie.bin', { headers: { 'accept-encoding': 'gzip, deflate' } });
    expect(res.headers.get('content-encoding')).toBeNull();
  });
});

describe('download — HEAD', () => {
  it('returns headers without a body and without fetching entry data', async () => {
    const { harness, origin } = await setup();
    const res = await harness.request('/movie.bin', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(STORED.byteLength));
    expect(await res.text()).toBe('');
    // Only the archive probe is needed; entry data is never touched.
    expect(origin.callCount()).toBe(1);
  });
});

describe('download — ranges', () => {
  it('serves a STORED range as random access (206)', async () => {
    const { harness } = await setup();
    const res = await harness.request('/movie.bin', { headers: { range: 'bytes=100-199' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe(`bytes 100-199/${STORED.byteLength}`);
    expect(res.headers.get('content-length')).toBe('100');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(STORED.subarray(100, 200));
  });

  it('serves a DEFLATE range by inflating and slicing (206)', async () => {
    const { harness } = await setup();
    const res = await harness.request('/folder/notes.txt', { headers: { range: 'bytes=50-149' } });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-length')).toBe('100');
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body).toEqual(TEXT.subarray(50, 150));
  });

  it('answers 416 for an unsatisfiable range', async () => {
    const { harness } = await setup();
    const res = await harness.request('/movie.bin', { headers: { range: 'bytes=999999999-' } });
    expect(res.status).toBe(416);
    expect(res.headers.get('content-range')).toBe(`bytes */${STORED.byteLength}`);
  });
});

describe('download — conditional requests', () => {
  it('returns 304 when the If-None-Match ETag matches', async () => {
    const { harness } = await setup();
    const first = await harness.request('/movie.bin');
    const etag = first.headers.get('etag')!;
    const second = await harness.request('/movie.bin', { headers: { 'if-none-match': etag } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('ignores a Range when If-Range no longer matches (serves full 200)', async () => {
    const { harness } = await setup();
    const res = await harness.request('/movie.bin', {
      headers: { range: 'bytes=0-9', 'if-range': '"stale-etag"' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(STORED.byteLength));
  });
});

describe('download — not found', () => {
  it('returns a JSON 404 for a missing entry', async () => {
    const { harness } = await setup();
    const res = await harness.request('/does-not-exist.mkv');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string; requestId: string } };
    expect(body.error.code).toBe('not_found');
    expect(body.error.requestId).toBeTruthy();
  });
});
