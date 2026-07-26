import { EOCD_SEARCH_WINDOW_BYTES, RecordSize, Signature, Zip64Sentinel } from '../constants/zip.js';
import { MalformedArchiveError } from '../errors/http-error.js';
import type { EndOfCentralDirectory } from '../types/zip.js';
import type { RangeReader } from '../types/io.js';
import { ByteView } from '../utils/bytes.js';

/**
 * Locate and interpret the end-of-central-directory records, transparently
 * upgrading to ZIP64 when the classic record uses sentinel values or a ZIP64
 * locator is present. Returns the absolute location and size of the central
 * directory — the archive's index.
 *
 * The trailing search window (EOCD + max comment) is read through the
 * {@link RangeReader}, which for the HTTP reader is already resident in memory
 * from the open-time probe, so this step usually costs no extra origin request.
 */
export async function readEndOfCentralDirectory(
  reader: RangeReader,
  signal?: AbortSignal,
): Promise<EndOfCentralDirectory> {
  const size = reader.size;
  if (size < RecordSize.END_OF_CENTRAL_DIRECTORY) {
    throw new MalformedArchiveError('archive is smaller than an EOCD record', { size });
  }

  const window = Math.min(EOCD_SEARCH_WINDOW_BYTES, size);
  const tailStart = size - window;
  const tail = await reader.read(tailStart, window, signal);
  const view = new ByteView(tail);

  const eocdRel = findEndOfCentralDirectory(tail, view);
  if (eocdRel < 0) {
    throw new MalformedArchiveError('end-of-central-directory signature not found');
  }

  const diskNumber = view.u16(eocdRel + 4);
  const cdStartDisk = view.u16(eocdRel + 6);
  const diskEntryCount = view.u16(eocdRel + 8);
  let entryCount = view.u16(eocdRel + 10);
  let cdSize = view.u32(eocdRel + 12);
  let cdOffset = view.u32(eocdRel + 16);

  const needsZip64 =
    entryCount === Zip64Sentinel.UINT16 ||
    diskEntryCount === Zip64Sentinel.UINT16 ||
    cdSize === Zip64Sentinel.UINT32 ||
    cdOffset === Zip64Sentinel.UINT32;

  let isZip64 = false;

  const locatorRel = eocdRel - RecordSize.ZIP64_EOCD_LOCATOR;
  const hasLocator =
    locatorRel >= 0 && view.u32(locatorRel) === Signature.ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR;

  if (hasLocator) {
    isZip64 = true;
    const eocd64Offset = view.u64(locatorRel + 8);
    const record = await readZip64Eocd(reader, eocd64Offset, tail, tailStart, signal);
    entryCount = record.entryCount;
    cdSize = record.centralDirectorySize;
    cdOffset = record.centralDirectoryOffset;
    if (record.diskNumber !== 0 || record.cdStartDisk !== 0) {
      throw new MalformedArchiveError('multi-disk (spanned) archives are not supported');
    }
  } else if (needsZip64) {
    throw new MalformedArchiveError('ZIP64 markers present but no ZIP64 locator found');
  } else if (diskNumber !== 0 || cdStartDisk !== 0) {
    throw new MalformedArchiveError('multi-disk (spanned) archives are not supported');
  }

  if (cdOffset + cdSize > size) {
    throw new MalformedArchiveError('central directory extends beyond the archive', {
      cdOffset,
      cdSize,
      size,
    });
  }

  return {
    centralDirectoryOffset: cdOffset,
    centralDirectorySize: cdSize,
    entryCount,
    isZip64,
  };
}

interface Zip64Record {
  readonly entryCount: number;
  readonly centralDirectorySize: number;
  readonly centralDirectoryOffset: number;
  readonly diskNumber: number;
  readonly cdStartDisk: number;
}

/**
 * Read the ZIP64 EOCD record. If it lies within the already-fetched tail we read
 * it from memory; otherwise a single targeted range read fetches its fixed 56
 * bytes.
 */
async function readZip64Eocd(
  reader: RangeReader,
  offset: number,
  tail: Uint8Array,
  tailStart: number,
  signal?: AbortSignal,
): Promise<Zip64Record> {
  if (offset < 0 || offset + RecordSize.ZIP64_EOCD > reader.size) {
    throw new MalformedArchiveError('ZIP64 EOCD offset is out of bounds', { offset });
  }

  let bytes: Uint8Array;
  if (offset >= tailStart && offset + RecordSize.ZIP64_EOCD <= tailStart + tail.byteLength) {
    const rel = offset - tailStart;
    bytes = tail.subarray(rel, rel + RecordSize.ZIP64_EOCD);
  } else {
    bytes = await reader.read(offset, RecordSize.ZIP64_EOCD, signal);
  }

  const view = new ByteView(bytes);
  if (view.u32(0) !== Signature.ZIP64_END_OF_CENTRAL_DIRECTORY) {
    throw new MalformedArchiveError('bad ZIP64 EOCD signature');
  }

  return {
    diskNumber: view.u32(16),
    cdStartDisk: view.u32(20),
    entryCount: view.u64(32),
    centralDirectorySize: view.u64(40),
    centralDirectoryOffset: view.u64(48),
  };
}

/**
 * Find the EOCD record within the tail buffer. Scanning highest-offset first,
 * prefer a candidate whose comment-length field is consistent with the bytes
 * that follow it (the comment must end exactly at EOF). This rejects a spurious
 * `PK\x05\x06` that merely appears *inside* an archive comment — a real,
 * spec-legal case that a naive "last signature wins" scan mis-parses. Falls back
 * to the highest-offset signature when no candidate is consistent.
 */
function findEndOfCentralDirectory(tail: Uint8Array, view: ByteView): number {
  let fallback = -1;
  for (let i = tail.byteLength - RecordSize.END_OF_CENTRAL_DIRECTORY; i >= 0; i--) {
    if (view.u32(i) !== Signature.END_OF_CENTRAL_DIRECTORY) continue;
    if (fallback < 0) fallback = i;
    const commentLength = view.u16(i + 20);
    if (i + RecordSize.END_OF_CENTRAL_DIRECTORY + commentLength === tail.byteLength) {
      return i;
    }
  }
  return fallback;
}
