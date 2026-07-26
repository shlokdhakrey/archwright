/**
 * Bounds-checked little-endian reads over a byte buffer.
 *
 * ZIP is a little-endian format, and every field read during parsing goes
 * through {@link ByteView}, which guarantees that a malformed or truncated
 * archive produces a caught {@link RangeError} rather than silently reading
 * adjacent memory or returning `NaN`.
 */
export class ByteView {
  private readonly view: DataView;

  constructor(public readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  get length(): number {
    return this.bytes.byteLength;
  }

  private ensure(offset: number, size: number): void {
    if (offset < 0 || size < 0 || offset + size > this.bytes.byteLength) {
      throw new RangeError(
        `byte read out of bounds: offset=${offset} size=${size} length=${this.bytes.byteLength}`,
      );
    }
  }

  /** Unsigned 8-bit integer at `offset`. */
  u8(offset: number): number {
    this.ensure(offset, 1);
    return this.view.getUint8(offset);
  }

  /** Unsigned little-endian 16-bit integer at `offset`. */
  u16(offset: number): number {
    this.ensure(offset, 2);
    return this.view.getUint16(offset, true);
  }

  /** Unsigned little-endian 32-bit integer at `offset`. */
  u32(offset: number): number {
    this.ensure(offset, 4);
    return this.view.getUint32(offset, true);
  }

  /**
   * Unsigned little-endian 64-bit integer at `offset`, narrowed to a JS number.
   * Throws if the value exceeds `Number.MAX_SAFE_INTEGER` (~9 PB), which no
   * real archive reaches and which we refuse rather than lose precision on.
   */
  u64(offset: number): number {
    this.ensure(offset, 8);
    const value = this.view.getBigUint64(offset, true);
    if (value > MAX_SAFE_BIGINT) {
      throw new RangeError(`64-bit value ${value.toString()} exceeds MAX_SAFE_INTEGER`);
    }
    return Number(value);
  }

  /** A zero-copy view of `length` bytes at `offset` (shares the backing buffer). */
  slice(offset: number, length: number): Uint8Array {
    this.ensure(offset, length);
    return this.bytes.subarray(offset, offset + length);
  }

  /** A fresh copy of `length` bytes at `offset` (does not retain the backing buffer). */
  copy(offset: number, length: number): Uint8Array {
    this.ensure(offset, length);
    return this.bytes.slice(offset, offset + length);
  }
}

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/**
 * Find the last offset at which the little-endian uint32 `signature` occurs in
 * `bytes`, scanning backwards. Returns `-1` if absent. Used to locate the EOCD.
 */
export function lastIndexOfUint32LE(bytes: Uint8Array, signature: number): number {
  const b0 = signature & 0xff;
  const b1 = (signature >>> 8) & 0xff;
  const b2 = (signature >>> 16) & 0xff;
  const b3 = (signature >>> 24) & 0xff;
  for (let i = bytes.byteLength - 4; i >= 0; i--) {
    if (bytes[i] === b0 && bytes[i + 1] === b1 && bytes[i + 2] === b2 && bytes[i + 3] === b3) {
      return i;
    }
  }
  return -1;
}

/** Concatenate byte chunks into a single buffer. */
export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

/** Constant-time-ish equality for two byte arrays (used for signature checks). */
export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
