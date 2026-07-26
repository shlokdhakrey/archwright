import { EXTRA_FIELD_HEADER_SIZE, ExtraFieldId, Zip64Sentinel } from '../constants/zip.js';
import { ByteView } from '../utils/bytes.js';
import { crc32 } from './crc32.js';

const utf8Decoder = new TextDecoder('utf-8');

/** A single parsed extra field: its 16-bit id and its raw payload. */
export interface ExtraField {
  readonly id: number;
  readonly data: Uint8Array;
}

/**
 * Iterate the `id`/`size`/`payload` triples of an extra-field block, stopping
 * cleanly at the first sign of truncation rather than reading past the end.
 */
export function* iterateExtraFields(extra: Uint8Array): Generator<ExtraField> {
  const view = new ByteView(extra);
  let position = 0;
  while (position + EXTRA_FIELD_HEADER_SIZE <= extra.byteLength) {
    const id = view.u16(position);
    const size = view.u16(position + 2);
    const start = position + EXTRA_FIELD_HEADER_SIZE;
    if (start + size > extra.byteLength) break;
    yield { id, data: extra.subarray(start, start + size) };
    position = start + size;
  }
}

/** The 32-bit fields that a ZIP64 extra field may promote to 64-bit. */
export interface Zip64Fields {
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Resolve ZIP64-promoted values. The ZIP64 extra field carries 8-byte values
 * *only* for those base fields set to the 0xffffffff sentinel, in the fixed
 * order: uncompressed size, compressed size, local header offset, disk start.
 */
export function applyZip64Extra(extra: Uint8Array, fields: Zip64Fields): Zip64Fields {
  for (const field of iterateExtraFields(extra)) {
    if (field.id !== ExtraFieldId.ZIP64) continue;
    const view = new ByteView(field.data);
    let offset = 0;
    const result: Zip64Fields = { ...fields };
    if (fields.uncompressedSize === Zip64Sentinel.UINT32) {
      result.uncompressedSize = view.u64(offset);
      offset += 8;
    }
    if (fields.compressedSize === Zip64Sentinel.UINT32) {
      result.compressedSize = view.u64(offset);
      offset += 8;
    }
    if (fields.localHeaderOffset === Zip64Sentinel.UINT32) {
      result.localHeaderOffset = view.u64(offset);
      offset += 8;
    }
    return result;
  }
  return fields;
}

/**
 * Extract an authoritative UTF-8 name from an Info-ZIP Unicode Path extra field
 * (0x7075), but only when its embedded CRC matches the CRC of the original name
 * bytes — the mechanism the spec uses to detect a stale Unicode field.
 */
export function readUnicodePath(extra: Uint8Array, rawName: Uint8Array): string | undefined {
  for (const field of iterateExtraFields(extra)) {
    if (field.id !== ExtraFieldId.UNICODE_PATH || field.data.byteLength < 5) continue;
    const view = new ByteView(field.data);
    const version = view.u8(0);
    const nameCrc = view.u32(1);
    if (version === 1 && nameCrc === crc32(rawName)) {
      return utf8Decoder.decode(field.data.subarray(5));
    }
  }
  return undefined;
}
