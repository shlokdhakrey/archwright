import { describe, expect, it } from 'vitest';
import { isR2Source, r2Key, R2RangeReader, r2Source } from '../../src/r2/r2-reader.js';
import type { Env } from '../../src/types/env.js';
import type { Fetcher } from '../../src/types/io.js';
import { collectStream } from '../../src/utils/stream.js';
import { buildZip } from '../helpers/build-zip.js';
import { createHarness, type Harness } from '../helpers/harness.js';
import { memoryKv } from '../helpers/memory-kv.js';
import { memoryR2 } from '../helpers/memory-r2.js';

const encoder = new TextEncoder();
const MOVIE = new Uint8Array(3000).map((_, i) => (i * 29 + 5) & 0xff);
const CLIP = new Uint8Array(1500).map((_, i) => (i * 11 + 2) & 0xff);

/** No HTTP origin should ever be touched when every source is `r2://`. */
function forbiddenFetch(): Fetcher {
  return () => Promise.reject(new Error('an r2:// source must not make an HTTP request'));
}

describe('r2:// source addressing', () => {
  it('recognises and round-trips keys, including awkward ones', () => {
    expect(isR2Source('r2://media/movie.mkv')).toBe(true);
    expect(isR2Source('https://example.com/a.zip')).toBe(false);
    expect(r2Key('r2://media/movie.mkv')).toBe('media/movie.mkv');
    // Percent-encoding lets callers address keys with spaces and hashes.
    expect(r2Key('r2://media/My%20Movie%20%232.mkv')).toBe('media/My Movie #2.mkv');
    expect(r2Key('r2:///leading/slashes.bin')).toBe('leading/slashes.bin');
    expect(r2Source('media/movie.mkv')).toBe('r2://media/movie.mkv');
  });
});

describe('R2RangeReader', () => {
  it('reports size and validators from a single head, then serves ranges', async () => {
    const bucket = memoryR2({ 'a/big.bin': MOVIE });
    const reader = await R2RangeReader.open(bucket, 'a/big.bin');

    expect(reader.size).toBe(MOVIE.byteLength);
    expect(reader.validators.etag).toBeTruthy();
    expect(reader.validators.lastModified).toBeTruthy();

    expect(await reader.read(100, 50)).toEqual(MOVIE.subarray(100, 150));

    const stream = await reader.stream(2000, 400);
    expect(stream.length).toBe(400);
    expect(await collectStream(stream.body)).toEqual(MOVIE.subarray(2000, 2400));
  });

  it('reports a missing object clearly', async () => {
    const bucket = memoryR2({});
    await expect(R2RangeReader.open(bucket, 'nope.bin')).rejects.toThrow(/not found/i);
  });
});

describe('archives read from R2', () => {
  async function setup(env: Partial<Env> = {}): Promise<Harness> {
    const zip = await buildZip([
      { name: 'movie.bin', data: MOVIE, method: 'stored' },
      { name: 'notes.txt', data: encoder.encode('hello from r2'), method: 'deflate' },
    ]);
    return createHarness({
      fetch: forbiddenFetch(),
      env: {
        ARCHIVE_URL: 'r2://archives/test.zip',
        R2_BUCKET: memoryR2({ 'archives/test.zip': zip }),
        ...env,
      },
    });
  }

  it('lists an archive stored in the bucket, without any HTTP request', async () => {
    const harness = await setup();
    const res = await harness.request('/__/list');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: { name: string }[] };
    expect(body.entries.map((e) => e.name)).toEqual(['movie.bin', 'notes.txt']);
  });

  it('downloads an entry, and serves ranges out of it', async () => {
    const harness = await setup();
    const whole = await harness.request('/movie.bin');
    expect(whole.status).toBe(200);
    expect(new Uint8Array(await whole.arrayBuffer())).toEqual(MOVIE);

    const partial = await harness.request('/movie.bin', { headers: { range: 'bytes=100-199' } });
    expect(partial.status).toBe(206);
    expect(new Uint8Array(await partial.arrayBuffer())).toEqual(MOVIE.subarray(100, 200));
  });

  it('refuses when no bucket is bound', async () => {
    const harness = createHarness({
      fetch: forbiddenFetch(),
      env: { ARCHIVE_URL: 'r2://archives/test.zip' },
    });
    const res = await harness.request('/__/list');
    expect(res.status).toBe(503);
  });

  it('honours R2_PREFIX', async () => {
    const harness = await setup({ R2_PREFIX: 'public/' });
    const res = await harness.request('/__/list');
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toContain('prefix');
  });
});

describe('bundles from R2', () => {
  interface Summary {
    readonly code: string;
    readonly tar: string;
    readonly zip: string;
    readonly tarBytes: number;
    readonly files: { name: string; size: number }[];
    readonly complete?: boolean;
  }

  function setup(env: Partial<Env> = {}): Harness {
    return createHarness({
      fetch: forbiddenFetch(),
      env: {
        ALLOW_ANY_ARCHIVE_HOST: 'true',
        LINKS_KV: memoryKv(),
        R2_BUCKET: memoryR2({ 'media/movie.mkv': MOVIE, 'media/clip.mp4': CLIP }),
        ...env,
      },
    });
  }

  async function create(harness: Harness): Promise<Summary> {
    const res = await harness.request('/__/bundle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        files: [{ url: 'r2://media/movie.mkv' }, { url: 'r2://media/clip.mp4' }],
        name: 'from-r2',
      }),
    });
    expect(res.status).toBe(200);
    return (await res.json()) as Summary;
  }

  it('probes objects with head and names them from the key', async () => {
    const summary = await create(setup());
    expect(summary.files).toEqual([
      { name: 'movie.mkv', size: MOVIE.byteLength, crc: false },
      { name: 'clip.mp4', size: CLIP.byteLength, crc: false },
    ]);
  });

  it('streams a TAR built entirely from bucket objects', async () => {
    const harness = setup();
    const summary = await create(harness);
    const res = await harness.request(summary.tar);
    expect(res.status).toBe(200);

    const tar = new Uint8Array(await res.arrayBuffer());
    expect(tar.byteLength).toBe(summary.tarBytes);
    // Payloads land after their 512-byte headers.
    expect(tar.subarray(512, 512 + MOVIE.byteLength)).toEqual(MOVIE);
  });

  it('prepares and streams a ZIP, and serves ranges from it', async () => {
    const harness = setup();
    const summary = await create(harness);

    const prepared = await harness.request(`/__/bundle/${summary.code}/prepare`, { method: 'POST' });
    expect(((await prepared.json()) as Summary).complete).toBe(true);

    const whole = await harness.request(summary.zip);
    expect(whole.status).toBe(200);
    const bytes = new Uint8Array(await whole.arrayBuffer());

    const part = await harness.request(summary.zip, { headers: { range: 'bytes=200-399' } });
    expect(part.status).toBe(206);
    expect(new Uint8Array(await part.arrayBuffer())).toEqual(bytes.subarray(200, 400));
  });

  it('rejects keys outside R2_PREFIX', async () => {
    const harness = setup({ R2_PREFIX: 'public/' });
    const res = await harness.request('/__/bundle', {
      method: 'POST',
      body: JSON.stringify({ files: [{ url: 'r2://media/movie.mkv' }] }),
    });
    expect(res.status).toBe(403);
  });

  it('reports a missing object rather than emitting a broken archive', async () => {
    const harness = setup();
    const res = await harness.request('/__/bundle', {
      method: 'POST',
      body: JSON.stringify({ files: [{ url: 'r2://media/absent.mkv' }] }),
    });
    expect(res.status).toBe(404);
  });
});
