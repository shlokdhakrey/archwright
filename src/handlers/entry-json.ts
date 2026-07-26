import { contentTypeFromName } from '../http/content-type.js';
import { CompressionMethod } from '../constants/zip.js';
import type { ZipEntry } from '../types/zip.js';
import { uint32ToHex } from '../utils/hex.js';
import { methodName } from '../zip/method.js';

/** The JSON projection of an entry used by the list and metadata endpoints. */
export function entryToJson(entry: ZipEntry): Record<string, unknown> {
  return {
    name: entry.name,
    size: entry.uncompressedSize,
    compressedSize: entry.compressedSize,
    method: methodName(entry.method),
    directory: entry.isDirectory,
    encrypted: entry.isEncrypted,
    crc32: uint32ToHex(entry.crc32),
    lastModified: new Date(entry.lastModified).toISOString(),
    contentType: contentTypeFromName(entry.name),
    // STORED entries support efficient random-access ranges; DEFLATE entries are
    // range-capable but seek sequentially (documented in the API).
    randomAccess: entry.method === CompressionMethod.STORED,
  };
}
