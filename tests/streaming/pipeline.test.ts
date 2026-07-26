import { describe, expect, it } from 'vitest';
import { BytesRangeReader } from '../../src/http/bytes-range-reader.js';
import { buildEntryStream, selectionFor } from '../../src/streaming/pipeline.js';
import type { RangeParseResult } from '../../src/types/http.js';
import type { ZipEntry } from '../../src/types/zip.js';
import { collectStream } from '../../src/utils/stream.js';
import { ZipArchive } from '../../src/zip/archive.js';
import { buildZip, type FixtureEntry } from '../helpers/build-zip.js';

const LIMITS = { maxBytes: 1 << 26, maxEntries: 100_000 };
const encoder = new TextEncoder();

async function openWith(entries: readonly FixtureEntry[]): Promise<ZipArchive> {
  const bytes = await buildZip(entries);
  return ZipArchive.open(new BytesRangeReader(bytes), LIMITS);
}

async function serve(archive: ZipArchive, name: string, range: RangeParseResult): Promise<Uint8Array> {
  const entry = archive.getEntry(name)!;
  const location = await archive.resolveData(entry);
  const plan = await buildEntryStream(archive, entry, location, range);
  return collectStream(plan.body);
}

function entryStub(overrides: Partial<ZipEntry>): ZipEntry {
  return {
    name: 'x',
    rawName: new Uint8Array(0),
    method: 0,
    compressedSize: 100,
    uncompressedSize: 100,
    crc32: 0,
    localHeaderOffset: 0,
    flags: 0,
    isDirectory: false,
    isEncrypted: false,
    hasDataDescriptor: false,
    lastModified: 0,
    ...overrides,
  };
}

describe('selectionFor', () => {
  it('maps no range to a 200 full-length selection', () => {
    const selection = selectionFor(entryStub({ uncompressedSize: 500 }), { kind: 'none' });
    expect(selection.status).toBe(200);
    expect(selection.contentLength).toBe(500);
    expect(selection.contentRange).toBeUndefined();
  });

  it('maps a satisfiable range to a 206 with Content-Range', () => {
    const selection = selectionFor(entryStub({ uncompressedSize: 500 }), {
      kind: 'satisfiable',
      range: { start: 100, end: 199 },
    });
    expect(selection.status).toBe(206);
    expect(selection.contentLength).toBe(100);
    expect(selection.contentRange).toBe('bytes 100-199/500');
  });
});

describe('buildEntryStream — STORED ranges (random access)', () => {
  it('serves an exact byte window mapped onto the origin', async () => {
    const data = encoder.encode('0123456789'.repeat(100));
    const archive = await openWith([{ name: 'f.txt', data, method: 'stored' }]);
    const out = await serve(archive, 'f.txt', { kind: 'satisfiable', range: { start: 5, end: 24 } });
    expect(out).toEqual(data.subarray(5, 25));
  });
});

describe('buildEntryStream — DEFLATE ranges (sequential access)', () => {
  it('inflates from the start and slices out the requested window', async () => {
    const data = encoder.encode('The quick brown fox. '.repeat(1000));
    const archive = await openWith([{ name: 'f.txt', data, method: 'deflate' }]);
    const out = await serve(archive, 'f.txt', { kind: 'satisfiable', range: { start: 1000, end: 1099 } });
    expect(out).toEqual(data.subarray(1000, 1100));
  });

  it('caps a full DEFLATE body at the declared uncompressed length', async () => {
    const data = encoder.encode('payload '.repeat(4096));
    const archive = await openWith([{ name: 'f.txt', data, method: 'deflate' }]);
    const out = await serve(archive, 'f.txt', { kind: 'none' });
    expect(out.byteLength).toBe(data.byteLength);
    expect(out).toEqual(data);
  });
});
