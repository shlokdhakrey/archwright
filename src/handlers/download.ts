import { HttpMethod, Header, Status } from '../constants/http.js';
import { CompressionMethod } from '../constants/zip.js';
import { RangeNotSatisfiableError, NotFoundError } from '../errors/http-error.js';
import { isNotModified, isRangeApplicable } from '../http/conditional.js';
import { contentDisposition } from '../http/content-disposition.js';
import { contentTypeFromName } from '../http/content-type.js';
import { parseRange } from '../http/range.js';
import { assertEntryServable } from '../security/guards.js';
import { openArchive } from '../services/archive-service.js';
import { entryValidators } from '../services/entry-validators.js';
import { buildEntryStream, selectionFor, type Selection } from '../streaming/pipeline.js';
import type { DispositionMode } from '../types/config.js';
import type { RequestContext } from '../types/context.js';
import type { Validators } from '../types/http.js';
import type { ZipEntry } from '../types/zip.js';
import { normaliseRequestedPath } from '../validation/entry-path.js';
import type { ZipArchive } from '../zip/archive.js';
import { methodName } from '../zip/method.js';

/**
 * Serve a single entry as if it were a standalone file — the heart of the
 * service. Handles GET and HEAD, conditional requests (304), `If-Range`, byte
 * ranges (206/416) and streaming decode, while never buffering the entry.
 *
 * HEAD is answered without touching the entry's data at all: sizes come from the
 * central directory, so it costs only the (cached) directory load.
 */
export async function downloadHandler(
  ctx: RequestContext,
  archiveUrl: string,
  entryPath: string,
): Promise<Response> {
  const isHead = ctx.request.method === HttpMethod.HEAD;
  const key = normaliseRequestedPath(entryPath);
  if (key === '') {
    throw new NotFoundError('no entry specified');
  }

  const { archive } = await openArchive(ctx, archiveUrl);
  const entry = archive.getEntry(key);
  if (!entry) {
    throw new NotFoundError('entry not found in archive', { path: key });
  }
  assertEntryServable(entry, ctx.config);

  const validators = entryValidators(archive.validators, entry);

  if (isNotModified(ctx.request, validators)) {
    return notModified(ctx, validators);
  }

  const rangeApplies = isRangeApplicable(ctx.request, validators);
  const rangeHeader = rangeApplies ? ctx.request.headers.get(Header.RANGE) : null;
  const range = parseRange(rangeHeader, entry.uncompressedSize);
  if (range.kind === 'unsatisfiable') {
    throw new RangeNotSatisfiableError(entry.uncompressedSize);
  }

  const disposition = resolveDisposition(ctx, ctx.config.disposition);

  // Zero-CPU path: serve a *full* DEFLATE download as `Content-Encoding: deflate`
  // by passing the entry's already-compressed bytes through **untouched** and
  // letting the client inflate. Crucially this needs NO stream transform — the
  // Worker returns the origin body directly, so bytes never enter the JS isolate
  // and no CPU is billed per byte (the same zero-copy passthrough that lets
  // Drive-index Workers serve huge files). A gzip re-frame cannot do this: its
  // 18 header/trailer bytes force a TransformStream that drags every byte through
  // the isolate. Requires a deflate-accepting client and no Range.
  if (
    ctx.config.deflatePassthrough &&
    entry.method === CompressionMethod.DEFLATE &&
    range.kind === 'none' &&
    acceptsEncoded(ctx.request)
  ) {
    return serveDeflatePassthrough(ctx, archive, entry, validators, isHead, key, disposition);
  }

  const selection = selectionFor(entry, range);
  const headers = buildEntryHeaders(ctx, entry, selection, validators, disposition);

  if (isHead) {
    return new Response(null, { status: selection.status, headers });
  }

  const location = await archive.resolveData(entry, ctx.signal);
  const stopTtfb = ctx.metrics.startTimer('ttfb_ms');
  const plan = await buildEntryStream(archive, entry, location, range, {
    signal: ctx.signal,
    onBytes: (bytes) => {
      ctx.metrics.gauge('bytes_streamed', bytes);
      ctx.log.info('entry streamed', { path: key, bytes, status: selection.status });
    },
  });
  stopTtfb();

  return new Response(plan.body, { status: plan.status, headers });
}

/**
 * Resolve the effective `Content-Disposition` mode. A per-request query flag wins
 * over the configured default so a single link can force either behaviour:
 *   - `?inline`   → render in the browser (preview MP4/PDF/images)
 *   - `?download` → force a Save dialog
 * The default (see `CONTENT_DISPOSITION`) is `attachment`, so a bare link
 * downloads rather than trying to play in the browser.
 */
function resolveDisposition(ctx: RequestContext, fallback: DispositionMode): DispositionMode {
  const params = ctx.url.searchParams;
  if (params.has('download') || params.get('dl') === '1') return 'attachment';
  if (params.has('inline') || params.get('dl') === '0') return 'inline';
  return fallback;
}

function acceptsEncoded(request: Request): boolean {
  // Cloudflare normalises the Accept-Encoding it forwards to Workers (it drops
  // `deflate` and typically leaves `gzip`), yet every major browser still
  // inflates a `Content-Encoding: deflate` response. So gate on the reliably
  // forwarded `gzip`/`deflate` token rather than requiring a literal `deflate`.
  const ae = (request.headers.get('accept-encoding') ?? '').toLowerCase();
  return ae.includes('gzip') || ae.includes('deflate');
}

/**
 * Serve a DEFLATE entry with no Worker-side decompression by handing the client
 * the raw DEFLATE bytes under `Content-Encoding: deflate`. The origin body is
 * returned **directly** — no stream wrapper — so it streams edge-to-edge without
 * entering the isolate (zero per-byte CPU), which is what lets this work for
 * multi-gigabyte entries on constrained CPU budgets.
 *
 * A ZIP method-8 entry stores *raw* DEFLATE (RFC 1951). The HTTP `deflate`
 * content-coding is nominally zlib-wrapped (RFC 1950), but every major browser
 * falls back to raw inflate, so this decodes correctly in the browser — the
 * intended client. We cannot emit the zlib wrapper anyway: its Adler-32 trailer
 * would require reading the *uncompressed* bytes we are deliberately not touching.
 */
async function serveDeflatePassthrough(
  ctx: RequestContext,
  archive: ZipArchive,
  entry: ZipEntry,
  validators: Validators,
  isHead: boolean,
  key: string,
  disposition: DispositionMode,
): Promise<Response> {
  const headers = new Headers({
    [Header.CONTENT_TYPE]: contentTypeFromName(entry.name),
    // Raw DEFLATE is passed through 1:1, so the encoded length is exactly the
    // stored compressed size — no framing overhead.
    [Header.CONTENT_LENGTH]: String(entry.compressedSize),
    [Header.CONTENT_ENCODING]: 'deflate',
    [Header.CONTENT_DISPOSITION]: contentDisposition(disposition, entry.name),
    // `no-transform` stops Cloudflare's edge from decoding/re-encoding the body,
    // which would drag every byte through a decompressor and bill the Worker.
    [Header.CACHE_CONTROL]: `public, max-age=${ctx.config.cacheTtlSeconds}, no-transform`,
    [Header.VARY]: 'Accept-Encoding',
    [Header.X_REQUEST_ID]: ctx.requestId,
    'x-zip-method': 'deflate',
  });
  if (validators.etag) headers.set(Header.ETAG, validators.etag);
  if (validators.lastModified) headers.set(Header.LAST_MODIFIED, validators.lastModified);

  if (isHead) {
    return new Response(null, { status: Status.OK, headers });
  }

  const location = await archive.resolveData(entry, ctx.signal);
  const { body: compressed } = await archive.stream(location.offset, location.length, ctx.signal);
  ctx.log.info('entry streamed (deflate passthrough)', {
    path: key,
    compressedSize: entry.compressedSize,
    uncompressedSize: entry.uncompressedSize,
  });
  // Direct passthrough — no TransformStream — keeps this zero-copy.
  return new Response(compressed, { status: Status.OK, headers });
}

function buildEntryHeaders(
  ctx: RequestContext,
  entry: ZipEntry,
  selection: Selection,
  validators: Validators,
  disposition: DispositionMode,
): Headers {
  const headers = new Headers({
    [Header.CONTENT_TYPE]: contentTypeFromName(entry.name),
    [Header.CONTENT_LENGTH]: String(selection.contentLength),
    [Header.ACCEPT_RANGES]: 'bytes',
    [Header.CONTENT_DISPOSITION]: contentDisposition(disposition, entry.name),
    [Header.CACHE_CONTROL]: `public, max-age=${ctx.config.cacheTtlSeconds}`,
    [Header.X_REQUEST_ID]: ctx.requestId,
    'x-zip-method': methodName(entry.method),
  });
  if (selection.contentRange) headers.set(Header.CONTENT_RANGE, selection.contentRange);
  if (validators.etag) headers.set(Header.ETAG, validators.etag);
  if (validators.lastModified) headers.set(Header.LAST_MODIFIED, validators.lastModified);
  return headers;
}

function notModified(ctx: RequestContext, validators: Validators): Response {
  const headers = new Headers({
    [Header.X_REQUEST_ID]: ctx.requestId,
    [Header.CACHE_CONTROL]: `public, max-age=${ctx.config.cacheTtlSeconds}`,
  });
  if (validators.etag) headers.set(Header.ETAG, validators.etag);
  if (validators.lastModified) headers.set(Header.LAST_MODIFIED, validators.lastModified);
  return new Response(null, { status: Status.NOT_MODIFIED, headers });
}
