import type { ArchiveMode, Config, DispositionMode } from '../types/config.js';
import type { Env } from '../types/env.js';
import type { LogLevel } from '../types/logging.js';

const LOG_LEVELS: ReadonlySet<string> = new Set(['debug', 'info', 'warn', 'error', 'silent']);

/** Bounds applied to each numeric setting: [default, min, max]. */
const NUMERIC_BOUNDS = {
  cacheTtlSeconds: [3600, 0, 31_536_000],
  originTimeoutMs: [15_000, 1_000, 120_000],
  originRetries: [2, 0, 5],
  maxCentralDirectoryBytes: [67_108_864, 1_024, 268_435_456],
  maxEntryCount: [100_000, 1, 10_000_000],
  maxUncompressedBytes: [0, 0, Number.MAX_SAFE_INTEGER],
  maxCompressionRatio: [0, 0, 1_000_000],
  maxZipEntries: [64, 1, 1_000],
  // Short-link lifetime: default 0 = permanent (never expires); a positive value
  // sets a KV expiry (max 1 year). Permanent keeps a shared link stable.
  shortLinkTtlSeconds: [0, 0, 31_536_000],
} as const;

/**
 * Parse and validate the binding {@link Env} into a strongly-typed
 * {@link Config}. Every value is defaulted and clamped so a malformed variable
 * degrades to a safe value rather than crashing the Worker. The presence of
 * `ARCHIVE_URL` selects single- vs multi-archive mode.
 */
export function parseConfig(env: Env): Config {
  const archiveUrl = (env.ARCHIVE_URL ?? '').trim();
  const mode: ArchiveMode = archiveUrl.length > 0 ? 'single' : 'multi';

  const allowedHosts = new Set<string>();
  for (const host of splitList(env.ALLOWED_ARCHIVE_HOSTS)) {
    allowedHosts.add(host.toLowerCase());
  }
  if (mode === 'single') {
    const host = hostOf(archiveUrl);
    if (host) allowedHosts.add(host);
  }

  const signingSecret = (env.ARCHIVE_SIGNING_SECRET ?? '').trim();

  return {
    mode,
    ...(mode === 'single' ? { archiveUrl } : {}),
    allowedHosts,
    controlPrefix: normalisePrefix(env.CONTROL_PREFIX),
    corsAllowOrigin: (env.CORS_ALLOW_ORIGIN ?? '*').trim() || '*',
    logLevel: parseLogLevel(env.LOG_LEVEL),
    cacheTtlSeconds: clampInt(env.CACHE_TTL_SECONDS, NUMERIC_BOUNDS.cacheTtlSeconds),
    originTimeoutMs: clampInt(env.ORIGIN_TIMEOUT_MS, NUMERIC_BOUNDS.originTimeoutMs),
    originRetries: clampInt(env.ORIGIN_RETRIES, NUMERIC_BOUNDS.originRetries),
    maxCentralDirectoryBytes: clampInt(
      env.MAX_CENTRAL_DIRECTORY_BYTES,
      NUMERIC_BOUNDS.maxCentralDirectoryBytes,
    ),
    maxEntryCount: clampInt(env.MAX_ENTRY_COUNT, NUMERIC_BOUNDS.maxEntryCount),
    maxUncompressedBytes: clampInt(env.MAX_UNCOMPRESSED_BYTES, NUMERIC_BOUNDS.maxUncompressedBytes),
    maxCompressionRatio: clampInt(env.MAX_COMPRESSION_RATIO, NUMERIC_BOUNDS.maxCompressionRatio),
    disposition: parseDisposition(env.CONTENT_DISPOSITION),
    deflatePassthrough: parseBool(env.DEFLATE_PASSTHROUGH, true),
    ...(signingSecret.length > 0 ? { signingSecret } : {}),
    allowAnyArchiveHost: parseBool(env.ALLOW_ANY_ARCHIVE_HOST, false),
    serveUi: parseBool(env.SERVE_UI, true),
    maxZipEntries: clampInt(env.MAX_ZIP_ENTRIES, NUMERIC_BOUNDS.maxZipEntries),
    shortLinkTtlSeconds: clampInt(env.SHORTLINK_TTL_SECONDS, NUMERIC_BOUNDS.shortLinkTtlSeconds),
    r2Prefix: (env.R2_PREFIX ?? '').trim().replace(/^\/+/, ''),
  };
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  const normalised = value.trim().toLowerCase();
  if (normalised === 'true' || normalised === '1' || normalised === 'yes') return true;
  if (normalised === 'false' || normalised === '0' || normalised === 'no') return false;
  return fallback;
}

function splitList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function hostOf(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function normalisePrefix(value: string | undefined): string {
  const trimmed = (value ?? '__').trim().replace(/^\/+|\/+$/g, '');
  return trimmed.length > 0 ? trimmed : '__';
}

function parseLogLevel(value: string | undefined): LogLevel {
  const candidate = (value ?? 'info').trim().toLowerCase();
  return LOG_LEVELS.has(candidate) ? (candidate as LogLevel) : 'info';
}

function parseDisposition(value: string | undefined): DispositionMode {
  // Default to `attachment` so a bare link downloads the file rather than the
  // browser trying to render it inline (e.g. hanging on an MKV it cannot play).
  // Per-request `?inline` / `?download` flags override this (see download handler).
  return (value ?? 'attachment').trim().toLowerCase() === 'inline' ? 'inline' : 'attachment';
}

function clampInt(value: string | undefined, bounds: readonly [number, number, number]): number {
  const [fallback, min, max] = bounds;
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
