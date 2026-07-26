import { Header } from '../constants/http.js';
import type { Validators } from '../types/http.js';

/**
 * Conditional-request evaluation (RFC 9110 §13). We implement the precedence
 * relevant to a read-only byte service: `If-None-Match` wins over
 * `If-Modified-Since`; `If-Range` gates whether a `Range` may be honoured.
 */

function parseIfNoneMatch(value: string): { any: boolean; tags: string[] } {
  const trimmed = value.trim();
  if (trimmed === '*') return { any: true, tags: [] };
  const tags = trimmed
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  return { any: false, tags };
}

/** Strip a weak-validator prefix (`W/`) for weak comparison. */
function normaliseEtag(tag: string): string {
  return tag.startsWith('W/') ? tag.slice(2) : tag;
}

/** Weak comparison of two entity tags (used for `If-None-Match`). */
function weakEtagEquals(a: string, b: string): boolean {
  return normaliseEtag(a) === normaliseEtag(b);
}

/**
 * Determine whether a `304 Not Modified` should be returned for a GET/HEAD.
 * Returns true when the client already holds a current representation.
 */
export function isNotModified(request: Request, validators: Validators): boolean {
  const ifNoneMatch = request.headers.get(Header.IF_NONE_MATCH);
  if (ifNoneMatch !== null) {
    const { any, tags } = parseIfNoneMatch(ifNoneMatch);
    if (any) return true;
    const etag = validators.etag;
    if (etag === undefined) return false;
    return tags.some((tag) => weakEtagEquals(tag, etag));
  }

  const ifModifiedSince = request.headers.get(Header.IF_MODIFIED_SINCE);
  if (ifModifiedSince !== null && validators.lastModified !== undefined) {
    const since = Date.parse(ifModifiedSince);
    const lastModified = Date.parse(validators.lastModified);
    if (!Number.isNaN(since) && !Number.isNaN(lastModified)) {
      // Second-granularity comparison; not modified when the resource is no newer.
      return Math.floor(lastModified / 1000) <= Math.floor(since / 1000);
    }
  }

  return false;
}

/**
 * Evaluate `If-Range`: when present, a `Range` is only honoured if the client's
 * validator still matches the current representation; otherwise the full body is
 * served. Absent header → range is applicable. RFC 9110 §13.1.5.
 */
export function isRangeApplicable(request: Request, validators: Validators): boolean {
  const ifRange = request.headers.get(Header.IF_RANGE);
  if (ifRange === null) return true;

  const value = ifRange.trim();
  // An entity-tag form must match strongly (weak tags never satisfy If-Range).
  if (value.startsWith('"') || value.startsWith('W/')) {
    if (value.startsWith('W/')) return false;
    return validators.etag !== undefined && validators.etag === value;
  }

  // Otherwise it is an HTTP-date; the range is fresh iff the resource is
  // unchanged since that date.
  if (validators.lastModified === undefined) return false;
  const suppliedDate = Date.parse(value);
  const lastModified = Date.parse(validators.lastModified);
  if (Number.isNaN(suppliedDate) || Number.isNaN(lastModified)) return false;
  return Math.floor(lastModified / 1000) <= Math.floor(suppliedDate / 1000);
}
