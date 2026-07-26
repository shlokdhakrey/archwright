/**
 * CRC-32 (IEEE 802.3, polynomial 0xEDB88320) — the checksum ZIP stores per
 * entry. This implementation is incremental so it can, optionally, verify an
 * entry's integrity as it streams. It is also used by the test fixture builder
 * to produce spec-valid archives.
 */

const TABLE: Uint32Array = buildTable();

function buildTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

/** A running CRC-32 accumulator. */
export class Crc32 {
  private crc = 0xffffffff;

  update(bytes: Uint8Array): this {
    let crc = this.crc;
    for (const byte of bytes) {
      const index = (crc ^ byte) & 0xff;
      crc = (TABLE[index] ?? 0) ^ (crc >>> 8);
    }
    this.crc = crc >>> 0;
    return this;
  }

  /** The finalised, unsigned 32-bit checksum. */
  digest(): number {
    return (this.crc ^ 0xffffffff) >>> 0;
  }
}

/** One-shot CRC-32 of a buffer. */
export function crc32(bytes: Uint8Array): number {
  return new Crc32().update(bytes).digest();
}
