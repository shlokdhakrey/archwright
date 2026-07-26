import { MalformedArchiveError } from '../errors/http-error.js';
import type { CacheStore, Clock, RangeReader } from '../types/io.js';
import type { CentralDirectory, EndOfCentralDirectory } from '../types/zip.js';
import {
  assertCentralDirectoryWithinLimits,
  parseCentralDirectory,
  type CentralDirectoryLimits,
} from '../zip/central-directory.js';
import { readEndOfCentralDirectory } from '../zip/eocd.js';
import { ZipArchive } from '../zip/archive.js';
import { TtlLruCache } from './memo.js';

/** Where a loaded directory came from — surfaced for observability. */
export type DirectorySource = 'memo' | 'cache' | 'origin';

export interface LoadArchiveParams {
  readonly reader: RangeReader;
  /** Stable cache-key base (typically the archive URL). */
  readonly cacheKey: string;
  readonly cache: CacheStore;
  readonly clock: Clock;
  readonly limits: CentralDirectoryLimits;
  readonly ttlSeconds: number;
  readonly signal?: AbortSignal;
  /** Runs a promise past the response (Cache API writes should not block TTFB). */
  readonly background: (promise: Promise<unknown>) => void;
}

export interface LoadArchiveResult {
  readonly archive: ZipArchive;
  readonly source: DirectorySource;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * In-isolate L1 cache of parsed directories. Module-scoped so it survives across
 * requests handled by the same isolate.
 */
const directoryMemo = new TtlLruCache<CentralDirectory>(64);

/** Reset the in-isolate memo (used by tests). */
export function resetDirectoryMemo(): void {
  directoryMemo.clear();
}

/**
 * Resolve a {@link ZipArchive} for `reader`, consulting the L1 memo and the
 * durable {@link CacheStore} before parsing the central directory from the
 * origin. The cache key folds in the origin validator (ETag/Last-Modified), so a
 * changed archive naturally misses rather than serving a stale index.
 */
export async function loadArchive(params: LoadArchiveParams): Promise<LoadArchiveResult> {
  const { reader, cache, clock, limits, ttlSeconds, signal, background } = params;
  const key = deriveKey(params.cacheKey, reader);
  const now = clock.now();
  // Cache only when the origin exposes a validator. Without an ETag or
  // Last-Modified, a same-size content swap could not be distinguished from a
  // cache hit, so we refuse to cache rather than risk serving a stale index.
  const hasValidator = reader.validators.etag !== undefined || reader.validators.lastModified !== undefined;
  const cachingEnabled = ttlSeconds > 0 && hasValidator;

  if (cachingEnabled) {
    const memoDirectory = directoryMemo.get(key, now);
    if (memoDirectory) {
      if (memoDirectory.archiveSize === reader.size) {
        return { archive: new ZipArchive(reader, memoDirectory), source: 'memo' };
      }
    }

    const cached = await safeGet(cache, key);
    if (cached) {
      const directory = deserializeDirectory(cached, reader.size);
      if (directory) {
        directoryMemo.set(key, directory, now + ttlSeconds * 1000);
        return { archive: new ZipArchive(reader, directory), source: 'cache' };
      }
    }
  }

  const { directory, eocd, cdBytes } = await parseFromOrigin(reader, limits, signal);

  if (cachingEnabled) {
    directoryMemo.set(key, directory, now + ttlSeconds * 1000);
    const serialized = serializeDirectory(eocd, cdBytes);
    background(cache.set(key, serialized, ttlSeconds).catch(() => undefined));
  }

  return { archive: new ZipArchive(reader, directory), source: 'origin' };
}

interface ParsedOrigin {
  readonly directory: CentralDirectory;
  readonly eocd: EndOfCentralDirectory;
  readonly cdBytes: Uint8Array;
}

/**
 * Parse the central directory from the origin, mapping any bounds/parse
 * `RangeError` to a `MalformedArchiveError` (502) so corrupt input is reported
 * as an upstream problem rather than an internal error (500).
 */
async function parseFromOrigin(
  reader: RangeReader,
  limits: CentralDirectoryLimits,
  signal: AbortSignal | undefined,
): Promise<ParsedOrigin> {
  try {
    const eocd = await readEndOfCentralDirectory(reader, signal);
    assertCentralDirectoryWithinLimits(eocd, limits);
    const cdBytes = await reader.read(eocd.centralDirectoryOffset, eocd.centralDirectorySize, signal);
    const directory = parseCentralDirectory(cdBytes, eocd, reader.size);
    return { directory, eocd, cdBytes };
  } catch (error) {
    if (error instanceof RangeError) {
      throw new MalformedArchiveError('failed to parse the central directory', undefined, error);
    }
    throw error;
  }
}

function deriveKey(base: string, reader: RangeReader): string {
  const validatorTag = reader.validators.etag ?? reader.validators.lastModified ?? String(reader.size);
  return `${base}|${validatorTag}`;
}

async function safeGet(cache: CacheStore, key: string): Promise<Uint8Array | undefined> {
  try {
    return await cache.get(key);
  } catch {
    return undefined;
  }
}

/** `[u32 headerLength][header JSON][central-directory bytes]`. */
function serializeDirectory(eocd: EndOfCentralDirectory, cdBytes: Uint8Array): Uint8Array {
  const header = encoder.encode(
    JSON.stringify({
      v: 1,
      o: eocd.centralDirectoryOffset,
      s: eocd.centralDirectorySize,
      n: eocd.entryCount,
      z: eocd.isZip64,
    }),
  );
  const out = new Uint8Array(4 + header.byteLength + cdBytes.byteLength);
  new DataView(out.buffer).setUint32(0, header.byteLength, true);
  out.set(header, 4);
  out.set(cdBytes, 4 + header.byteLength);
  return out;
}

function deserializeDirectory(blob: Uint8Array, archiveSize: number): CentralDirectory | undefined {
  try {
    if (blob.byteLength < 4) return undefined;
    const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
    const headerLength = view.getUint32(0, true);
    if (4 + headerLength > blob.byteLength) return undefined;

    const header = JSON.parse(decoder.decode(blob.subarray(4, 4 + headerLength))) as {
      o: number;
      s: number;
      n: number;
      z: boolean;
    };
    const cdBytes = blob.subarray(4 + headerLength);
    const eocd: EndOfCentralDirectory = {
      centralDirectoryOffset: header.o,
      centralDirectorySize: header.s,
      entryCount: header.n,
      isZip64: header.z,
    };
    return parseCentralDirectory(cdBytes, eocd, archiveSize);
  } catch {
    return undefined;
  }
}
