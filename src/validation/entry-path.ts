import { BadRequestError } from '../errors/http-error.js';
import { normaliseName } from '../zip/name.js';

/**
 * Turn a request path into a normalised entry key suitable for central-directory
 * lookup.
 *
 * Traversal is not a filesystem risk here — the Worker only ever serves names
 * that exist in the archive index, never a path on disk — but we still decode,
 * normalise (fold `\`→`/`, Unicode NFC) and reject `..` segments, NUL and control
 * characters so a request cannot express two spellings of the same entry or
 * smuggle bytes into a later header.
 */
export function normaliseRequestedPath(rawPathname: string): string {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPathname);
  } catch {
    throw new BadRequestError('path contains invalid percent-encoding');
  }

  const withoutLeadingSlashes = decoded.replace(/^\/+/, '');
  if (containsControlCharacter(withoutLeadingSlashes)) {
    throw new BadRequestError('path contains control characters');
  }

  const normalised = normaliseName(withoutLeadingSlashes);
  if (normalised.split('/').some((segment) => segment === '..')) {
    throw new BadRequestError('path traversal is not allowed');
  }

  return normalised;
}

function containsControlCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
  }
  return false;
}
