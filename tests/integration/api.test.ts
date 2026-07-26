import { beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from '../helpers/harness.js';
import { buildZip } from '../helpers/build-zip.js';
import { createMockOrigin } from '../helpers/mock-origin.js';

const encoder = new TextEncoder();

async function setup(): Promise<Harness> {
  const zip = await buildZip([
    { name: 'a.txt', data: 'alpha' },
    { name: 'b.txt', data: encoder.encode('beta'.repeat(100)), method: 'deflate' },
    { name: 'c.bin', data: new Uint8Array(10) },
  ]);
  const origin = createMockOrigin(zip, { url: 'https://origin.example/a.zip' });
  return createHarness({ fetch: origin.fetch, env: { ARCHIVE_URL: origin.url } });
}

describe('control plane', () => {
  let harness: Harness;
  beforeEach(async () => {
    harness = await setup();
  });

  it('serves health', async () => {
    const res = await harness.request('/__/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('ok');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('serves version with detected features', async () => {
    const res = await harness.request('/__/version');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; features: Record<string, boolean> };
    expect(body.mode).toBe('single');
    expect(body.features.kvCache).toBe(false);
  });

  it('serves the browser UI at the root by default', async () => {
    const res = await harness.request('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('applies permissive CORS headers', async () => {
    const res = await harness.request('/__/health');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('answers OPTIONS preflight with 204', async () => {
    const res = await harness.request('/movie.bin', { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
  });

  it('rejects unsupported methods with 405', async () => {
    const res = await harness.request('/a.txt', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toContain('GET');
  });
});

describe('listing', () => {
  it('lists entries with pagination metadata', async () => {
    const harness = await setup();
    const res = await harness.request('/__/list?limit=2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      archive: { entryCount: number; source: string };
      pagination: { total: number; returned: number; nextCursor: number | null };
      entries: { name: string }[];
    };
    expect(body.archive.entryCount).toBe(3);
    expect(body.pagination.returned).toBe(2);
    expect(body.pagination.nextCursor).toBe(2);
    expect(body.entries[0]!.name).toBe('a.txt');
  });

  it('filters by prefix', async () => {
    const harness = await setup();
    const res = await harness.request('/__/list?prefix=b');
    const body = (await res.json()) as { entries: { name: string }[] };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.name).toBe('b.txt');
  });

  it('serves the directory from the in-isolate memo on the second call', async () => {
    const harness = await setup();
    const first = (await (await harness.request('/__/list')).json()) as { archive: { source: string } };
    const second = (await (await harness.request('/__/list')).json()) as { archive: { source: string } };
    expect(first.archive.source).toBe('origin');
    expect(second.archive.source).toBe('memo');
  });
});

describe('metadata', () => {
  it('returns a single entry with validators', async () => {
    const harness = await setup();
    const res = await harness.request('/__/meta/b.txt');
    expect(res.status).toBe(200);
    expect(res.headers.get('etag')).toBeTruthy();
    const body = (await res.json()) as { name: string; method: string };
    expect(body.name).toBe('b.txt');
    expect(body.method).toBe('deflate');
  });

  it('returns 404 for a missing entry', async () => {
    const harness = await setup();
    const res = await harness.request('/__/meta/missing.txt');
    expect(res.status).toBe(404);
  });
});
