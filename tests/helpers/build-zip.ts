import { concatBytes } from '../../src/utils/bytes.js';
import { readableFromBytes, collectStream } from '../../src/utils/stream.js';
import { crc32 } from '../../src/zip/crc32.js';

/**
 * A spec-compliant ZIP writer for tests. It produces real archives — correct
 * CRCs, offsets, local and central headers, EOCD — and can emit STORED or
 * DEFLATE entries, data descriptors, and full ZIP64 records. This lets the ZIP
 * reader be tested against bytes it will actually encounter, with no network.
 */

const encoder = new TextEncoder();
const LFH_SIG = 0x04034b50;
const DD_SIG = 0x08074b50;
const CDH_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const EOCD64_SIG = 0x06064b50;
const EOCD64_LOC_SIG = 0x07064b50;

export interface FixtureEntry {
  readonly name: string;
  readonly data: Uint8Array | string;
  readonly method?: 'stored' | 'deflate';
  readonly dataDescriptor?: boolean;
  readonly dosDate?: number;
  readonly dosTime?: number;
}

export interface BuildZipOptions {
  /** Emit ZIP64 EOCD + per-entry ZIP64 extra fields (with 0xffffffff sentinels). */
  readonly zip64?: boolean;
  readonly archiveComment?: string;
}

interface EntryRecord {
  readonly name: Uint8Array;
  readonly flags: number;
  readonly method: number;
  readonly crc: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localOffset: number;
  readonly dosDate: number;
  readonly dosTime: number;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  return collectStream(readableFromBytes(data).pipeThrough(new CompressionStream('deflate-raw')));
}

/** Build a ZIP archive from fixture entries. */
export async function buildZip(
  entries: readonly FixtureEntry[],
  options: BuildZipOptions = {},
): Promise<Uint8Array> {
  const zip64 = options.zip64 ?? false;
  const bodyChunks: Uint8Array[] = [];
  const records: EntryRecord[] = [];
  let offset = 0;

  for (const entry of entries) {
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data;
    const method = entry.method ?? 'stored';
    const methodCode = method === 'deflate' ? 8 : 0;
    const compressed = method === 'deflate' ? await deflateRaw(data) : data;
    const crc = crc32(data);
    const name = encoder.encode(entry.name);
    const hasDataDescriptor = entry.dataDescriptor ?? false;
    const flags = 0x800 | (hasDataDescriptor ? 0x08 : 0);
    const dosDate = entry.dosDate ?? 0x21;
    const dosTime = entry.dosTime ?? 0;
    const localOffset = offset;

    const lfh = new Uint8Array(30);
    const lv = new DataView(lfh.buffer);
    lv.setUint32(0, LFH_SIG, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, flags, true);
    lv.setUint16(8, methodCode, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, hasDataDescriptor ? 0 : crc, true);
    lv.setUint32(18, hasDataDescriptor ? 0 : compressed.byteLength, true);
    lv.setUint32(22, hasDataDescriptor ? 0 : data.byteLength, true);
    lv.setUint16(26, name.byteLength, true);
    lv.setUint16(28, 0, true);

    bodyChunks.push(lfh, name, compressed);
    offset += 30 + name.byteLength + compressed.byteLength;

    if (hasDataDescriptor) {
      const dd = new Uint8Array(16);
      const dv = new DataView(dd.buffer);
      dv.setUint32(0, DD_SIG, true);
      dv.setUint32(4, crc, true);
      dv.setUint32(8, compressed.byteLength, true);
      dv.setUint32(12, data.byteLength, true);
      bodyChunks.push(dd);
      offset += 16;
    }

    records.push({
      name,
      flags,
      method: methodCode,
      crc,
      compressedSize: compressed.byteLength,
      uncompressedSize: data.byteLength,
      localOffset,
      dosDate,
      dosTime,
    });
  }

  const cdStart = offset;
  const cdChunks: Uint8Array[] = [];
  let cdSize = 0;

  for (const record of records) {
    let extra = new Uint8Array(0);
    let compField = record.compressedSize;
    let uncompField = record.uncompressedSize;
    let offsetField = record.localOffset;

    if (zip64) {
      extra = new Uint8Array(4 + 24);
      const zv = new DataView(extra.buffer);
      zv.setUint16(0, 0x0001, true);
      zv.setUint16(2, 24, true);
      zv.setBigUint64(4, BigInt(record.uncompressedSize), true);
      zv.setBigUint64(12, BigInt(record.compressedSize), true);
      zv.setBigUint64(20, BigInt(record.localOffset), true);
      compField = 0xffffffff;
      uncompField = 0xffffffff;
      offsetField = 0xffffffff;
    }

    const cdh = new Uint8Array(46);
    const cv = new DataView(cdh.buffer);
    cv.setUint32(0, CDH_SIG, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, record.flags, true);
    cv.setUint16(10, record.method, true);
    cv.setUint16(12, record.dosTime, true);
    cv.setUint16(14, record.dosDate, true);
    cv.setUint32(16, record.crc, true);
    cv.setUint32(20, compField >>> 0, true);
    cv.setUint32(24, uncompField >>> 0, true);
    cv.setUint16(28, record.name.byteLength, true);
    cv.setUint16(30, extra.byteLength, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offsetField >>> 0, true);

    cdChunks.push(cdh, record.name, extra);
    cdSize += 46 + record.name.byteLength + extra.byteLength;
  }

  const tail: Uint8Array[] = [];

  if (zip64) {
    const eocd64 = new Uint8Array(56);
    const zv = new DataView(eocd64.buffer);
    zv.setUint32(0, EOCD64_SIG, true);
    zv.setBigUint64(4, BigInt(44), true);
    zv.setUint16(12, 45, true);
    zv.setUint16(14, 45, true);
    zv.setUint32(16, 0, true);
    zv.setUint32(20, 0, true);
    zv.setBigUint64(24, BigInt(records.length), true);
    zv.setBigUint64(32, BigInt(records.length), true);
    zv.setBigUint64(40, BigInt(cdSize), true);
    zv.setBigUint64(48, BigInt(cdStart), true);

    const locator = new Uint8Array(20);
    const lv = new DataView(locator.buffer);
    lv.setUint32(0, EOCD64_LOC_SIG, true);
    lv.setUint32(4, 0, true);
    lv.setBigUint64(8, BigInt(cdStart + cdSize), true);
    lv.setUint32(16, 1, true);

    tail.push(eocd64, locator);
  }

  const comment = options.archiveComment ? encoder.encode(options.archiveComment) : new Uint8Array(0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, EOCD_SIG, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, zip64 ? 0xffff : records.length, true);
  ev.setUint16(10, zip64 ? 0xffff : records.length, true);
  ev.setUint32(12, zip64 ? 0xffffffff : cdSize, true);
  ev.setUint32(16, zip64 ? 0xffffffff : cdStart, true);
  ev.setUint16(20, comment.byteLength, true);
  tail.push(eocd, comment);

  return concatBytes([...bodyChunks, ...cdChunks, ...tail]);
}
