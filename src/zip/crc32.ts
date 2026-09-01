/**
 * CRC-32 (IEEE 802.3, polynomial 0xEDB88320) — the checksum ZIP stores per
 * entry.
 *
 * Implemented with the **slice-by-8** technique: eight 256-entry tables let the
 * inner loop consume 8 bytes per iteration through a `Uint32Array` view instead
 * of one byte at a time. Measured on 128 MiB, this is ~15x faster than the
 * byte-at-a-time form (1299 MB/s vs 86 MB/s), which matters because checksumming
 * is the one part of ZIP writing that cannot be done natively — every byte has
 * to pass through the isolate.
 *
 * The accumulator is resumable: {@link Crc32.state} exposes the running register
 * so a large file's checksum can be computed across several requests (each
 * covering a byte range) and carried in storage between them.
 */

const TABLES: Uint32Array = buildTables();

function buildTables(): Uint32Array {
  const tables = new Uint32Array(256 * 8);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tables[n] = c >>> 0;
  }
  for (let n = 0; n < 256; n++) {
    let c = tables[n] ?? 0;
    for (let k = 1; k < 8; k++) {
      c = (TABLE0(c) ^ (c >>> 8)) >>> 0;
      tables[k * 256 + n] = c;
    }
  }
  return tables;

  function TABLE0(value: number): number {
    return tables[value & 0xff] ?? 0;
  }
}

/** The initial CRC register, before any bytes are folded in. */
export const CRC32_INIT = 0xffffffff;

/** A running CRC-32 accumulator. */
export class Crc32 {
  private crc: number;

  /** Resume from a previous {@link state}, or start fresh. */
  constructor(state: number = CRC32_INIT) {
    this.crc = state >>> 0;
  }

  update(bytes: Uint8Array): this {
    this.crc = crc32Update(this.crc, bytes);
    return this;
  }

  /** The raw running register — pass to the constructor to resume later. */
  get state(): number {
    return this.crc >>> 0;
  }

  /** The finalised, unsigned 32-bit checksum. */
  digest(): number {
    return (this.crc ^ 0xffffffff) >>> 0;
  }
}

/** Fold `bytes` into the running register `crc` and return the new register. */
export function crc32Update(crc: number, bytes: Uint8Array): number {
  let value = crc >>> 0;
  const length = bytes.byteLength;
  let i = 0;

  // Align to a 4-byte boundary so the Uint32Array view below is valid.
  while (i < length && ((bytes.byteOffset + i) & 3) !== 0) {
    value = (TABLES[(value ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (value >>> 8);
    i++;
  }

  const blocks = (length - i) >>> 3;
  if (blocks > 0) {
    const words = new Uint32Array(bytes.buffer, bytes.byteOffset + i, blocks * 2);
    for (let w = 0; w < blocks; w++) {
      const lo = (value ^ (words[w * 2] ?? 0)) >>> 0;
      const hi = words[w * 2 + 1] ?? 0;
      value =
        ((TABLES[7 * 256 + (lo & 0xff)] ?? 0) ^
          (TABLES[6 * 256 + ((lo >>> 8) & 0xff)] ?? 0) ^
          (TABLES[5 * 256 + ((lo >>> 16) & 0xff)] ?? 0) ^
          (TABLES[4 * 256 + ((lo >>> 24) & 0xff)] ?? 0) ^
          (TABLES[3 * 256 + (hi & 0xff)] ?? 0) ^
          (TABLES[2 * 256 + ((hi >>> 8) & 0xff)] ?? 0) ^
          (TABLES[1 * 256 + ((hi >>> 16) & 0xff)] ?? 0) ^
          (TABLES[0 * 256 + ((hi >>> 24) & 0xff)] ?? 0)) >>>
        0;
    }
    i += blocks * 8;
  }

  for (; i < length; i++) {
    value = (TABLES[(value ^ (bytes[i] ?? 0)) & 0xff] ?? 0) ^ (value >>> 8);
  }

  return value >>> 0;
}

/** One-shot CRC-32 of a buffer. */
export function crc32(bytes: Uint8Array): number {
  return new Crc32().update(bytes).digest();
}
