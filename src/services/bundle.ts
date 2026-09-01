import { bytesToBase64Url } from '../utils/base64url.js';
import { canonicalArchiveUrl } from './short-link.js';

/**
 * A **bundle** is the reverse of the archive reader: a set of arbitrary remote
 * files addressed by one permanent code, served back as a single `.tar` or
 * `.zip` stream.
 *
 * The manifest (URLs, names, sizes, and CRC-32s once known) lives in KV under a
 * code derived from the *canonical* URL list, so re-submitting the same files —
 * even with freshly-signed URLs — yields the same shareable link.
 *
 * TAR needs nothing but sizes, so it can be served the moment a bundle is
 * created. ZIP additionally needs a CRC-32 per file, which is the only thing
 * here that costs real CPU; those are computed once (resumably, see the prepare
 * handler) and cached on the manifest, after which ZIP streams natively too.
 */

const KEY_PREFIX = 'b:';
const CODE_LENGTH = 8;

export interface BundleFile {
  readonly url: string;
  readonly name: string;
  readonly size: number;
  readonly lastModified?: number;
  /** True when the origin serves byte ranges, so bytes can be pulled unencoded. */
  readonly ranged?: boolean;
  /** CRC-32 of the file's bytes, once computed. ZIP requires it; TAR does not. */
  readonly crc32?: number;
  /** Resumable CRC progress: bytes folded in so far. */
  readonly crcDone?: number;
  /** Resumable CRC progress: the running register (pre-final-XOR). */
  readonly crcState?: number;
}

export interface Bundle {
  /** Base name used for the downloaded archive (no extension). */
  readonly name: string;
  readonly files: readonly BundleFile[];
}

/** True once every file has a cached CRC-32, so ZIP can stream natively. */
export function isZipReady(bundle: Bundle): boolean {
  return bundle.files.every((file) => typeof file.crc32 === 'number');
}

/** Bytes still to be checksummed before ZIP can be served. */
export function crcRemaining(bundle: Bundle): number {
  return bundle.files.reduce(
    (total, file) =>
      typeof file.crc32 === 'number' ? total : total + Math.max(0, file.size - (file.crcDone ?? 0)),
    0,
  );
}

/** Total bytes across the bundle. */
export function totalBytes(bundle: Bundle): number {
  return bundle.files.reduce((total, file) => total + file.size, 0);
}

/**
 * Derive the stable code for a set of files: the SHA-256 of their canonical
 * URLs (signature query stripped), so the link survives re-signing.
 */
export async function deriveBundleCode(urls: readonly string[]): Promise<string> {
  const canonical = urls.map(canonicalArchiveUrl).join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return bytesToBase64Url(new Uint8Array(digest)).slice(0, CODE_LENGTH);
}

/** A syntactically valid bundle code. */
export function isValidBundleCode(code: string): boolean {
  return code.length > 0 && code.length <= 64 && /^[A-Za-z0-9_-]+$/.test(code);
}

/** Store (or refresh) a bundle manifest, returning its code. */
export async function putBundle(
  kv: KVNamespace,
  bundle: Bundle,
  ttlSeconds: number,
): Promise<string> {
  const code = await deriveBundleCode(bundle.files.map((file) => file.url));
  await writeBundle(kv, code, bundle, ttlSeconds);
  return code;
}

/** Overwrite an existing manifest in place (used to cache CRC progress). */
export async function writeBundle(
  kv: KVNamespace,
  code: string,
  bundle: Bundle,
  ttlSeconds: number,
): Promise<void> {
  const options = ttlSeconds > 0 ? { expirationTtl: Math.max(60, Math.floor(ttlSeconds)) } : {};
  await kv.put(KEY_PREFIX + code, JSON.stringify(bundle), options);
}

/** Load a bundle manifest, or `null` when unknown/expired/corrupt. */
export async function getBundle(kv: KVNamespace, code: string): Promise<Bundle | null> {
  if (!isValidBundleCode(code)) return null;
  const raw = await kv.get(KEY_PREFIX + code);
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as Bundle;
    if (!Array.isArray(parsed.files) || parsed.files.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
}
