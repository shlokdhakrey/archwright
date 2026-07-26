import type { LogLevel } from './logging.js';

/** Whether the Worker fronts one fixed archive or many allowlisted archives. */
export type ArchiveMode = 'single' | 'multi';

/** How downloaded entries are presented to the browser. */
export type DispositionMode = 'inline' | 'attachment';

/**
 * The validated, strongly-typed configuration derived from {@link Env}. All
 * parsing, defaulting and validation happens once per request in `parseConfig`.
 */
export interface Config {
  readonly mode: ArchiveMode;
  /** Present in single-archive mode: the one archive served at the path root. */
  readonly archiveUrl?: string;
  /** Hostnames the Worker may fetch archives from (SSRF allowlist). */
  readonly allowedHosts: ReadonlySet<string>;
  /** Path prefix reserving the control plane (health/version/list/meta). */
  readonly controlPrefix: string;
  readonly corsAllowOrigin: string;
  readonly logLevel: LogLevel;
  readonly cacheTtlSeconds: number;
  readonly originTimeoutMs: number;
  readonly originRetries: number;
  readonly maxCentralDirectoryBytes: number;
  readonly maxEntryCount: number;
  /** Reject entries whose uncompressed size exceeds this. `0` = unlimited. */
  readonly maxUncompressedBytes: number;
  /** Reject entries whose compression ratio exceeds this (bomb guard). `0` = off. */
  readonly maxCompressionRatio: number;
  readonly disposition: DispositionMode;
  /**
   * Serve full (non-Range) DEFLATE downloads with `Content-Encoding: gzip`,
   * offloading decompression to the client so the Worker does ~0 CPU. Lets large
   * DEFLATE entries stream to completion within tight CPU limits.
   */
  readonly deflatePassthrough: boolean;
  /** Present when signed archive references are enabled. */
  readonly signingSecret?: string;
  /**
   * When true, multi-archive mode accepts any public host (private/reserved IPs
   * are still blocked). Enables the "paste any link" UX; use with care.
   */
  readonly allowAnyArchiveHost: boolean;
  /** Serve the browser UI at `/`. */
  readonly serveUi: boolean;
  /** Maximum number of entries allowed in a combined-ZIP download. */
  readonly maxZipEntries: number;
  /** Lifetime of a short link (code → archive URL) in seconds. */
  readonly shortLinkTtlSeconds: number;
}
