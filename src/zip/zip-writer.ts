import { Signature } from '../constants/zip.js';
import { closePipe, createBytePipe, pumpBody, writeChunk } from '../streaming/native-stream.js';
import type { ZipEntry } from '../types/zip.js';
import { concatBytes } from '../utils/bytes.js';
import type { ZipArchive } from './archive.js';
import { epochMsToDosDateTime } from './dos-time.js';

/**
 * Streaming ZIP *writer* — the mirror image of the reader. It repackages a
 * selection of entries from a source archive into a brand-new ZIP that streams
 * to the client, with three important properties:
 *
 *  - **Zero re-compression.** Each entry's stored bytes are copied verbatim (a
 *    DEFLATE entry stays DEFLATE, STORED stays STORED) and its CRC/sizes are
 *    reused from the source central directory. No inflate, no deflate.
 *  - **Constant memory.** Local headers are tiny; entry data is streamed through,
 *    never buffered. Only the central directory (bounded by the selection count)
 *    is assembled in memory.
 *  - **Known Content-Length.** Because every size is known up front, the exact
 *    output size is computed before a byte is sent — so the browser gets a real
 *    progress bar. Full ZIP64 is emitted when offsets/sizes exceed 32 bits.
 */

const U16_MAX = 0xffff;
const U32_MAX = 0xffffffff;
const VERSION_DEFAULT = 20;
const VERSION_ZIP64 = 45;
const FLAG_UTF8 = 0x0800;
const ZIP64_EXTRA_ID = 0x0001;

const LFH_FIXED = 30;
const CDH_FIXED = 46;
const EOCD_FIXED = 22;
const ZIP64_EOCD_FIXED = 56;
const ZIP64_LOCATOR_FIXED = 20;

const encoder = new TextEncoder();

interface PlannedEntry {
  readonly entry: ZipEntry;
  readonly localHeaderOffset: number;
  readonly needsZip64Size: boolean;
  readonly needsZip64Offset: boolean;
  readonly localHeader: Uint8Array;
}

export interface CombinedZipPlan {
  readonly planned: readonly PlannedEntry[];
  readonly centralDirectory: Uint8Array;
  readonly endRecord: Uint8Array;
  readonly contentLength: number;
  readonly zip64: boolean;
}

export interface CombinedZip {
  readonly body: ReadableStream<Uint8Array>;
  readonly contentLength: number;
  readonly zip64: boolean;
  readonly entryCount: number;
}

export interface BuildCombinedZipOptions {
  readonly signal?: AbortSignal;
  readonly onBytes?: (bytes: number) => void;
}

/**
 * Compute the full byte layout of the combined archive without fetching any
 * data. Deterministic and pure, so it is unit-tested directly (including the
 * ZIP64 promotions) and yields the exact Content-Length.
 */
export function planCombinedZip(entries: readonly ZipEntry[]): CombinedZipPlan {
  const planned: PlannedEntry[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const needsZip64Size = entry.uncompressedSize >= U32_MAX || entry.compressedSize >= U32_MAX;
    const localHeaderOffset = offset;
    const needsZip64Offset = localHeaderOffset >= U32_MAX;
    const localHeader = buildLocalHeader(entry, nameBytes, needsZip64Size);
    planned.push({ entry, localHeaderOffset, needsZip64Size, needsZip64Offset, localHeader });
    offset += localHeader.byteLength + entry.compressedSize;
  }

  const centralDirectoryOffset = offset;
  const cdParts = planned.map((item) =>
    buildCentralHeader(item.entry, item.localHeaderOffset, item.needsZip64Size, item.needsZip64Offset),
  );
  const centralDirectory = concatBytes(cdParts);
  const centralDirectorySize = centralDirectory.byteLength;

  const zip64 =
    entries.length > U16_MAX || centralDirectorySize >= U32_MAX || centralDirectoryOffset >= U32_MAX;

  const endRecord = buildEndRecords(entries.length, centralDirectorySize, centralDirectoryOffset, zip64);
  const contentLength = centralDirectoryOffset + centralDirectorySize + endRecord.byteLength;

  return { planned, centralDirectory, endRecord, contentLength, zip64 };
}

/**
 * Build the streaming combined ZIP for `entries` selected from `archive`.
 *
 * Entry payloads are moved with `pipeTo` into a native pipe, so their bytes
 * never pass through the JS isolate — a multi-gigabyte selection costs the
 * Worker almost no CPU (see `streaming/native-stream.ts`). Only the small
 * headers are written from JS. Nothing is checksummed here: every entry is
 * copied verbatim, so the CRC-32s come straight from the source central
 * directory.
 */
export function buildCombinedZip(
  archive: ZipArchive,
  entries: readonly ZipEntry[],
  options: BuildCombinedZipOptions = {},
): CombinedZip {
  const plan = planCombinedZip(entries);
  const pipe = createBytePipe(plan.contentLength);
  // Detached writer task: the response body keeps the Worker alive while the
  // client drains it, so this runs to completion as the bytes are consumed.
  void writeCombinedZip(archive, plan, pipe.writable, options);
  return {
    body: pipe.readable,
    contentLength: plan.contentLength,
    zip64: plan.zip64,
    entryCount: entries.length,
  };
}

async function writeCombinedZip(
  archive: ZipArchive,
  plan: CombinedZipPlan,
  writable: WritableStream<Uint8Array>,
  options: BuildCombinedZipOptions,
): Promise<void> {
  const { signal } = options;
  try {
    for (const item of plan.planned) {
      await writeChunk(writable, item.localHeader);
      const location = await archive.resolveData(item.entry, signal);
      const { body } = await archive.stream(location.offset, location.length, signal);
      await pumpBody(writable, body);
    }
    await writeChunk(writable, plan.centralDirectory);
    await writeChunk(writable, plan.endRecord);
    await closePipe(writable);
    options.onBytes?.(plan.contentLength);
  } catch (error) {
    // A client disconnect lands here too; aborting cancels the origin fetch.
    await writable.abort(error).catch(() => undefined);
  }
}

// --- header builders ---------------------------------------------------------

function buildLocalHeader(entry: ZipEntry, nameBytes: Uint8Array, needsZip64Size: boolean): Uint8Array {
  const dos = epochMsToDosDateTime(entry.lastModified);
  const extraLength = needsZip64Size ? 4 + 16 : 0;
  const buffer = new Uint8Array(LFH_FIXED + nameBytes.byteLength + extraLength);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, Signature.LOCAL_FILE_HEADER, true);
  view.setUint16(4, needsZip64Size ? VERSION_ZIP64 : VERSION_DEFAULT, true);
  view.setUint16(6, FLAG_UTF8, true);
  view.setUint16(8, entry.method, true);
  view.setUint16(10, dos.time, true);
  view.setUint16(12, dos.date, true);
  view.setUint32(14, entry.crc32, true);
  view.setUint32(18, needsZip64Size ? U32_MAX : entry.compressedSize, true);
  view.setUint32(22, needsZip64Size ? U32_MAX : entry.uncompressedSize, true);
  view.setUint16(26, nameBytes.byteLength, true);
  view.setUint16(28, extraLength, true);
  buffer.set(nameBytes, LFH_FIXED);

  if (needsZip64Size) {
    const extraOffset = LFH_FIXED + nameBytes.byteLength;
    view.setUint16(extraOffset, ZIP64_EXTRA_ID, true);
    view.setUint16(extraOffset + 2, 16, true);
    view.setBigUint64(extraOffset + 4, BigInt(entry.uncompressedSize), true);
    view.setBigUint64(extraOffset + 12, BigInt(entry.compressedSize), true);
  }

  return buffer;
}

function buildCentralHeader(
  entry: ZipEntry,
  localHeaderOffset: number,
  needsZip64Size: boolean,
  needsZip64Offset: boolean,
): Uint8Array {
  const dos = epochMsToDosDateTime(entry.lastModified);
  const nameBytes = encoder.encode(entry.name);
  const zip64Payload = (needsZip64Size ? 16 : 0) + (needsZip64Offset ? 8 : 0);
  const extraLength = zip64Payload > 0 ? 4 + zip64Payload : 0;
  const buffer = new Uint8Array(CDH_FIXED + nameBytes.byteLength + extraLength);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, Signature.CENTRAL_FILE_HEADER, true);
  view.setUint16(4, VERSION_ZIP64, true);
  view.setUint16(6, needsZip64Size || needsZip64Offset ? VERSION_ZIP64 : VERSION_DEFAULT, true);
  view.setUint16(8, FLAG_UTF8, true);
  view.setUint16(10, entry.method, true);
  view.setUint16(12, dos.time, true);
  view.setUint16(14, dos.date, true);
  view.setUint32(16, entry.crc32, true);
  view.setUint32(20, needsZip64Size ? U32_MAX : entry.compressedSize, true);
  view.setUint32(24, needsZip64Size ? U32_MAX : entry.uncompressedSize, true);
  view.setUint16(28, nameBytes.byteLength, true);
  view.setUint16(30, extraLength, true);
  view.setUint16(32, 0, true); // comment length
  view.setUint16(34, 0, true); // disk number start
  view.setUint16(36, 0, true); // internal attributes
  view.setUint32(38, 0, true); // external attributes
  view.setUint32(42, needsZip64Offset ? U32_MAX : localHeaderOffset, true);
  buffer.set(nameBytes, CDH_FIXED);

  if (extraLength > 0) {
    let p = CDH_FIXED + nameBytes.byteLength;
    view.setUint16(p, ZIP64_EXTRA_ID, true);
    view.setUint16(p + 2, zip64Payload, true);
    p += 4;
    if (needsZip64Size) {
      view.setBigUint64(p, BigInt(entry.uncompressedSize), true);
      view.setBigUint64(p + 8, BigInt(entry.compressedSize), true);
      p += 16;
    }
    if (needsZip64Offset) {
      view.setBigUint64(p, BigInt(localHeaderOffset), true);
    }
  }

  return buffer;
}

function buildEndRecords(
  entryCount: number,
  centralDirectorySize: number,
  centralDirectoryOffset: number,
  zip64: boolean,
): Uint8Array {
  const parts: Uint8Array[] = [];

  if (zip64) {
    const eocd64 = new Uint8Array(ZIP64_EOCD_FIXED);
    const z = new DataView(eocd64.buffer);
    z.setUint32(0, Signature.ZIP64_END_OF_CENTRAL_DIRECTORY, true);
    z.setBigUint64(4, BigInt(ZIP64_EOCD_FIXED - 12), true);
    z.setUint16(12, VERSION_ZIP64, true);
    z.setUint16(14, VERSION_ZIP64, true);
    z.setUint32(16, 0, true);
    z.setUint32(20, 0, true);
    z.setBigUint64(24, BigInt(entryCount), true);
    z.setBigUint64(32, BigInt(entryCount), true);
    z.setBigUint64(40, BigInt(centralDirectorySize), true);
    z.setBigUint64(48, BigInt(centralDirectoryOffset), true);
    parts.push(eocd64);

    const locator = new Uint8Array(ZIP64_LOCATOR_FIXED);
    const l = new DataView(locator.buffer);
    l.setUint32(0, Signature.ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR, true);
    l.setUint32(4, 0, true);
    l.setBigUint64(8, BigInt(centralDirectoryOffset + centralDirectorySize), true);
    l.setUint32(16, 1, true);
    parts.push(locator);
  }

  const eocd = new Uint8Array(EOCD_FIXED);
  const e = new DataView(eocd.buffer);
  e.setUint32(0, Signature.END_OF_CENTRAL_DIRECTORY, true);
  e.setUint16(4, 0, true);
  e.setUint16(6, 0, true);
  e.setUint16(8, zip64 ? U16_MAX : entryCount, true);
  e.setUint16(10, zip64 ? U16_MAX : entryCount, true);
  e.setUint32(12, zip64 ? U32_MAX : centralDirectorySize, true);
  e.setUint32(16, zip64 ? U32_MAX : centralDirectoryOffset, true);
  e.setUint16(20, 0, true);
  parts.push(eocd);

  return concatBytes(parts);
}
