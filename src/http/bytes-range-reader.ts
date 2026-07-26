import type { RangeStream, Validators } from '../types/http.js';
import type { RangeReader } from '../types/io.js';
import { readableFromBytes } from '../utils/stream.js';

/**
 * A {@link RangeReader} over an in-memory buffer. It is the substitution point
 * that lets the entire ZIP and streaming stack be unit-tested without a network:
 * fixtures build a real archive as a `Uint8Array`, wrap it here, and exercise
 * exactly the code paths production uses.
 */
export class BytesRangeReader implements RangeReader {
  constructor(
    private readonly data: Uint8Array,
    public readonly validators: Validators = {},
  ) {}

  get size(): number {
    return this.data.byteLength;
  }

  read(offset: number, length: number): Promise<Uint8Array> {
    this.assertBounds(offset, length);
    return Promise.resolve(this.data.subarray(offset, offset + length));
  }

  stream(offset: number, length: number): Promise<RangeStream> {
    this.assertBounds(offset, length);
    return Promise.resolve({
      body: readableFromBytes(this.data.subarray(offset, offset + length)),
      length,
    });
  }

  private assertBounds(offset: number, length: number): void {
    if (offset < 0 || length < 0 || offset + length > this.data.byteLength) {
      throw new RangeError(
        `read out of bounds: offset=${offset} length=${length} size=${this.data.byteLength}`,
      );
    }
  }
}
