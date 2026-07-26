import { describe, expect, it } from 'vitest';
import { BytesRangeReader } from '../../src/http/bytes-range-reader.js';
import { MalformedArchiveError } from '../../src/errors/http-error.js';
import { buildEntryStream } from '../../src/streaming/pipeline.js';
import { collectStream } from '../../src/utils/stream.js';
import { crc32 } from '../../src/zip/crc32.js';
import { ZipArchive } from '../../src/zip/archive.js';
import { buildZip, type BuildZipOptions, type FixtureEntry } from '../helpers/build-zip.js';

const LIMITS = { maxBytes: 1 << 26, maxEntries: 100_000 };
const encoder = new TextEncoder();

async function open(entries: readonly FixtureEntry[], options?: BuildZipOptions): Promise<ZipArchive> {
  const bytes = await buildZip(entries, options);
  return ZipArchive.open(new BytesRangeReader(bytes), LIMITS);
}

async function readEntry(archive: ZipArchive, name: string): Promise<Uint8Array> {
  const entry = archive.getEntry(name);
  expect(entry, `entry ${name} should exist`).toBeDefined();
  const location = await archive.resolveData(entry!);
  const plan = await buildEntryStream(archive, entry!, location, { kind: 'none' });
  return collectStream(plan.body);
}

describe('ZIP parsing — STORED', () => {
  it('parses metadata and round-trips the data', async () => {
    const data = encoder.encode('hello world '.repeat(1000));
    const archive = await open([{ name: 'hello.txt', data, method: 'stored' }]);

    expect(archive.entries).toHaveLength(1);
    const entry = archive.getEntry('hello.txt')!;
    expect(entry.method).toBe(0);
    expect(entry.uncompressedSize).toBe(data.byteLength);
    expect(entry.compressedSize).toBe(data.byteLength);
    expect(entry.crc32).toBe(crc32(data));
    expect(entry.isDirectory).toBe(false);

    expect(await readEntry(archive, 'hello.txt')).toEqual(data);
  });
});

describe('ZIP parsing — DEFLATE', () => {
  it('inflates a compressible entry back to the original bytes', async () => {
    const data = encoder.encode('A'.repeat(50_000));
    const archive = await open([{ name: 'zeros.txt', data, method: 'deflate' }]);

    const entry = archive.getEntry('zeros.txt')!;
    expect(entry.method).toBe(8);
    expect(entry.compressedSize).toBeLessThan(entry.uncompressedSize);
    expect(entry.uncompressedSize).toBe(data.byteLength);

    expect(await readEntry(archive, 'zeros.txt')).toEqual(data);
  });

  it('handles incompressible data (compressed ≥ uncompressed)', async () => {
    const data = new Uint8Array(20_000);
    for (let i = 0; i < data.length; i++) data[i] = (i * 2654435761) & 0xff;
    const archive = await open([{ name: 'random.bin', data, method: 'deflate' }]);
    expect(await readEntry(archive, 'random.bin')).toEqual(data);
  });
});

describe('ZIP parsing — multiple entries and folders', () => {
  it('indexes every entry by its normalised name', async () => {
    const archive = await open([
      { name: 'a.txt', data: 'alpha' },
      { name: 'dir/', data: '' },
      { name: 'dir/b.txt', data: 'bravo', method: 'deflate' },
      { name: 'dir/sub/c.txt', data: 'charlie' },
    ]);

    expect(archive.entries).toHaveLength(4);
    expect(archive.getEntry('dir/')!.isDirectory).toBe(true);
    expect(await readEntry(archive, 'dir/b.txt')).toEqual(encoder.encode('bravo'));
    expect(await readEntry(archive, 'dir/sub/c.txt')).toEqual(encoder.encode('charlie'));
  });
});

describe('ZIP parsing — data descriptor (flag bit 3)', () => {
  it('trusts the central directory when the local header sizes are zeroed', async () => {
    const data = encoder.encode('streamed content '.repeat(500));
    const archive = await open([{ name: 'streamed.txt', data, method: 'deflate', dataDescriptor: true }]);

    const entry = archive.getEntry('streamed.txt')!;
    expect(entry.hasDataDescriptor).toBe(true);
    expect(entry.uncompressedSize).toBe(data.byteLength);
    expect(entry.crc32).toBe(crc32(data));
    // Correct data offset requires reading the LFH, not the CD extra length.
    expect(await readEntry(archive, 'streamed.txt')).toEqual(data);
  });
});

describe('ZIP parsing — ZIP64', () => {
  it('resolves 64-bit sizes and offsets from the ZIP64 records and extra fields', async () => {
    const data = encoder.encode('zip64 payload '.repeat(2000));
    const archive = await open(
      [
        { name: 'one.txt', data, method: 'stored' },
        { name: 'two.txt', data: 'second', method: 'deflate' },
      ],
      { zip64: true },
    );

    expect(archive.directory.isZip64).toBe(true);
    expect(archive.entries).toHaveLength(2);
    expect(await readEntry(archive, 'one.txt')).toEqual(data);
    expect(await readEntry(archive, 'two.txt')).toEqual(encoder.encode('second'));
  });
});

describe('ZIP parsing — Unicode names', () => {
  it('decodes UTF-8 entry names', async () => {
    const name = 'фильм/Ω-über — 日本語.txt';
    const archive = await open([{ name, data: 'unicode' }]);
    expect(archive.getEntry(name.normalize('NFC'))).toBeDefined();
  });
});

describe('ZIP parsing — archive comment', () => {
  it('locates the EOCD past a trailing archive comment', async () => {
    const archive = await open([{ name: 'x', data: 'y' }], { archiveComment: 'a comment '.repeat(50) });
    expect(archive.entries).toHaveLength(1);
  });

  it('ignores a spurious EOCD signature embedded in the comment', async () => {
    // The comment begins with the raw EOCD signature bytes (PK\x05\x06) — a
    // legal ZIP that a naive "last signature wins" scan would mis-parse.
    const fakeSignature = 'PK';
    const archive = await open([{ name: 'real.txt', data: 'hello world' }], {
      archiveComment: fakeSignature + String.fromCharCode(0x05, 0x06) + 'X'.repeat(60),
    });
    expect(archive.entries).toHaveLength(1);
    expect(archive.getEntry('real.txt')).toBeDefined();
    expect(await readEntry(archive, 'real.txt')).toEqual(encoder.encode('hello world'));
  });
});

describe('ZIP parsing — malformed input', () => {
  it('rejects a buffer with no EOCD signature', async () => {
    const junk = new Uint8Array(1000).fill(0x41);
    await expect(ZipArchive.open(new BytesRangeReader(junk), LIMITS)).rejects.toBeInstanceOf(
      MalformedArchiveError,
    );
  });

  it('rejects a buffer smaller than an EOCD record', async () => {
    await expect(ZipArchive.open(new BytesRangeReader(new Uint8Array(4)), LIMITS)).rejects.toBeInstanceOf(
      MalformedArchiveError,
    );
  });
});
