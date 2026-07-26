import { USER_AGENT } from '../constants/app.js';
import { BYTES_UNIT, Header, Status } from '../constants/http.js';
import { EOCD_SEARCH_WINDOW_BYTES } from '../constants/zip.js';
import { MalformedArchiveError, UpstreamError } from '../errors/http-error.js';
import type { RangeStream, Validators } from '../types/http.js';
import type { Fetcher, RangeReader } from '../types/io.js';
import { collectStream, drainResponse, readableFromBytes } from '../utils/stream.js';
import { fetchWithResilience } from './fetch-with-resilience.js';

interface ReaderOptions {
  readonly timeoutMs: number;
  readonly retries: number;
}

export interface OpenReaderParams {
  readonly url: string;
  readonly fetcher: Fetcher;
  readonly timeoutMs: number;
  readonly retries: number;
  readonly signal?: AbortSignal;
  /** How many trailing bytes to prefetch (defaults to the EOCD search window). */
  readonly tailWindow?: number;
  /** Max bytes to buffer if the origin ignores the range and returns `200`. */
  readonly maxWholeBuffer: number;
}

interface Tail {
  readonly start: number;
  readonly bytes: Uint8Array;
}

/**
 * A {@link RangeReader} backed by HTTP range requests.
 *
 * `open()` performs a single suffix-range probe (`Range: bytes=-N`) that returns
 * both the archive size *and* the trailing bytes in one round trip. Those
 * trailing bytes are retained, so locating the EOCD and reading a
 * central-directory that lives in the tail (the overwhelmingly common case) are
 * served from memory — a cold download typically costs just 3 origin
 * subrequests: tail probe, local header, and the entry body.
 */
export class HttpRangeReader implements RangeReader {
  private constructor(
    private readonly url: string,
    private readonly fetcher: Fetcher,
    private readonly options: ReaderOptions,
    public readonly size: number,
    public readonly validators: Validators,
    private readonly tail: Tail,
  ) {}

  static async open(params: OpenReaderParams): Promise<HttpRangeReader> {
    const { url, fetcher, timeoutMs, retries, signal, maxWholeBuffer } = params;
    const window = params.tailWindow ?? EOCD_SEARCH_WINDOW_BYTES;
    const options: ReaderOptions = { timeoutMs, retries };

    const probe = await fetchWithResilience(
      fetcher,
      url,
      { method: 'GET', headers: rangeHeaders(`${BYTES_UNIT}=-${window}`), redirect: 'follow' },
      { timeoutMs, retries, ...(signal ? { signal } : {}) },
    );
    const validators = readValidators(probe.headers);

    if (probe.status === Status.PARTIAL_CONTENT) {
      const contentRange = parseContentRange(probe.headers.get(Header.CONTENT_RANGE));
      if (!contentRange) {
        await drainResponse(probe);
        throw new UpstreamError('origin returned 206 without a valid Content-Range');
      }
      // Cap the buffered tail at the requested window so a misbehaving origin
      // that returns more than asked cannot force unbounded allocation.
      const bytes = await readCapped(probe, window);
      return new HttpRangeReader(url, fetcher, options, contentRange.total, validators, {
        start: contentRange.start,
        bytes,
      });
    }

    if (probe.status === Status.OK) {
      // The origin ignored the range and returned the whole resource; only
      // acceptable if it is small enough to hold in memory.
      const declared = contentLengthOf(probe.headers);
      if (declared !== undefined && declared > maxWholeBuffer) {
        await drainResponse(probe);
        throw new UpstreamError('origin ignored the range request on a large resource', {
          declaredLength: declared,
        });
      }
      const bytes = await readCapped(probe, maxWholeBuffer);
      return new HttpRangeReader(url, fetcher, options, bytes.byteLength, validators, { start: 0, bytes });
    }

    // Fallback for origins that reject suffix ranges: HEAD for size, then an
    // absolute-range tail fetch.
    await drainResponse(probe);
    return HttpRangeReader.openViaHead(url, fetcher, options, window, signal);
  }

  private static async openViaHead(
    url: string,
    fetcher: Fetcher,
    options: ReaderOptions,
    window: number,
    signal?: AbortSignal,
  ): Promise<HttpRangeReader> {
    const head = await fetchWithResilience(
      fetcher,
      url,
      { method: 'HEAD', headers: baseHeaders(), redirect: 'follow' },
      { ...options, ...(signal ? { signal } : {}) },
    );
    if (!head.ok) {
      await drainResponse(head);
      throw new UpstreamError(`origin HEAD failed (${head.status})`, { status: head.status });
    }
    const size = contentLengthOf(head.headers);
    if (size === undefined) {
      throw new UpstreamError('origin did not provide a Content-Length');
    }
    const validators = readValidators(head.headers);
    const start = Math.max(0, size - window);
    const tail = await fetchWithResilience(
      fetcher,
      url,
      { method: 'GET', headers: rangeHeaders(`${BYTES_UNIT}=${start}-${size - 1}`), redirect: 'follow' },
      { ...options, ...(signal ? { signal } : {}) },
    );
    if (tail.status !== Status.PARTIAL_CONTENT) {
      await drainResponse(tail);
      throw new UpstreamError('origin does not support HTTP range requests', { status: tail.status });
    }
    const bytes = await readCapped(tail, window);
    return new HttpRangeReader(url, fetcher, options, size, validators, { start, bytes });
  }

  private coversTail(offset: number, length: number): boolean {
    return offset >= this.tail.start && offset + length <= this.tail.start + this.tail.bytes.byteLength;
  }

  async read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array> {
    this.assertBounds(offset, length);
    if (length === 0) return new Uint8Array(0);

    if (this.coversTail(offset, length)) {
      const rel = offset - this.tail.start;
      return this.tail.bytes.subarray(rel, rel + length);
    }

    const response = await this.fetchRange(offset, length, signal);
    // A 206 must return exactly `length` bytes; cap defensively.
    return readCapped(response, length);
  }

  async stream(offset: number, length: number, signal?: AbortSignal): Promise<RangeStream> {
    this.assertBounds(offset, length);
    if (length === 0) {
      return { body: readableFromBytes(new Uint8Array(0)), length: 0 };
    }

    if (this.coversTail(offset, length)) {
      const rel = offset - this.tail.start;
      return { body: readableFromBytes(this.tail.bytes.subarray(rel, rel + length)), length };
    }

    // Stream the origin body directly (zero-copy) to minimise CPU — the entry's
    // data flows fetch → (inflate) → client with native backpressure.
    const response = await this.fetchRange(offset, length, signal);
    const body = response.body as ReadableStream<Uint8Array> | null;
    if (!body) {
      throw new UpstreamError('origin returned an empty body for a range request');
    }
    return { body, length };
  }

  private assertBounds(offset: number, length: number): void {
    if (offset < 0 || length < 0 || offset + length > this.size) {
      throw new MalformedArchiveError('archive offset out of bounds', {
        offset,
        length,
        size: this.size,
      });
    }
  }

  private async fetchRange(offset: number, length: number, signal?: AbortSignal): Promise<Response> {
    const end = offset + length - 1;
    const response = await fetchWithResilience(
      this.fetcher,
      this.url,
      { method: 'GET', headers: rangeHeaders(`${BYTES_UNIT}=${offset}-${end}`), redirect: 'follow' },
      { ...this.options, ...(signal ? { signal } : {}) },
    );

    if (response.status === Status.PARTIAL_CONTENT) return response;

    // We verified range support at open() time; a 200 here means the origin
    // changed behaviour — refuse rather than buffer an unbounded body.
    await drainResponse(response);
    throw new UpstreamError(`expected 206 for a range request, got ${response.status}`, {
      status: response.status,
    });
  }
}

// --- helpers -----------------------------------------------------------------

/**
 * Read a response body into memory, refusing to exceed `limit` bytes. This
 * bounds allocation for the small, structural reads (tail, central directory,
 * local header) even if a misbehaving origin returns more than requested. Entry
 * bodies never pass through here — they always stream.
 */
async function readCapped(response: Response, limit: number): Promise<Uint8Array> {
  const body = response.body as ReadableStream<Uint8Array> | null;
  if (!body) return new Uint8Array(0);
  try {
    return await collectStream(body, limit);
  } catch (error) {
    // The reader lock is released by collectStream; cancel the body so the
    // origin connection is promptly released rather than left dangling.
    await drainResponse(response);
    if (error instanceof RangeError) {
      throw new UpstreamError('origin returned more data than requested');
    }
    throw error;
  }
}

function baseHeaders(): Record<string, string> {
  return {
    // Force an identity representation: transfer-coding must not perturb the
    // byte offsets the ZIP index is expressed in.
    'accept-encoding': 'identity',
    'user-agent': USER_AGENT,
  };
}

function rangeHeaders(range: string): Record<string, string> {
  return { ...baseHeaders(), [Header.RANGE]: range };
}

function readValidators(headers: Headers): Validators {
  const etag = headers.get(Header.ETAG);
  const lastModified = headers.get(Header.LAST_MODIFIED);
  return {
    ...(etag ? { etag } : {}),
    ...(lastModified ? { lastModified } : {}),
  };
}

function contentLengthOf(headers: Headers): number | undefined {
  const raw = headers.get(Header.CONTENT_LENGTH);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

interface ContentRange {
  readonly start: number;
  readonly end: number;
  readonly total: number;
}

function parseContentRange(value: string | null): ContentRange | undefined {
  if (value === null) return undefined;
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/i.exec(value.trim());
  if (!match) return undefined;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (![start, end, total].every(Number.isSafeInteger)) return undefined;
  return { start, end, total };
}
