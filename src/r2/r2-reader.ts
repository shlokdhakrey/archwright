import { NotFoundError } from '../errors/http-error.js';
import type { RangeStream, Validators } from '../types/http.js';
import type { RangeReader } from '../types/io.js';

/**
 * R2 as a first-class source, addressed as `r2://{key}`.
 *
 * This is not merely a convenience. On the Free plan a Worker may make **50
 * external subrequests** per invocation, which caps a bundle at ~48 arbitrary
 * URLs — but calls to Cloudflare's own services are counted separately and
 * allowed **1,000** per invocation. Sourcing files from a bound R2 bucket
 * therefore raises the practical bundle size by more than an order of
 * magnitude, and R2 egress inside Cloudflare is free.
 *
 * R2 also serves ranges natively and never transcodes, so the size it reports is
 * always the size we will receive — the ambiguity that forces the empirical
 * probe for HTTP origins simply does not arise here.
 */

export const R2_SCHEME = 'r2://';

/** True for a source addressed at the bound bucket rather than over HTTP. */
export function isR2Source(source: string): boolean {
  return source.startsWith(R2_SCHEME);
}

/**
 * The object key an `r2://` source addresses. Keys are opaque strings, so this
 * only strips the scheme, percent-decodes (letting callers address keys
 * containing spaces or `#`), and drops leading slashes.
 */
export function r2Key(source: string): string {
  const raw = source.slice(R2_SCHEME.length);
  let key: string;
  try {
    key = decodeURIComponent(raw);
  } catch {
    key = raw;
  }
  return key.replace(/^\/+/, '');
}

/** Render a key back into its canonical `r2://` form. */
export function r2Source(key: string): string {
  return R2_SCHEME + key.replace(/^\/+/, '');
}

/** A {@link RangeReader} backed by an R2 bucket binding. */
export class R2RangeReader implements RangeReader {
  private constructor(
    private readonly bucket: R2Bucket,
    private readonly key: string,
    readonly size: number,
    readonly validators: Validators,
  ) {}

  /** Probe the object for size and validators — one `head`, no data read. */
  static async open(bucket: R2Bucket, key: string): Promise<R2RangeReader> {
    const head = await bucket.head(key);
    if (!head) {
      throw new NotFoundError('object not found in the bound R2 bucket', { key });
    }
    const validators: Validators = {
      ...(head.httpEtag ? { etag: head.httpEtag } : {}),
      lastModified: head.uploaded.toUTCString(),
    };
    return new R2RangeReader(bucket, key, head.size, validators);
  }

  async read(offset: number, length: number): Promise<Uint8Array> {
    const object = await this.get(offset, length);
    return new Uint8Array(await object.arrayBuffer());
  }

  async stream(offset: number, length: number): Promise<RangeStream> {
    const object = await this.get(offset, length);
    return { body: object.body as ReadableStream<Uint8Array>, length };
  }

  private async get(offset: number, length: number): Promise<R2ObjectBody> {
    const object = await this.bucket.get(this.key, { range: { offset, length } });
    if (!object || !('body' in object)) {
      throw new NotFoundError('object disappeared from the bound R2 bucket', { key: this.key });
    }
    return object;
  }
}
