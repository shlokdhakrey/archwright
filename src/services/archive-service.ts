import { loadArchive, type LoadArchiveResult } from '../cache/central-directory-cache.js';
import { HttpRangeReader } from '../http/http-range-reader.js';
import { isR2Source, r2Key, R2RangeReader } from '../r2/r2-reader.js';
import { assertSourceAllowed, requireBucket } from '../security/source.js';
import type { RequestContext } from '../types/context.js';
import type { RangeReader } from '../types/io.js';

/**
 * Open a remote archive for reading: validate the URL (SSRF), probe it for size
 * and validators, and resolve its central directory (through the memo / durable
 * cache / origin). Timings and the directory source are recorded as metrics.
 *
 * The *raw* URL string is used for the origin fetch and cache key so that signed
 * URLs (whose query strings are signature-sensitive) are never reserialised.
 */
export async function openArchive(ctx: RequestContext, archiveUrl: string): Promise<LoadArchiveResult> {
  assertSourceAllowed(ctx, archiveUrl);

  const stopOpen = ctx.metrics.startTimer('reader_open_ms');
  // An `r2://` archive is read through the bucket binding: ranges are native,
  // egress is free, and it does not consume an external subrequest.
  const reader: RangeReader = isR2Source(archiveUrl)
    ? await R2RangeReader.open(requireBucket(ctx), r2Key(archiveUrl))
    : await HttpRangeReader.open({
        url: archiveUrl,
        fetcher: ctx.deps.fetch,
        timeoutMs: ctx.config.originTimeoutMs,
        retries: ctx.config.originRetries,
        maxWholeBuffer: ctx.config.maxCentralDirectoryBytes,
        signal: ctx.signal,
      });
  stopOpen();
  ctx.metrics.gauge('archive_size_bytes', reader.size);

  const stopDirectory = ctx.metrics.startTimer('directory_load_ms');
  const result = await loadArchive({
    reader,
    cacheKey: archiveUrl,
    cache: ctx.deps.cache,
    clock: ctx.deps.clock,
    limits: {
      maxBytes: ctx.config.maxCentralDirectoryBytes,
      maxEntries: ctx.config.maxEntryCount,
    },
    ttlSeconds: ctx.config.cacheTtlSeconds,
    background: ctx.waitUntil,
    signal: ctx.signal,
  });
  stopDirectory();

  ctx.metrics.count(`directory_source.${result.source}`);
  ctx.metrics.gauge('entry_count', result.archive.entries.length);
  ctx.log.debug('archive opened', {
    source: result.source,
    entries: result.archive.entries.length,
    size: reader.size,
    zip64: result.archive.directory.isZip64,
  });

  return result;
}
