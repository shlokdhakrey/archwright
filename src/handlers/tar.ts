import { Header, HttpMethod, Status } from '../constants/http.js';
import { CompressionMethod } from '../constants/zip.js';
import { BadRequestError, NotFoundError, PayloadTooLargeError } from '../errors/http-error.js';
import { contentDisposition } from '../http/content-disposition.js';
import { assertEntryServable } from '../security/guards.js';
import { openArchive } from '../services/archive-service.js';
import { buildEntryStream } from '../streaming/pipeline.js';
import { buildTar, type TarFile } from '../tar/tar-writer.js';
import type { RequestContext } from '../types/context.js';
import type { ZipEntry } from '../types/zip.js';
import { normaliseRequestedPath } from '../validation/entry-path.js';
import type { ZipArchive } from '../zip/archive.js';

/**
 * Stream a selection of archive entries as a single **TAR**, the companion to
 * `/{prefix}/zip`.
 *
 * Which of the two is cheaper depends on how the source archive stores its
 * entries, and they are exact opposites:
 *
 *  - **ZIP** copies entries verbatim (DEFLATE stays DEFLATE) and reuses the
 *    CRC-32 from the source central directory, so it never inspects a byte —
 *    unlimited size at ~0 CPU regardless of the source's compression.
 *  - **TAR** stores plain file content, so a DEFLATE entry has to be inflated on
 *    the way through (real CPU, bounded by the plan's limit), while a STORED
 *    entry is a pure native passthrough — unlimited.
 *
 * So: prefer ZIP for compressed archives, and reach for TAR when the source is
 * STORED or when the client simply wants a tarball.
 */
export async function tarHandler(ctx: RequestContext, archiveUrl: string): Promise<Response> {
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
    if (!entry) throw new NotFoundError('entry not found in archive', { path: key });
    assertEntryServable(entry, ctx.config);
    entries.push(entry);
  }
  if (entries.length === 0) throw new BadRequestError('no valid files selected');

  const files: TarFile[] = entries.map((entry) => ({
    name: entry.name,
    size: entry.uncompressedSize,
    lastModified: entry.lastModified,
  }));

  const open = (index: number, signal?: AbortSignal): Promise<ReadableStream<Uint8Array>> => {
    const entry = entries[index];
    if (!entry) throw new NotFoundError('selected entry missing', { index });
    return openEntry(ctx, archive, entry, signal);
  };

  const tar = buildTar(
    files,
    open,
    {
      signal: ctx.signal,
      onBytes: (bytes) => {
        ctx.metrics.gauge('bytes_streamed', bytes);
        ctx.log.info('combined tar streamed', { entries: entries.length, bytes });
      },
    },
  );

  const stored = entries.every((entry) => entry.method === CompressionMethod.STORED);
  const headers = new Headers({
    [Header.CONTENT_TYPE]: 'application/x-tar',
    [Header.CONTENT_LENGTH]: String(tar.contentLength),
    [Header.CONTENT_DISPOSITION]: contentDisposition(
      'attachment',
      tarFileName(ctx.url.searchParams.get('name')),
    ),
    [Header.CACHE_CONTROL]: 'no-store',
    [Header.X_REQUEST_ID]: ctx.requestId,
    'x-tar-entries': String(tar.entryCount),
    // Diagnostic: 'native' means no entry needed inflating on the way out.
    'x-tar-mode': stored ? 'native' : 'inflate',
  });

  if (ctx.request.method === HttpMethod.HEAD) {
    await tar.body.cancel().catch(() => undefined);
    return new Response(null, { status: Status.OK, headers });
  }
  return new Response(tar.body, { status: Status.OK, headers });
}

/** Open one entry's *uncompressed* bytes (passthrough for STORED). */
async function openEntry(
  ctx: RequestContext,
  archive: ZipArchive,
  entry: ZipEntry,
  signal: AbortSignal | undefined,
): Promise<ReadableStream<Uint8Array>> {
  const location = await archive.resolveData(entry, signal ?? ctx.signal);
  const plan = await buildEntryStream(archive, entry, location, { kind: 'none' }, {
    signal: signal ?? ctx.signal,
  });
  return plan.body;
}

function tarFileName(raw: string | null): string {
  const base = (raw ?? '').trim().replace(/[/\\]/g, '_');
  if (base === '') return 'selection.tar';
  return base.toLowerCase().endsWith('.tar') ? base : `${base}.tar`;
}
