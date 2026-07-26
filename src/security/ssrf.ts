import { BadRequestError, ForbiddenError } from '../errors/http-error.js';

/**
 * Validate an archive URL before the Worker is willing to fetch it.
 *
 * This is the primary SSRF control. Defence is layered:
 *  1. Only `http(s)` URLs, never embedded credentials.
 *  2. A host allowlist (operator-controlled) — the authoritative gate in
 *     multi-archive mode, and defence-in-depth in single-archive mode.
 *  3. A block on IP-literal hosts that address private, loopback, link-local or
 *     cloud-metadata ranges, so an allowlist entry can't be abused via a raw IP.
 *
 * Note: this cannot see post-DNS resolution. Operators should keep the allowlist
 * to trusted object-storage hosts; see `docs/security.md`.
 */
export function validateArchiveUrl(rawUrl: string, allowedHosts: ReadonlySet<string>): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BadRequestError('archive URL is not a valid absolute URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new ForbiddenError('archive URL scheme must be http or https', { scheme: url.protocol });
  }
  if (url.username !== '' || url.password !== '') {
    throw new ForbiddenError('credentials embedded in the archive URL are not allowed');
  }

  const host = url.hostname.toLowerCase();
  if (isBlockedHost(host)) {
    throw new ForbiddenError('archive host addresses a private or reserved range', { host });
  }
  if (allowedHosts.size > 0 && !allowedHosts.has(host)) {
    throw new ForbiddenError('archive host is not in the allowlist', { host });
  }

  return url;
}

/** True for loopback/localhost names and private/reserved IP literals. */
export function isBlockedHost(host: string): boolean {
  // `URL.hostname` returns IPv6 literals wrapped in brackets (e.g. `[::1]`);
  // strip them before inspection.
  let normalized = host.toLowerCase();
  if (normalized.startsWith('[') && normalized.endsWith(']')) {
    normalized = normalized.slice(1, -1);
  }

  if (normalized === 'localhost' || normalized.endsWith('.localhost') || normalized.endsWith('.internal')) {
    return true;
  }
  const ipv4 = parseIpv4(normalized);
  if (ipv4 !== undefined) return isPrivateIpv4(ipv4);
  if (normalized.includes(':')) return isBlockedIpv6(normalized);
  return false;
}

function parseIpv4(host: string): number | undefined {
  const parts = host.split('.');
  if (parts.length !== 4) return undefined;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return undefined;
    const octet = Number(part);
    if (octet > 255) return undefined;
    value = value * 256 + octet;
  }
  return value >>> 0;
}

function inCidr(ip: number, base: string, prefix: number): boolean {
  const baseIp = parseIpv4(base);
  if (baseIp === undefined) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ip & mask) === (baseIp & mask);
}

function isPrivateIpv4(ip: number): boolean {
  return (
    inCidr(ip, '0.0.0.0', 8) || // "this" network
    inCidr(ip, '10.0.0.0', 8) || // private
    inCidr(ip, '100.64.0.0', 10) || // CGNAT
    inCidr(ip, '127.0.0.0', 8) || // loopback
    inCidr(ip, '169.254.0.0', 16) || // link-local (incl. 169.254.169.254 metadata)
    inCidr(ip, '172.16.0.0', 12) || // private
    inCidr(ip, '192.0.0.0', 24) || // IETF protocol assignments
    inCidr(ip, '192.168.0.0', 16) || // private
    inCidr(ip, '198.18.0.0', 15) || // benchmarking
    inCidr(ip, '224.0.0.0', 4) || // multicast
    inCidr(ip, '240.0.0.0', 4) // reserved / broadcast
  );
}

function isBlockedIpv6(host: string): boolean {
  if (host === '::1' || host === '::') return true;
  // Unique-local fc00::/7 (fc/fd) and link-local fe80::/10 (fe8–feb).
  if (/^f[cd]/.test(host) || /^fe[89ab]/.test(host)) return true;

  // IPv4-mapped (::ffff:…) — the embedded IPv4 may be dotted (`::ffff:127.0.0.1`)
  // or, as `URL.hostname` produces, hex hextets (`::ffff:7f00:1`). Inspect it.
  const mapped = /^::ffff:(.+)$/.exec(host);
  if (mapped?.[1]) {
    const rest = mapped[1];
    if (rest.includes('.')) {
      const ipv4 = parseIpv4(rest);
      if (ipv4 !== undefined) return isPrivateIpv4(ipv4);
    } else {
      const groups = rest.split(':').filter((group) => group.length > 0);
      const lo = parseInt(groups[groups.length - 1] ?? '', 16);
      const hi = groups.length >= 2 ? parseInt(groups[groups.length - 2] ?? '', 16) : 0;
      if (Number.isFinite(hi) && Number.isFinite(lo)) {
        return isPrivateIpv4(((hi << 16) | lo) >>> 0);
      }
    }
  }
  return false;
}
