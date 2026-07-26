import { GeneralPurposeFlag, RecordSize, Signature } from '../constants/zip.js';
import { MalformedArchiveError, PayloadTooLargeError } from '../errors/http-error.js';
import type { CentralDirectory, EndOfCentralDirectory, ZipEntry } from '../types/zip.js';
import type { RangeReader } from '../types/io.js';
import { ByteView } from '../utils/bytes.js';
import { applyZip64Extra, readUnicodePath } from './extra.js';
import { dosDateTimeToEpochMs } from './dos-time.js';
import { decodeEntryName, isDirectoryName } from './name.js';

export interface CentralDirectoryLimits {
  readonly maxBytes: number;
  readonly maxEntries: number;
}

/** Enforce the size/entry ceilings that bound memory before any buffering. */
export function assertCentralDirectoryWithinLimits(
  eocd: EndOfCentralDirectory,
  limits: CentralDirectoryLimits,
): void {
  if (eocd.centralDirectorySize > limits.maxBytes) {
    throw new PayloadTooLargeError('central directory exceeds the configured maximum', {
      centralDirectorySize: eocd.centralDirectorySize,
      maxBytes: limits.maxBytes,
    });
  }
  if (eocd.entryCount > limits.maxEntries) {
    throw new PayloadTooLargeError('archive has more entries than the configured maximum', {
      entryCount: eocd.entryCount,
      maxEntries: limits.maxEntries,
    });
  }
}

/**
 * Read the central-directory bytes through the reader and parse them. Ceilings
 * are checked first so a hostile or corrupt archive can never make the Worker
 * allocate unbounded memory.
 */
export async function readCentralDirectory(
  reader: RangeReader,
  eocd: EndOfCentralDirectory,
  limits: CentralDirectoryLimits,
  signal?: AbortSignal,
): Promise<CentralDirectory> {
  assertCentralDirectoryWithinLimits(eocd, limits);
  const bytes = await reader.read(eocd.centralDirectoryOffset, eocd.centralDirectorySize, signal);
  return parseCentralDirectory(bytes, eocd, reader.size);
}

/**
 * Parse central-directory bytes into an indexed {@link CentralDirectory}. Pure
 * and reader-free, so it is reused verbatim when rehydrating a cached directory.
 * Duplicate names resolve first-wins, neutralising the "same name, different
 * data" ambiguity.
 */
export function parseCentralDirectory(
  bytes: Uint8Array,
  eocd: EndOfCentralDirectory,
  archiveSize: number,
): CentralDirectory {
  const view = new ByteView(bytes);
  const entries: ZipEntry[] = [];
  const index = new Map<string, ZipEntry>();

  let position = 0;
  for (let i = 0; i < eocd.entryCount; i++) {
    if (position + RecordSize.CENTRAL_FILE_HEADER > bytes.byteLength) {
      throw new MalformedArchiveError('central directory is truncated', { parsed: i });
    }
    if (view.u32(position) !== Signature.CENTRAL_FILE_HEADER) {
      throw new MalformedArchiveError('invalid central directory header signature', { entry: i });
    }
    const parsed = parseCentralDirectoryEntry(view, position, eocd.centralDirectoryOffset);
    entries.push(parsed.entry);
    if (!index.has(parsed.entry.name)) {
      index.set(parsed.entry.name, parsed.entry);
    }
    position = parsed.next;
  }

  return { entries, index, isZip64: eocd.isZip64, archiveSize };
}

interface ParsedEntry {
  readonly entry: ZipEntry;
  readonly next: number;
}

function parseCentralDirectoryEntry(view: ByteView, position: number, cdOffset: number): ParsedEntry {
  const flags = view.u16(position + 8);
  const method = view.u16(position + 10);
  const modTime = view.u16(position + 12);
  const modDate = view.u16(position + 14);
  const crc32 = view.u32(position + 16);
  const compressedSize = view.u32(position + 20);
  const uncompressedSize = view.u32(position + 24);
  const nameLength = view.u16(position + 28);
  const extraLength = view.u16(position + 30);
  const commentLength = view.u16(position + 32);
  const localHeaderOffset = view.u32(position + 42);

  const nameStart = position + RecordSize.CENTRAL_FILE_HEADER;
  const extraStart = nameStart + nameLength;
  const commentStart = extraStart + extraLength;
  const next = commentStart + commentLength;

  if (next > view.length) {
    throw new MalformedArchiveError('central directory entry overruns the directory', {
      offset: cdOffset + position,
    });
  }

  const rawName = view.copy(nameStart, nameLength);
  const extra = view.slice(extraStart, extraLength);

  const resolved = applyZip64Extra(extra, { compressedSize, uncompressedSize, localHeaderOffset });
  const unicodeName = readUnicodePath(extra, rawName);
  const name = decodeEntryName(rawName, flags, unicodeName);

  const entry: ZipEntry = {
    name,
    rawName,
    method,
    compressedSize: resolved.compressedSize,
    uncompressedSize: resolved.uncompressedSize,
    crc32,
    localHeaderOffset: resolved.localHeaderOffset,
    flags,
    isDirectory: isDirectoryName(rawName),
    isEncrypted:
      (flags & GeneralPurposeFlag.ENCRYPTED) !== 0 || (flags & GeneralPurposeFlag.STRONG_ENCRYPTION) !== 0,
    hasDataDescriptor: (flags & GeneralPurposeFlag.DATA_DESCRIPTOR) !== 0,
    lastModified: dosDateTimeToEpochMs(modTime, modDate),
  };

  return { entry, next };
}
