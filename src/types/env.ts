/**
 * The Worker's binding environment. String `vars` come from wrangler.jsonc /
 * secrets; the object bindings (KV, Analytics Engine) are optional — the Worker
 * detects them at runtime so the Free-plan deployment works without them.
 *
 * `wrangler types` generates a richer `Env` in `worker-configuration.d.ts`; this
 * interface documents the contract the code relies on and keeps type-checking
 * self-contained.
 */
export interface Env {
  readonly ARCHIVE_URL?: string;
  readonly ALLOWED_ARCHIVE_HOSTS?: string;
  readonly CONTROL_PREFIX?: string;
  readonly CORS_ALLOW_ORIGIN?: string;
  readonly LOG_LEVEL?: string;
  readonly CACHE_TTL_SECONDS?: string;
  readonly ORIGIN_TIMEOUT_MS?: string;
  readonly ORIGIN_RETRIES?: string;
  readonly MAX_CENTRAL_DIRECTORY_BYTES?: string;
  readonly MAX_ENTRY_COUNT?: string;
  readonly MAX_UNCOMPRESSED_BYTES?: string;
  readonly MAX_COMPRESSION_RATIO?: string;
  readonly CONTENT_DISPOSITION?: string;
  /** `"false"` to disable serving DEFLATE downloads as `Content-Encoding: gzip`. */
  readonly DEFLATE_PASSTHROUGH?: string;
  /** Optional HMAC secret enabling signed archive references (multi-archive mode). */
  readonly ARCHIVE_SIGNING_SECRET?: string;
  /** `"true"` to accept any public archive host in multi-archive mode. */
  readonly ALLOW_ANY_ARCHIVE_HOST?: string;
  /** `"false"` to disable the browser UI at `/`. */
  readonly SERVE_UI?: string;
  /** Max entries per combined-ZIP download. */
  readonly MAX_ZIP_ENTRIES?: string;
  /** How long a short link (code → archive URL) lives, in seconds. */
  readonly SHORTLINK_TTL_SECONDS?: string;

  /** Optional: KV namespace backing short links (`/__/shorten`, `/s/{code}`). */
  readonly LINKS_KV?: KVNamespace;
  /** Optional: cross-colo metadata cache. */
  readonly METADATA_KV?: KVNamespace;
  /** Optional: custom metrics sink. */
  readonly METRICS?: AnalyticsEngineDataset;
}
