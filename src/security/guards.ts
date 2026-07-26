import { CompressionMethod } from '../constants/zip.js';
import {
  ForbiddenError,
  MalformedArchiveError,
  NotFoundError,
  PayloadTooLargeError,
  UnsupportedEntryError,
} from '../errors/http-error.js';
import type { Config } from '../types/config.js';
import type { ZipEntry } from '../types/zip.js';
import { isSupportedMethod, methodName } from '../zip/method.js';

/**
 * Decide whether an entry may be served, enforcing every content-level safety
 * rule in one place:
 *  - directories and encrypted entries are refused;
 *  - unsupported compression methods are refused;
 *  - oversized entries and implausible compression ratios (ZIP-bomb signals) are
 *    rejected *before* any streaming begins, using only the trusted central-
 *    directory metadata.
 *
 * Because bodies always stream, a bomb cannot exhaust the Worker's memory; these
 * guards additionally bound CPU (decompression work) and egress.
 */
export function assertEntryServable(entry: ZipEntry, config: Config): void {
  if (entry.isDirectory) {
    throw new NotFoundError('the requested entry is a directory', { name: entry.name });
  }
  if (entry.isEncrypted) {
    throw new UnsupportedEntryError('encrypted entries are not supported', { name: entry.name });
  }
  if (!isSupportedMethod(entry.method)) {
    throw new UnsupportedEntryError(`compression method "${methodName(entry.method)}" is not supported`, {
      name: entry.name,
      method: entry.method,
    });
  }
  // For STORED entries the compressed and uncompressed sizes must be equal by
  // definition; a mismatch is a malformed/hostile header that would desync the
  // advertised Content-Length from the streamed bytes.
  if (entry.method === CompressionMethod.STORED && entry.compressedSize !== entry.uncompressedSize) {
    throw new MalformedArchiveError('stored entry has mismatched compressed/uncompressed sizes', {
      name: entry.name,
      compressedSize: entry.compressedSize,
      uncompressedSize: entry.uncompressedSize,
    });
  }

  if (config.maxUncompressedBytes > 0 && entry.uncompressedSize > config.maxUncompressedBytes) {
    throw new PayloadTooLargeError('entry is larger than the configured maximum', {
      uncompressedSize: entry.uncompressedSize,
      maxUncompressedBytes: config.maxUncompressedBytes,
    });
  }

  if (
    config.maxCompressionRatio > 0 &&
    entry.compressedSize > 0 &&
    entry.uncompressedSize / entry.compressedSize > config.maxCompressionRatio
  ) {
    throw new ForbiddenError('entry compression ratio exceeds the safety threshold', {
      ratio: Math.round(entry.uncompressedSize / entry.compressedSize),
      maxCompressionRatio: config.maxCompressionRatio,
    });
  }
}
