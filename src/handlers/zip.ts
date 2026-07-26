import { Header, HttpMethod, Status } from '../constants/http.js';
import { BadRequestError, NotFoundError, PayloadTooLargeError } from '../errors/http-error.js';
import { contentDisposition } from '../http/content-disposition.js';
import { assertEntryServable } from '../security/guards.js';
import { openArchive } from '../services/archive-service.js';
import type { RequestContext } from '../types/context.js';
import type { ZipEntry } from '../types/zip.js';
import { normaliseRequestedPath } from '../validation/entry-path.js';
import { buildCombinedZip } from '../zip/zip-writer.js';

/**
 * Stream a single ZIP containing the caller's selection of entries, chosen via
 * one or more `?path=` query parameters. The archive is built on the fly with no
 * re-compression and constant memory (see `zip/zip-writer.ts`); `HEAD` returns
 * the exact size without producing a body.
 */
export async function zipHandler(ctx: RequestContext, archiveUrl: string): Promise<Response> {
  const requested = ctx.url.searchParams.getAll('path');
  if (requested.length === 0) {
    throw new BadRequestError('no files selected; pass one or more ?path=… parameters');
  }
  if (requested.length > ctx.config.maxZipEntries) {
    throw new PayloadTooLargeError('too many files selected for a combined download', {
      requested: requested.length,
      max: ctx.config.maxZipEntries,
    });
  }

  const { archive } = await openArchive(ctx, archiveUrl);

  const seen = new Set<string>();
  const entries: ZipEntry[] = [];
  for (const raw of requested) {
    const key = normaliseRequestedPath(raw);
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    const entry = archive.getEntry(key);
    if (!entry) {
      throw new NotFoundError('entry not found in archive', { path: key });
    }
    assertEntryServable(entry, ctx.config);
    entries.push(entry);
  }
  if (entries.length === 0) {
    throw new BadRequestError('no valid files selected');
  }

  const combined = buildCombinedZip(archive, entries, {
    signal: ctx.signal,
    onBytes: (bytes) => {
      ctx.metrics.gauge('bytes_streamed', bytes);
      ctx.log.info('combined zip streamed', { entries: entries.length, bytes });
    },
  });

  const headers = new Headers({
    [Header.CONTENT_TYPE]: 'application/zip',
    [Header.CONTENT_LENGTH]: String(combined.contentLength),
    [Header.CONTENT_DISPOSITION]: contentDisposition(
      'attachment',
      zipFileName(ctx.url.searchParams.get('name')),
    ),
    [Header.CACHE_CONTROL]: 'no-store',
    [Header.X_REQUEST_ID]: ctx.requestId,
    'x-zip-entries': String(combined.entryCount),
  });

  const isHead = ctx.request.method === HttpMethod.HEAD;
  return new Response(isHead ? null : combined.body, { status: Status.OK, headers });
}

function zipFileName(raw: string | null): string {
  const base = (raw ?? '').trim().replace(/[/\\]/g, '_');
  if (base === '') return 'selection.zip';
  return base.toLowerCase().endsWith('.zip') ? base : `${base}.zip`;
}
