import { describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/harness.js';
import { buildZip } from '../helpers/build-zip.js';
import { createMockOrigin } from '../helpers/mock-origin.js';
import { memoryKv } from '../helpers/memory-kv.js';
import type { Env } from '../../src/types/env.js';

const encoder = new TextEncoder();
const TEXT = encoder.encode('hello short links '.repeat(100));
const ARCHIVE = 'https://origin.example/a.zip';

interface ShortenResponse {
  readonly code: string;
  readonly zfile: string;
  readonly sfile: string;
  readonly url: string;
  readonly ttl: number;
}

async function setup(env: Partial<Env> = {}, withKv = true): Promise<Harness> {
  const zip = await buildZip([
    { name: 'a.txt', data: TEXT, method: 'deflate' },
    { name: 'movie.bin', data: new Uint8Array(2048).fill(7), method: 'stored' },
  ]);
  const origin = createMockOrigin(zip, { url: ARCHIVE });
  return createHarness({
    fetch: origin.fetch,
    env: { ALLOW_ANY_ARCHIVE_HOST: 'true', ...(withKv ? { LINKS_KV: memoryKv() } : {}), ...env },
  });
}

function shorten(harness: Harness, url = ARCHIVE): Promise<Response> {
  return harness.request('/__/shorten', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
}

describe('short links — POST /__/shorten', () => {
  it('returns a stable 8-char code with /zfile and /sfile paths', async () => {
    const harness = await setup();
    const res = await shorten(harness);
    expect(res.status).toBe(200);
    const body = (await res.json()) as ShortenResponse;
    expect(body.code).toHaveLength(8);
    expect(body.zfile).toBe(`/zfile/${body.code}`);
    expect(body.sfile).toBe(`/sfile/${body.code}`);
    expect(body.url).toBe(ARCHIVE);
  });

  it('derives the code from the canonical URL — signature changes keep the code stable', async () => {
    const harness = await setup();
    const signed1 = `${ARCHIVE}?X-Amz-Signature=aaaa&X-Amz-Date=111`;
    const signed2 = `${ARCHIVE}?X-Amz-Signature=bbbb&X-Amz-Date=222`;
    const a = (await (await shorten(harness, signed1)).json()) as ShortenResponse;
    const b = (await (await shorten(harness, signed2)).json()) as ShortenResponse;
    // Same object, different (expiring) signatures → same permanent code.
    expect(a.code).toBe(b.code);
  });

  it('accepts the URL as a ?url= query parameter', async () => {
    const harness = await setup();
    const res = await harness.request(`/__/shorten?url=${encodeURIComponent(ARCHIVE)}`, {
      method: 'POST',
    });
    expect(res.status).toBe(200);
  });

  it('rejects a request with no URL', async () => {
    const harness = await setup();
    const res = await harness.request('/__/shorten', { method: 'POST', body: '{}' });
    expect(res.status).toBe(400);
  });

  it('returns 503 when short links are not enabled (no KV binding)', async () => {
    const harness = await setup({}, false);
    const res = await shorten(harness);
    expect(res.status).toBe(503);
  });

  it('refuses to shorten when neither open mode nor an allowlist is set', async () => {
    const harness = await setup({ ALLOW_ANY_ARCHIVE_HOST: 'false' });
    const res = await shorten(harness);
    expect(res.status).toBe(403);
  });

  it('applies SSRF rules to the submitted URL', async () => {
    const harness = await setup();
    const res = await shorten(harness, 'http://169.254.169.254/latest/meta-data/');
    expect(res.status).toBe(403);
  });
});

describe('short links — /zfile and /sfile resolution', () => {
  it('lists an archive through /zfile/{code}', async () => {
    const harness = await setup();
    const { code } = (await (await shorten(harness)).json()) as ShortenResponse;
    const res = await harness.request(`/zfile/${code}/__/list`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[] };
    expect(body.entries.length).toBe(2);
  });

  it('downloads a file through /sfile/{code}/{file}', async () => {
    const harness = await setup();
    const { code } = (await (await shorten(harness)).json()) as ShortenResponse;
    const res = await harness.request(`/sfile/${code}/movie.bin`);
    expect(res.status).toBe(200);
    expect(new Uint8Array(await res.arrayBuffer()).byteLength).toBe(2048);
  });

  it('accepts either prefix interchangeably (both resolve the same code)', async () => {
    const harness = await setup();
    const { code } = (await (await shorten(harness)).json()) as ShortenResponse;
    expect((await harness.request(`/zfile/${code}/movie.bin`)).status).toBe(200);
    expect((await harness.request(`/sfile/${code}/__/list`)).status).toBe(200);
  });

  it('returns 404 for an unknown or expired code', async () => {
    const harness = await setup();
    const res = await harness.request('/zfile/deadbeef/movie.bin');
    expect(res.status).toBe(404);
  });

  it('returns 404 when short links are not enabled', async () => {
    const harness = await setup({}, false);
    const res = await harness.request('/sfile/anything/movie.bin');
    expect(res.status).toBe(404);
  });
});
