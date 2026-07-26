import { describe, expect, it } from 'vitest';
import { BytesRangeReader } from '../../src/http/bytes-range-reader.js';
import { buildEntryStream } from '../../src/streaming/pipeline.js';
import type { ZipEntry } from '../../src/types/zip.js';
import { collectStream } from '../../src/utils/stream.js';
import { ZipArchive } from '../../src/zip/archive.js';
import { buildCombinedZip, planCombinedZip } from '../../src/zip/zip-writer.js';
import { buildZip } from '../helpers/build-zip.js';

const LIMITS = { maxBytes: 1 << 26, maxEntries: 100_000 };
const encoder = new TextEncoder();

async function open(bytes: Uint8Array): Promise<ZipArchive> {
  return ZipArchive.open(new BytesRangeReader(bytes), LIMITS);
}

async function readEntry(archive: ZipArchive, name: string): Promise<Uint8Array> {
  const entry = archive.getEntry(name)!;
  const location = await archive.resolveData(entry);
  const plan = await buildEntryStream(archive, entry, location, { kind: 'none' });
  return collectStream(plan.body);
}

function fakeEntry(overrides: Partial<ZipEntry>): ZipEntry {
  return {
    name: 'big.bin',
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

describe('buildCombinedZip — round-trip', () => {
  it('repackages selected STORED and DEFLATE entries into a valid ZIP', async () => {
    const alpha = encoder.encode('alpha '.repeat(1000));
    const bravo = encoder.encode('BRAVO'.repeat(2000));
    const binary = new Uint8Array(5000).map((_, i) => (i * 7) & 0xff);

    const source = await open(
      await buildZip([
        { name: 'a.txt', data: alpha, method: 'deflate' },
        { name: 'dir/b.txt', data: bravo, method: 'deflate' },
        { name: 'c.bin', data: binary, method: 'stored' },
      ]),
    );

    const selected = [source.getEntry('a.txt')!, source.getEntry('c.bin')!];
    const combined = buildCombinedZip(source, selected);
    const combinedBytes = await collectStream(combined.body);

    // The advertised Content-Length must equal the bytes actually produced.
    expect(combinedBytes.byteLength).toBe(combined.contentLength);
    expect(combined.zip64).toBe(false);

    // Re-parse the freshly built ZIP with our own reader.
    const out = await open(combinedBytes);
    expect(out.entries.map((e) => e.name).sort()).toEqual(['a.txt', 'c.bin']);
    expect(out.getEntry('a.txt')!.method).toBe(8); // DEFLATE preserved
    expect(out.getEntry('c.bin')!.method).toBe(0); // STORED preserved
    expect(await readEntry(out, 'a.txt')).toEqual(alpha);
    expect(await readEntry(out, 'c.bin')).toEqual(binary);
  });

  it('preserves nested paths and includes every selected entry', async () => {
    const source = await open(
      await buildZip([
        { name: 'x/y/z.txt', data: 'deep', method: 'deflate' },
        { name: 'root.txt', data: 'root', method: 'stored' },
      ]),
    );
    const combined = buildCombinedZip(source, [...source.entries]);
    const bytes = await collectStream(combined.body);

    expect(bytes.byteLength).toBe(combined.contentLength);
    const out = await open(bytes);
    expect(await readEntry(out, 'x/y/z.txt')).toEqual(encoder.encode('deep'));
    expect(await readEntry(out, 'root.txt')).toEqual(encoder.encode('root'));
  });
});

describe('planCombinedZip — layout & ZIP64', () => {
  it('computes an exact content length', () => {
    const plan = planCombinedZip([fakeEntry({ name: 'a', compressedSize: 10, uncompressedSize: 10 })]);
    // LFH(30+1) + data(10) + CDH(46+1) + EOCD(22)
    expect(plan.contentLength).toBe(31 + 10 + 47 + 22);
    expect(plan.zip64).toBe(false);
  });

  it('promotes a >4 GiB entry to ZIP64 with sentinel sizes', () => {
    const plan = planCombinedZip([
      fakeEntry({ compressedSize: 5_000_000_000, uncompressedSize: 5_000_000_000 }),
    ]);
    expect(plan.zip64).toBe(true);
    const lh = plan.planned[0]!.localHeader;
    const view = new DataView(lh.buffer, lh.byteOffset, lh.byteLength);
    expect(view.getUint32(18, true)).toBe(0xffffffff); // compressed size sentinel
    expect(view.getUint32(22, true)).toBe(0xffffffff); // uncompressed size sentinel
  });

  it('sentinels the central-directory offset once it passes 4 GiB', () => {
    const first = fakeEntry({
      name: 'first',
      compressedSize: 5_000_000_000,
      uncompressedSize: 5_000_000_000,
    });
    const plan = planCombinedZip([first, fakeEntry({ name: 'second' })]);
    expect(plan.zip64).toBe(true);
    expect(plan.planned[1]!.needsZip64Offset).toBe(true);
  });
});
