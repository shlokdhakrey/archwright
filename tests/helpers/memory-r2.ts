import { readableFromBytes } from '../../src/utils/stream.js';

/**
 * An in-memory stand-in for an R2 bucket binding — enough of the surface
 * (`head`, and `get` with an offset/length range) for the R2 source tests to
 * drive the real readers and handlers without a live bucket.
 */
export class MemoryR2 {
  private readonly objects: Map<string, Uint8Array>;
  /** Test-only: how many reads were served, to prove ranges are used. */
  reads = 0;

  constructor(objects: Record<string, Uint8Array>) {
    this.objects = new Map(Object.entries(objects));
  }

  head(key: string): Promise<unknown> {
    const data = this.objects.get(key);
    if (!data) return Promise.resolve(null);
    return Promise.resolve({
      key,
      size: data.byteLength,
      httpEtag: `"r2-${String(data.byteLength)}"`,
      uploaded: new Date(1_700_000_000_000),
    });
  }

  get(key: string, options?: { range?: { offset: number; length: number } }): Promise<unknown> {
    const data = this.objects.get(key);
    if (!data) return Promise.resolve(null);
    this.reads++;

    const offset = options?.range?.offset ?? 0;
    const length = options?.range?.length ?? data.byteLength - offset;
    const slice = data.subarray(offset, offset + length);

    return Promise.resolve({
      key,
      size: data.byteLength,
      httpEtag: `"r2-${String(data.byteLength)}"`,
      uploaded: new Date(1_700_000_000_000),
      body: readableFromBytes(slice),
      arrayBuffer: () => Promise.resolve(slice.slice().buffer),
    });
  }
}

/** A `MemoryR2` typed as an `R2Bucket` for injection through `Env`. */
export function memoryR2(objects: Record<string, Uint8Array>): R2Bucket {
  return new MemoryR2(objects) as unknown as R2Bucket;
}
