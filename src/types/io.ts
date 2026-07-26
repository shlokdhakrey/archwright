import type { RangeStream, Validators } from './http.js';

/** The subset of the Fetch API the Worker depends on (injectable for tests). */
export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** A source of wall-clock time (injectable so tests are deterministic). */
export interface Clock {
  /** Milliseconds since the Unix epoch. */
  now(): number;
}

/**
 * Random-access reader over a byte source of known size.
 *
 * This is the seam the ZIP layer is written against: it knows nothing about
 * HTTP. `HttpRangeReader` implements it over ranged `fetch`; `BytesRangeReader`
 * implements it over an in-memory buffer for unit tests and fixtures.
 */
export interface RangeReader {
  /** Total size of the underlying resource, in bytes. */
  readonly size: number;
  /** Origin cache validators, when known. */
  readonly validators: Validators;
  /** Read `length` bytes starting at absolute `offset` into a single buffer. */
  read(offset: number, length: number, signal?: AbortSignal): Promise<Uint8Array>;
  /** Open a streaming read of `length` bytes starting at absolute `offset`. */
  stream(offset: number, length: number, signal?: AbortSignal): Promise<RangeStream>;
}

/**
 * A minimal byte-oriented cache abstraction. Implementations back it with the
 * Workers Cache API (per-colo), an in-isolate map, or KV (cross-colo).
 */
export interface CacheStore {
  get(key: string, signal?: AbortSignal): Promise<Uint8Array | undefined>;
  set(key: string, value: Uint8Array, ttlSeconds: number): Promise<void>;
}
