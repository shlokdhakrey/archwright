import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config/parse.js';
import {
  ForbiddenError,
  MalformedArchiveError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedEntryError,
} from '../../src/errors/http-error.js';
import { assertEntryServable } from '../../src/security/guards.js';
import type { ZipEntry } from '../../src/types/zip.js';

function entry(overrides: Partial<ZipEntry>): ZipEntry {
  return {
    name: 'file.bin',
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

describe('assertEntryServable', () => {
  const config = parseConfig({});

  it('accepts a normal stored entry', () => {
    expect(() => assertEntryServable(entry({}), config)).not.toThrow();
  });

  it('rejects directories', () => {
    expect(() => assertEntryServable(entry({ isDirectory: true }), config)).toThrow(NotFoundError);
  });

  it('rejects encrypted entries', () => {
    expect(() => assertEntryServable(entry({ isEncrypted: true }), config)).toThrow(UnsupportedEntryError);
  });

  it('rejects unsupported compression methods', () => {
    expect(() => assertEntryServable(entry({ method: 99 }), config)).toThrow(UnsupportedEntryError);
  });

  it('rejects a STORED entry whose compressed and uncompressed sizes differ', () => {
    const mismatched = entry({ method: 0, compressedSize: 100, uncompressedSize: 200 });
    expect(() => assertEntryServable(mismatched, config)).toThrow(MalformedArchiveError);
  });

  it('rejects entries larger than the configured maximum', () => {
    const limited = parseConfig({ MAX_UNCOMPRESSED_BYTES: '100' });
    const big = entry({ method: 8, compressedSize: 50, uncompressedSize: 200 });
    expect(() => assertEntryServable(big, limited)).toThrow(PayloadTooLargeError);
  });

  it('rejects entries whose compression ratio exceeds the threshold', () => {
    const limited = parseConfig({ MAX_COMPRESSION_RATIO: '10' });
    const bomb = entry({ method: 8, compressedSize: 10, uncompressedSize: 100_000 });
    expect(() => assertEntryServable(bomb, limited)).toThrow(ForbiddenError);
  });
});
