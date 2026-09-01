import { describe, expect, it } from 'vitest';
import { BytesRangeReader } from '../../src/http/bytes-range-reader.js';
import { buildEntryStream } from '../../src/streaming/pipeline.js';
import type { Fetcher } from '../../src/types/io.js';
import { collectStream } from '../../src/utils/stream.js';
import { ZipArchive } from '../../src/zip/archive.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { memoryKv } from '../helpers/memory-kv.js';

const A_URL = 'https://files.example/clip-a.mkv';
const B_URL = 'https://files.example/clip-b.mkv';
const A = new Uint8Array(5000).map((_, i) => (i * 31 + 7) & 0xff);
const B = new Uint8Array(1200).map((_, i) => (i * 17 + 3) & 0xff);
const FILES: Record<string, Uint8Array> = { [A_URL]: A, [B_URL]: B };

interface Summary {
  readonly code: string;
  readonly tar: string;
  readonly zip: string;
  readonly files: { name: string; size: number; crc: boolean }[];
  readonly totalBytes: number;
  readonly tarBytes: number;
  readonly zipBytes: number;
  readonly zipReady: boolean;
  readonly crcRemaining: number;
  readonly complete?: boolean;
}

/** A plain file origin supporting HEAD and byte ranges. */
function fileOrigin(): Fetcher {
  return (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const data = FILES[url];
    if (!data) return Promise.resolve(new Response('nope', { status: 404 }));

    const method = (init?.method ?? 'GET').toUpperCase();
    if (method === 'HEAD') {
      return Promise.resolve(
        new Response(null, {
          status: 200,
          headers: { 'content-length': String(data.byteLength), 'accept-ranges': 'bytes' },
        }),
      );
    }

    const headers = new Headers((init?.headers ?? {}) as HeadersInit);
    const range = headers.get('range');
    const match = /bytes=(\d+)-(\d+)?/.exec(range ?? '');
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
      new Response(data, {
        status: 200,
        headers: { 'content-length': String(data.byteLength) },
      }),
    );
  };
}

function setup(): Harness {
  return createHarness({
    fetch: fileOrigin(),
    env: { ALLOW_ANY_ARCHIVE_HOST: 'true', LINKS_KV: memoryKv() },
  });
}

async function createBundle(harness: Harness, urls = [A_URL, B_URL]): Promise<Summary> {
  const res = await harness.request('/__/bundle', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: urls.map((url) => ({ url })), name: 'picks' }),
  });
  expect(res.status).toBe(200);
  return (await res.json()) as Summary;
}

/** Minimal TAR reader: walk 512-byte headers and return name → content. */
function readTar(tar: Uint8Array): Map<string, Uint8Array> {
  const decoder = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  let at = 0;
  while (at + 512 <= tar.byteLength) {
    const header = tar.subarray(at, at + 512);
    if (header.every((b) => b === 0)) break;
    const readField = (offset: number, length: number): string => {
      const raw = header.subarray(offset, offset + length);
      const end = raw.indexOf(0);
      return decoder.decode(raw.subarray(0, end === -1 ? raw.length : end)).trim();
    };
    const name = readField(0, 100);
    const size = parseInt(readField(124, 12), 8);
    at += 512;
    out.set(name, tar.subarray(at, at + size));
    at += size + ((512 - (size % 512)) % 512);
  }
  return out;
}

describe('bundle — create', () => {
  it('probes each URL and returns both archive links', async () => {
    const summary = await createBundle(setup());
    expect(summary.code).toHaveLength(8);
    expect(summary.tar).toBe(`/bundle/${summary.code}.tar`);
    expect(summary.zip).toBe(`/bundle/${summary.code}.zip`);
    expect(summary.files.map((f) => f.name)).toEqual(['clip-a.mkv', 'clip-b.mkv']);
    expect(summary.totalBytes).toBe(A.byteLength + B.byteLength);
    // TAR is servable immediately; ZIP still needs checksums.
    expect(summary.zipReady).toBe(false);
    expect(summary.crcRemaining).toBe(A.byteLength + B.byteLength);
  });

  it('derives a stable code from the same URL set', async () => {
    const harness = setup();
    const first = await createBundle(harness);
    const second = await createBundle(harness);
    expect(first.code).toBe(second.code);
  });

  it('rejects an empty request and enforces SSRF rules', async () => {
    const harness = setup();
    const empty = await harness.request('/__/bundle', { method: 'POST', body: '{"files":[]}' });
    expect(empty.status).toBe(400);
    const blocked = await harness.request('/__/bundle', {
      method: 'POST',
      body: JSON.stringify({ files: [{ url: 'http://169.254.169.254/meta' }] }),
    });
    expect(blocked.status).toBe(403);
  });
});

describe('bundle — TAR (no prepare needed)', () => {
  it('streams a valid tar with both files intact', async () => {
    const harness = setup();
    const summary = await createBundle(harness);
    const res = await harness.request(summary.tar);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/x-tar');
    expect(res.headers.get('content-length')).toBe(String(summary.tarBytes));
    expect(res.headers.get('content-disposition')).toContain('picks.tar');

    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.byteLength).toBe(summary.tarBytes);
    const entries = readTar(body);
    expect(entries.get('clip-a.mkv')).toEqual(A);
    expect(entries.get('clip-b.mkv')).toEqual(B);
  });

  it('answers HEAD with the exact size and no body', async () => {
    const harness = setup();
    const summary = await createBundle(harness);
    const res = await harness.request(summary.tar, { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-length')).toBe(String(summary.tarBytes));
    expect(await res.text()).toBe('');
  });
});

describe('bundle — ZIP (needs prepared checksums)', () => {
  it('refuses ZIP until the CRCs are computed', async () => {
    const harness = setup();
    const summary = await createBundle(harness);
    const res = await harness.request(summary.zip);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('.tar');
  });

  it('prepares, then streams a ZIP our own reader can parse', async () => {
    const harness = setup();
    const summary = await createBundle(harness);

    const prepared = await harness.request(`/__/bundle/${summary.code}/prepare`, { method: 'POST' });
    expect(prepared.status).toBe(200);
    const progress = (await prepared.json()) as Summary;
    expect(progress.complete).toBe(true);
    expect(progress.zipReady).toBe(true);
    expect(progress.crcRemaining).toBe(0);

    const res = await harness.request(summary.zip);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    expect(res.headers.get('content-length')).toBe(String(summary.zipBytes));

    // Round-trip: parse the produced archive with the project's own ZIP reader.
    const body = new Uint8Array(await res.arrayBuffer());
    expect(body.byteLength).toBe(summary.zipBytes);
    const archive = await ZipArchive.open(new BytesRangeReader(body), {
      maxBytes: 1 << 26,
      maxEntries: 1000,
    });
    expect(archive.entries.map((e) => e.name)).toEqual(['clip-a.mkv', 'clip-b.mkv']);

    for (const [name, expected] of [
      ['clip-a.mkv', A],
      ['clip-b.mkv', B],
    ] as const) {
      const entry = archive.getEntry(name);
      if (!entry) throw new Error(`missing entry ${name}`);
      const location = await archive.resolveData(entry);
      const plan = await buildEntryStream(archive, entry, location, { kind: 'none' });
      expect(await collectStream(plan.body)).toEqual(expected);
    }
  });
});

describe('bundle — errors', () => {
  it('returns 404 for an unknown code', async () => {
    const harness = setup();
    expect((await harness.request('/bundle/deadbeef.tar')).status).toBe(404);
    expect((await harness.request('/bundle/deadbeef.zip')).status).toBe(404);
  });

  it('returns 503 when bundles are not enabled', async () => {
    const harness = createHarness({
      fetch: fileOrigin(),
      env: { ALLOW_ANY_ARCHIVE_HOST: 'true' },
    });
    const res = await harness.request('/__/bundle', {
      method: 'POST',
      body: JSON.stringify({ files: [{ url: A_URL }] }),
    });
    expect(res.status).toBe(503);
  });
});
