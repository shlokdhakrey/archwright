import { bytesToBase64Url } from '../utils/base64url.js';

/**
 * Short links map a compact code to a full archive URL, so the UI can serve
 * `/zfile/{code}` (browse) and `/sfile/{code}/{file}` (download) instead of the
 * giant base64 `/a/{ref}/…` form (a signed R2/S3 URL is 600+ characters).
 *
 * The code is derived from the archive's **canonical identity** — its origin and
 * path, with the query string dropped — not the full URL. For a signed URL the
 * query *is* the (expiring) signature, so canonicalising means the same object
 * always yields the same code. Re-submitting a freshly-signed URL therefore
 * refreshes the stored value **under the same code**: the shared link is stable
 * (effectively permanent), even though the signature behind it rotates.
 */

/** KV key prefix, so links never collide with any other data in the namespace. */
const KEY_PREFIX = 'l:';

/** Code length in base64url chars. 8 chars ≈ 48 bits — ample for this scale. */
const CODE_LENGTH = 8;

/**
 * The stable identity of an archive URL: `origin` (lowercased) + `pathname`,
 * without the query. Two signed URLs for the same object share this, so they map
 * to the same code. Falls back to the raw string if it will not parse (it always
 * should — callers validate first).
 */
export function canonicalArchiveUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return url.origin.toLowerCase() + url.pathname;
  } catch {
    return raw;
  }
}

/**
 * Derive the stable short code from an archive URL: the first
 * {@link CODE_LENGTH} base64url characters of the canonical URL's SHA-256.
 */
export async function deriveShortCode(url: string): Promise<string> {
  const canonical = canonicalArchiveUrl(url);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return bytesToBase64Url(new Uint8Array(digest)).slice(0, CODE_LENGTH);
}

/** A syntactically valid code — bounds the KV lookup to plausible inputs. */
export function isValidShortCode(code: string): boolean {
  return code.length > 0 && code.length <= 64 && /^[A-Za-z0-9_-]+$/.test(code);
}

/**
 * Store `code → url`, deriving the code. `ttlSeconds <= 0` stores the mapping
 * **permanently** (no KV expiration) — the default, so a shared link never dies
 * on its own. A positive value sets an expiry (KV floor is 60s).
 */
export async function putShortLink(
  kv: KVNamespace,
  url: string,
  ttlSeconds: number,
): Promise<string> {
  const code = await deriveShortCode(url);
  const options = ttlSeconds > 0 ? { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) } : {};
  await kv.put(KEY_PREFIX + code, url, options);
  return code;
}

/** Resolve a code back to its archive URL, or `null` if unknown/expired. */
export async function getShortLink(kv: KVNamespace, code: string): Promise<string | null> {
  if (!isValidShortCode(code)) return null;
  return kv.get(KEY_PREFIX + code);
}
