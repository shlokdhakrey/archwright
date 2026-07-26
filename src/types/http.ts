/** HTTP-shaped value types shared across the codebase. */

/** A half-open byte range expressed as an absolute offset and a length. */
export interface ByteRange {
  readonly offset: number;
  readonly length: number;
}

/** A closed byte range `[start, end]` with both ends inclusive (HTTP semantics). */
export interface InclusiveRange {
  readonly start: number;
  readonly end: number;
}

/**
 * The outcome of parsing a client `Range` header against a known resource size.
 *  - `none`         — no (or empty) Range header; serve the full representation.
 *  - `satisfiable`  — a single valid range to serve as `206 Partial Content`.
 *  - `unsatisfiable`— the range cannot be met; answer `416`.
 */
export type RangeParseResult =
  | { readonly kind: 'none' }
  | { readonly kind: 'satisfiable'; readonly range: InclusiveRange }
  | { readonly kind: 'unsatisfiable' };

/** Cache validators for a representation. */
export interface Validators {
  readonly etag?: string;
  readonly lastModified?: string;
}

/** A lazily-produced byte stream of a known length. */
export interface RangeStream {
  readonly body: ReadableStream<Uint8Array>;
  readonly length: number;
}
