import { sanitizeHeaderValue } from '../security/sanitize.js';
import type { Validators } from '../types/http.js';
import type { ZipEntry } from '../types/zip.js';
import { uint32ToHex } from '../utils/hex.js';

/**
 * Derive strong, stable HTTP validators for a specific entry.
 *
 * The ETag folds together the archive's own validator (so a changed archive
 * invalidates all its entries) and the entry's CRC-32 and size (so it is stable
 * for identical content and distinct for different content). `Last-Modified`
 * comes from the entry's DOS timestamp.
 */
export function entryValidators(archiveValidators: Validators, entry: ZipEntry): Validators {
  const archiveTag = archiveValidators.etag
    ? stripEtag(archiveValidators.etag)
    : String(entry.uncompressedSize);
  const base = sanitizeHeaderValue(archiveTag).replace(/"/g, '');
  const etag = `"${base}.${uint32ToHex(entry.crc32)}.${entry.uncompressedSize}"`;
  const lastModified = new Date(entry.lastModified).toUTCString();
  return { etag, lastModified };
}

function stripEtag(tag: string): string {
  return tag.replace(/^W\//, '').replace(/^"|"$/g, '');
}
