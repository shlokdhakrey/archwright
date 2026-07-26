import { BYTES_UNIT } from '../constants/http.js';
import type { RangeParseResult } from '../types/http.js';

/**
 * Parse a single-range HTTP `Range` header against a resource of `size` bytes,
 * following RFC 9110 §14 semantics:
 *
 *  - A syntactically invalid range (or one we do not support, such as a
 *    multi-range set) is *ignored* — the caller serves the full `200`.
 *  - A well-formed but unsatisfiable range (start ≥ size, or `-0`) yields
 *    `unsatisfiable` — the caller answers `416`.
 *  - Otherwise a single satisfiable inclusive `[start, end]` is returned.
 *
 * Multi-range requests are intentionally not supported: they force `multipart/
 * byteranges` bookkeeping that provides no benefit for the media/download use
 * cases this service targets, so we ignore the header and return the whole body.
 */
export function parseRange(headerValue: string | null, size: number): RangeParseResult {
  if (headerValue === null) return { kind: 'none' };

  const trimmed = headerValue.trim();
  const prefix = `${BYTES_UNIT}=`;
  if (!trimmed.toLowerCase().startsWith(prefix)) return { kind: 'none' };

  const spec = trimmed.slice(prefix.length).trim();
  // Multiple ranges → ignore (serve full body).
  if (spec.includes(',')) return { kind: 'none' };

  const match = /^(\d*)-(\d*)$/.exec(spec);
  if (!match) return { kind: 'none' };

  const startText = match[1] ?? '';
  const endText = match[2] ?? '';

  // A dash with neither side is malformed → ignore.
  if (startText === '' && endText === '') return { kind: 'none' };

  if (size === 0) return { kind: 'unsatisfiable' };

  // Suffix form: `bytes=-N` → the final N bytes.
  if (startText === '') {
    const suffixLength = Number(endText);
    if (!Number.isSafeInteger(suffixLength)) return { kind: 'none' };
    if (suffixLength === 0) return { kind: 'unsatisfiable' };
    const start = suffixLength >= size ? 0 : size - suffixLength;
    return { kind: 'satisfiable', range: { start, end: size - 1 } };
  }

  const start = Number(startText);
  if (!Number.isSafeInteger(start)) return { kind: 'none' };
  if (start >= size) return { kind: 'unsatisfiable' };

  // Open-ended: `bytes=N-` → N through the end.
  if (endText === '') {
    return { kind: 'satisfiable', range: { start, end: size - 1 } };
  }

  const requestedEnd = Number(endText);
  if (!Number.isSafeInteger(requestedEnd)) return { kind: 'none' };
  // last-byte-pos < first-byte-pos is invalid → ignore per RFC 9110.
  if (requestedEnd < start) return { kind: 'none' };

  const end = Math.min(requestedEnd, size - 1);
  return { kind: 'satisfiable', range: { start, end } };
}

/** Build the `Content-Range` value for a satisfied range. */
export function formatContentRange(start: number, end: number, size: number): string {
  return `${BYTES_UNIT} ${start}-${end}/${size}`;
}

/** Number of bytes covered by an inclusive `[start, end]` range. */
export function rangeLength(start: number, end: number): number {
  return end - start + 1;
}
