import { REPOSITORY_URL, SERVICE_NAME, VERSION } from '../constants/app.js';
import type { RequestContext } from '../types/context.js';
import { jsonResponse } from './respond.js';

/**
 * Report the running version, mode and effective limits. Optional features are
 * reported as detected at runtime, so operators can confirm whether the KV cache
 * or Analytics Engine bindings are actually wired up.
 */
export function versionHandler(ctx: RequestContext): Response {
  return jsonResponse(
    ctx,
    {
      service: SERVICE_NAME,
      version: VERSION,
      repository: REPOSITORY_URL,
      runtime: 'cloudflare-workers',
      mode: ctx.config.mode,
      features: {
        kvCache: ctx.deps.kv !== undefined,
        analyticsEngine: ctx.deps.metrics !== undefined,
        signedReferences: ctx.config.signingSecret !== undefined,
        browserUi: ctx.config.serveUi,
        openMode: ctx.config.allowAnyArchiveHost,
        combinedZip: true,
      },
      limits: {
        maxCentralDirectoryBytes: ctx.config.maxCentralDirectoryBytes,
        maxEntryCount: ctx.config.maxEntryCount,
        maxUncompressedBytes: ctx.config.maxUncompressedBytes,
        maxCompressionRatio: ctx.config.maxCompressionRatio,
        originTimeoutMs: ctx.config.originTimeoutMs,
        originRetries: ctx.config.originRetries,
        cacheTtlSeconds: ctx.config.cacheTtlSeconds,
      },
    },
    200,
    { 'cache-control': 'public, max-age=60' },
  );
}
