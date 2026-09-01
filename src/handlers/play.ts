import { Header, HttpMethod, Status } from '../constants/http.js';
import { BadRequestError, NotFoundError, PayloadTooLargeError } from '../errors/http-error.js';
import { extensionOf, findSubtitles, isNativeContainer, mediaKind, srtToVtt } from '../http/media.js';
import { assertEntryServable } from '../security/guards.js';
import { openArchive } from '../services/archive-service.js';
import { buildEntryStream } from '../streaming/pipeline.js';
import type { RequestContext } from '../types/context.js';
import { renderPlayerPage } from '../ui/player.js';
import { collectStream } from '../utils/stream.js';
import { normaliseRequestedPath } from '../validation/entry-path.js';
import { CompressionMethod } from '../constants/zip.js';

/**
 * Play a media file that lives inside a remote archive, in the browser.
 *
 * There is no transcoding and no staging: the page points a `<video>` element at
 * the entry's ordinary download URL, and the browser drives playback with the
 * same `Range` requests it would use for any file on a web server. For a STORED
 * entry each seek maps onto a single origin range, so scrubbing a 4 GB video
 * inside a 50 GB archive costs one small fetch.
 */

/** Subtitles are read whole to convert them; keep that bounded. */
const MAX_SUBTITLE_BYTES = 4 * 1024 * 1024;

export async function playHandler(
  ctx: RequestContext,
  archiveUrl: string,
  entryPath: string,
): Promise<Response> {
  if (!ctx.config.serveUi) {
    throw new NotFoundError('the player is disabled on this deployment (SERVE_UI=false)');
  }

  const key = normaliseRequestedPath(entryPath);
  if (key === '') throw new BadRequestError('playback requires an entry path');

  const { archive } = await openArchive(ctx, archiveUrl);
  const entry = archive.getEntry(key);
  if (!entry) throw new NotFoundError('entry not found in archive', { path: key });
  assertEntryServable(entry, ctx.config);

  const kind = mediaKind(entry.name);
  if (kind === 'none') {
    throw new BadRequestError('this entry is not audio or video', { path: key });
  }

  const base = archiveBasePath(ctx, 'play');
  const subtitles = findSubtitles(archive.entries, key);

  const page = renderPlayerPage({
    name: entry.name.slice(entry.name.lastIndexOf('/') + 1),
    path: key,
    // `?inline` so the browser renders it instead of offering a save dialog.
    mediaUrl: `${base}/${encodePath(key)}?inline`,
    backUrl: base === '' ? '/' : base,
    kind,
    size: entry.uncompressedSize,
    stored: entry.method === CompressionMethod.STORED,
    native: isNativeContainer(entry.name),
    subtitles,
    subtitleUrls: subtitles.map(
      (track) => `${base}/${ctx.config.controlPrefix}/subtitle/${encodePath(track.path)}`,
    ),
  });

  const headers = new Headers({
    [Header.CONTENT_TYPE]: 'text/html; charset=utf-8',
    [Header.CACHE_CONTROL]: 'no-store',
    [Header.X_REQUEST_ID]: ctx.requestId,
  });
  const isHead = ctx.request.method === HttpMethod.HEAD;
  return new Response(isHead ? null : page, { status: Status.OK, headers });
}

/**
 * Serve a subtitle entry as WebVTT — the only format `<track>` accepts.
 *
 * SubRip is converted on the way out (a header line and a decimal separator);
 * WebVTT is passed through. Subtitles are kilobytes, so reading one whole is
 * cheap, and the size guard keeps it that way.
 */
export async function subtitleHandler(
  ctx: RequestContext,
  archiveUrl: string,
  entryPath: string,
): Promise<Response> {
  const key = normaliseRequestedPath(entryPath);
  if (key === '') throw new BadRequestError('a subtitle path is required');

  const { archive } = await openArchive(ctx, archiveUrl);
  const entry = archive.getEntry(key);
  if (!entry) throw new NotFoundError('subtitle not found in archive', { path: key });
  assertEntryServable(entry, ctx.config);

  const extension = extensionOf(entry.name);
  if (extension !== 'srt' && extension !== 'vtt') {
    throw new BadRequestError('not a subtitle file', { path: key });
  }
  if (entry.uncompressedSize > MAX_SUBTITLE_BYTES) {
    throw new PayloadTooLargeError('subtitle file is too large to convert', {
      path: key,
      size: entry.uncompressedSize,
      limit: MAX_SUBTITLE_BYTES,
    });
  }

  const location = await archive.resolveData(entry, ctx.signal);
  const plan = await buildEntryStream(archive, entry, location, { kind: 'none' }, {
    signal: ctx.signal,
  });
  const raw = new TextDecoder().decode(await collectStream(plan.body));
  const vtt = extension === 'vtt' ? raw : srtToVtt(raw);

  const headers = new Headers({
    [Header.CONTENT_TYPE]: 'text/vtt; charset=utf-8',
    [Header.CACHE_CONTROL]: `public, max-age=${String(ctx.config.cacheTtlSeconds)}`,
    [Header.X_REQUEST_ID]: ctx.requestId,
  });
  const isHead = ctx.request.method === HttpMethod.HEAD;
  return new Response(isHead ? null : vtt, { status: Status.OK, headers });
}

/**
 * The archive-scoped prefix of the current URL — `''` in single-archive mode,
 * `/zfile/{code}` or `/a/{ref}` otherwise — so links stay in the same scope.
 */
function archiveBasePath(ctx: RequestContext, route: 'play'): string {
  const marker = `/${ctx.config.controlPrefix}/${route}/`;
  const at = ctx.url.pathname.indexOf(marker);
  return at <= 0 ? '' : ctx.url.pathname.slice(0, at);
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}
