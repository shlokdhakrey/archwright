import { Header, HttpMethod, Status } from '../constants/http.js';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  PayloadTooLargeError,
  RangeNotSatisfiableError,
  ServiceUnavailableError,
  UpstreamError,
} from '../errors/http-error.js';
import { isNotModified, isRangeApplicable } from '../http/conditional.js';
import { contentDisposition } from '../http/content-disposition.js';
import { fetchWithResilience } from '../http/fetch-with-resilience.js';
import { formatContentRange, parseRange } from '../http/range.js';
import { isR2Source, r2Key } from '../r2/r2-reader.js';
import { assertSourceAllowed, requireBucket } from '../security/source.js';
import {
  crcRemaining,
  getBundle,
  isZipReady,
  putBundle,
  totalBytes,
  writeBundle,
  type Bundle,
  type BundleFile,
} from '../services/bundle.js';
import {
  sliceSegments,
  streamSlices,
  totalLength,
  wholeSlices,
  type OpenSlice,
  type Segment,
} from '../streaming/segments.js';
import { sliceStream } from '../streaming/transforms.js';
import { planTar, tarSegments, type TarFile } from '../tar/tar-writer.js';
import type { RequestContext } from '../types/context.js';
import type { Validators } from '../types/http.js';
import { bundleZipSegments, planBundleZip } from '../zip/bundle-zip.js';
import { crc32, CRC32_INIT, crc32Update } from '../zip/crc32.js';
import { jsonResponse } from './respond.js';

/**
 * The reverse direction: many remote files in, one archive out.
 *
 * `POST /{prefix}/bundle` validates and probes a list of URLs, then stores a
 * manifest under a permanent code. `/bundle/{code}.tar` and `/bundle/{code}.zip`
 * stream the result.
 *
 * TAR is servable immediately and at any size — it stores no content checksum,
 * so payloads are moved natively and never touch the isolate. ZIP needs a CRC-32
 * per file, the one unavoidably per-byte step; `POST /{prefix}/bundle/{code}/
 * prepare` computes those in resumable slices and caches them, after which ZIP
 * also streams natively at any size.
 */

/**
 * We ask for identity, but the Workers runtime manages `Accept-Encoding` on
 * subrequests and may negotiate gzip anyway — so this is a hint, not a
 * guarantee. See {@link probeFile} for how the resulting size ambiguity is
 * resolved.
 */
const IDENTITY: Record<string, string> = { 'accept-encoding': 'identity' };

/**
 * Largest *encoded* file we will measure inline at create time. Compressed
 * responses hide their true length, so the only way to learn it is to read the
 * whole thing; this bounds that work. Media (the usual bundle content) is never
 * served compressed and so never takes this path.
 */
const MEASURE_ENCODED_LIMIT = 32 * 1024 * 1024;
/** Hard stop while measuring, in case the decoded stream is far larger. */
const MEASURE_DECODED_LIMIT = 256 * 1024 * 1024;

/** Bytes checksummed per prepare call. At ~10 ms/MB this stays inside the CPU budget. */
const PREPARE_BUDGET_BYTES = 64 * 1024 * 1024;
const MAX_BODY_BYTES = 64 * 1024;

interface RequestedFile {
  readonly url: string;
  readonly name?: string;
}

// --- create ------------------------------------------------------------------

export async function createBundleHandler(ctx: RequestContext): Promise<Response> {
  const kv = requireLinksKv(ctx);
  requireOpenMode(ctx);

  const { files: requested, name } = await readBundleRequest(ctx);
  if (requested.length === 0) {
    throw new BadRequestError('no files given; send {"files":[{"url":"…"}]}');
  }
  if (requested.length > ctx.config.maxZipEntries) {
    throw new PayloadTooLargeError('too many files for one bundle', {
      requested: requested.length,
      max: ctx.config.maxZipEntries,
    });
  }

  const seen = new Set<string>();
  const files: BundleFile[] = [];
  for (const item of requested) {
    const url = item.url.trim();
    if (url === '' || seen.has(url)) continue;
    seen.add(url);
    assertSourceAllowed(ctx, url);
    files.push(await probeFile(ctx, url, item.name));
  }
  if (files.length === 0) throw new BadRequestError('no valid files given');

  const bundle: Bundle = { name: bundleName(name), files: dedupeNames(files) };
  const code = await putBundle(kv, bundle, ctx.config.shortLinkTtlSeconds);
  ctx.log.info('bundle created', { code, files: files.length, bytes: totalBytes(bundle) });

  return jsonResponse(ctx, bundleSummary(code, bundle));
}

/**
 * Probe a URL for its size and filename without downloading it.
 *
 * Sizes must be exact, because the archive layout (and `Content-Length`) is
 * planned before a byte is fetched. Two things conspire against that:
 *
 *  - An origin that applies `Content-Encoding` reports the *encoded* length in
 *    `Content-Length`/`Content-Range`, while the runtime hands us the decoded
 *    body. The mismatch would corrupt the archive.
 *  - The Workers runtime manages `Accept-Encoding` on subrequests and strips
 *    `Content-Encoding` from the response, so neither the request hint nor the
 *    response header reveals whether that happened.
 *
 * So the probe is empirical: ask for a small, known-width range and count what
 * actually arrives. An origin serving identity bytes returns exactly the
 * requested width — its advertised total can then be trusted. Anything else
 * means the body is being transcoded, and the file is measured in full instead.
 */
async function probeFile(ctx: RequestContext, url: string, given?: string): Promise<BundleFile> {
  // R2 reports the true size and never transcodes, so one `head` settles it —
  // none of the ambiguity that forces the range probe for HTTP origins.
  if (isR2Source(url)) {
    const key = r2Key(url);
    const object = await requireBucket(ctx).head(key);
    if (!object) throw new NotFoundError('object not found in the bound R2 bucket', { key });
    return {
      url,
      name: trimmedName(given) ?? safeName(key.slice(key.lastIndexOf('/') + 1)),
      size: object.size,
      ranged: true,
      lastModified: object.uploaded.getTime(),
    };
  }

  const options = {
    timeoutMs: ctx.config.originTimeoutMs,
    retries: ctx.config.originRetries,
    signal: ctx.signal,
  };

  const width = 16;
  const probe = await fetchWithResilience(
    ctx.deps.fetch,
    url,
    { method: HttpMethod.GET, headers: { ...IDENTITY, [Header.RANGE]: `bytes=0-${width - 1}` } },
    options,
  );

  let total: number | undefined;
  if (probe.status === Status.PARTIAL_CONTENT) {
    total = totalFromContentRange(probe.headers.get(Header.CONTENT_RANGE));
  }
  total ??= contentLengthOf(probe);

  const received = await countBytes(probe);
  const modified = lastModifiedOf(probe);
  const name = trimmedName(given) ?? nameFromResponse(probe, url);

  // Exactly the requested window (or the whole file, if shorter) came back as
  // raw bytes: ranges are honoured verbatim and the advertised total is real.
  const trustworthy =
    probe.status === Status.PARTIAL_CONTENT &&
    total !== undefined &&
    received === Math.min(width, total);

  if (trustworthy && total !== undefined) {
    return {
      url,
      name,
      size: total,
      ranged: true,
      ...(modified === undefined ? {} : { lastModified: modified }),
    };
  }

  // The origin is transcoding (or ignores ranges): its numbers describe
  // something other than the bytes we would receive. Read the file once to learn
  // its true size, computing the CRC-32 in the same pass — which also makes ZIP
  // immediately available for it.
  if (total !== undefined && total > MEASURE_ENCODED_LIMIT) {
    throw new PayloadTooLargeError(
      'this origin transcodes its responses, so the file must be measured, and it is too large to measure',
      { url, advertised: total, limit: MEASURE_ENCODED_LIMIT },
    );
  }
  const measured = await measureFile(ctx, url, name);
  return { ...measured, ...(modified === undefined ? {} : { lastModified: modified }) };
}

/** Drain a response, returning how many bytes it actually produced. */
async function countBytes(response: Response): Promise<number> {
  const body = response.body as ReadableStream<Uint8Array> | null;
  if (!body) return 0;
  const reader = body.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
  }
  return total;
}

/** Stream a file once to learn its true decoded size and CRC-32. */
async function measureFile(ctx: RequestContext, url: string, name: string): Promise<BundleFile> {
  const response = await fetchWithResilience(
    ctx.deps.fetch,
    url,
    { method: HttpMethod.GET, headers: { ...IDENTITY } },
    {
      timeoutMs: ctx.config.originTimeoutMs,
      retries: ctx.config.originRetries,
      signal: ctx.signal,
    },
  );
  const body = response.body as ReadableStream<Uint8Array> | null;
  if (!response.ok || !body) {
    throw new UpstreamError('origin refused a bundle file', { url, status: response.status });
  }

  const reader = body.getReader();
  let state = CRC32_INIT;
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MEASURE_DECODED_LIMIT) {
      await reader.cancel().catch(() => undefined);
      throw new PayloadTooLargeError('file expands beyond the measurable limit', {
        url,
        limit: MEASURE_DECODED_LIMIT,
      });
    }
    state = crc32Update(state, value);
  }

  // `ranged: false` — this origin's ranges cannot be trusted, so the archive
  // re-reads the file as a whole.
  return { url, name, size, ranged: false, crc32: (state ^ 0xffffffff) >>> 0 };
}

// --- prepare (resumable CRC-32) ----------------------------------------------

/**
 * Checksum up to {@link PREPARE_BUDGET_BYTES} of outstanding data, resuming each
 * file from where the previous call stopped, then persist the progress. Call
 * repeatedly until `complete` — the response reports how much is left.
 */
export async function prepareBundleHandler(ctx: RequestContext, code: string): Promise<Response> {
  const kv = requireLinksKv(ctx);
  const bundle = await loadBundle(kv, code);

  let budget = PREPARE_BUDGET_BYTES;
  const files = [...bundle.files];

  for (let i = 0; i < files.length && budget > 0; i++) {
    const file = files[i];
    if (!file || typeof file.crc32 === 'number') continue;

    const from = file.crcDone ?? 0;
    const take = Math.min(budget, file.size - from);
    if (take <= 0) {
      // Nothing left to read (an empty file, or already fully folded in):
      // finalise from the running register. An empty file yields CRC-32 0.
      files[i] = { ...file, crc32: ((file.crcState ?? CRC32_INIT) ^ 0xffffffff) >>> 0 };
      continue;
    }

    // Same opener the download path uses, so R2 and HTTP behave identically.
    const stream = await openBundleSlice(ctx, file, from, take, ctx.signal);

    let state = file.crcState ?? CRC32_INIT;
    let read = 0;
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      state = crc32Update(state, value);
      read += value.byteLength;
    }

    const done = from + read;
    budget -= read;
    files[i] =
      done >= file.size
        ? { ...file, crc32: (state ^ 0xffffffff) >>> 0, crcDone: done, crcState: state }
        : { ...file, crcDone: done, crcState: state };
  }

  const updated: Bundle = { ...bundle, files };
  await writeBundle(kv, code, updated, ctx.config.shortLinkTtlSeconds);

  const remaining = crcRemaining(updated);
  ctx.log.info('bundle prepare pass', { code, remaining, zipReady: isZipReady(updated) });
  return jsonResponse(ctx, {
    ...bundleSummary(code, updated),
    prepared: totalBytes(updated) - remaining,
    remaining,
    complete: isZipReady(updated),
  });
}

// --- download ----------------------------------------------------------------

/**
 * Stream a bundle as TAR or ZIP, **with `Range` support**.
 *
 * Because every size (and, for ZIP, every CRC-32) is known before a byte is
 * fetched, the output is a pure function of position: the archive is described
 * as a segment map, so any byte window can be computed and served directly. That
 * makes a generated archive resumable, reachable by download managers, and
 * parallelisable — and since each range is its own invocation with its own CPU
 * budget, it also lifts the per-request ceiling on very large archives.
 *
 * This is the bargain nginx's `mod_zip` strikes: checksums up front buy Range.
 */
export async function bundleDownloadHandler(
  ctx: RequestContext,
  code: string,
  format: 'tar' | 'zip',
): Promise<Response> {
  const kv = requireLinksKv(ctx);
  const bundle = await loadBundle(kv, code);
  const isHead = ctx.request.method === HttpMethod.HEAD;

  if (format === 'zip' && !isZipReady(bundle)) {
    // Serving ZIP without cached CRC-32s would mean checksumming inline, which
    // is exactly the per-byte cost the prepare pass exists to amortise.
    throw new BadRequestError(
      'this bundle is not prepared for ZIP yet; POST to the prepare endpoint until complete, or download the .tar (ready now, any size)',
      { code, remaining: crcRemaining(bundle) },
    );
  }

  const segments = archiveSegments(bundle, format);
  const contentLength = totalLength(segments);
  const validators = bundleValidators(bundle, format);

  if (isNotModified(ctx.request, validators)) {
    const headers = new Headers({ [Header.X_REQUEST_ID]: ctx.requestId });
    if (validators.etag) headers.set(Header.ETAG, validators.etag);
    return new Response(null, { status: Status.NOT_MODIFIED, headers });
  }

  const rangeApplies = isRangeApplicable(ctx.request, validators);
  const rangeHeader = rangeApplies ? ctx.request.headers.get(Header.RANGE) : null;
  const range = parseRange(rangeHeader, contentLength);
  if (range.kind === 'unsatisfiable') {
    throw new RangeNotSatisfiableError(contentLength);
  }

  const partial = range.kind === 'satisfiable';
  const start = partial ? range.range.start : 0;
  const end = partial ? range.range.end : Math.max(contentLength - 1, 0);
  const bodyLength = partial ? end - start + 1 : contentLength;

  const headers = new Headers({
    [Header.CONTENT_TYPE]: format === 'tar' ? 'application/x-tar' : 'application/zip',
    [Header.CONTENT_LENGTH]: String(bodyLength),
    [Header.ACCEPT_RANGES]: 'bytes',
    [Header.CONTENT_DISPOSITION]: contentDisposition('attachment', bundle.name + '.' + format),
    // The layout is deterministic, so a code always yields the same bytes.
    [Header.CACHE_CONTROL]: 'private, max-age=' + String(ctx.config.cacheTtlSeconds),
    [Header.X_REQUEST_ID]: ctx.requestId,
    'x-bundle-entries': String(bundle.files.length),
  });
  if (validators.etag) headers.set(Header.ETAG, validators.etag);
  if (partial) headers.set(Header.CONTENT_RANGE, formatContentRange(start, end, contentLength));

  const status = partial ? Status.PARTIAL_CONTENT : Status.OK;
  if (isHead) return new Response(null, { status, headers });

  const slices = partial ? sliceSegments(segments, start, end) : wholeSlices(segments);
  const open: OpenSlice = (index, offset, length, signal) =>
    openBundleSlice(ctx, bundle.files[index], offset, length, signal);

  const body = streamSlices(slices, bodyLength, open, {
    signal: ctx.signal,
    onBytes: (bytes) => {
      ctx.log.info('bundle streamed', { code, format, bytes, partial });
    },
  });
  return new Response(body, { status, headers });
}

/** The archive's byte map for the requested format. */
function archiveSegments(bundle: Bundle, format: 'tar' | 'zip'): Segment[] {
  return format === 'tar'
    ? tarSegments(planTar(bundle.files.map(toTarFile)))
    : bundleZipSegments(bundle.files).segments;
}

/**
 * A strong validator over the *content* of the bundle — names, sizes and
 * checksums — not the URLs behind it. Re-signing a source URL therefore does not
 * invalidate a half-finished download, which is exactly what `If-Range` needs.
 */
function bundleValidators(bundle: Bundle, format: 'tar' | 'zip'): Validators {
  const signature = [
    format,
    bundle.name,
    ...bundle.files.map((file) => file.name + ':' + String(file.size) + ':' + String(file.crc32 ?? '')),
  ].join('|');
  const digest = crc32(new TextEncoder().encode(signature)).toString(16);
  return { etag: '"' + digest + '-' + totalBytes(bundle).toString(16) + '"' };
}

/**
 * Open `length` bytes of one bundle file, `start` bytes in.
 *
 * A range-capable origin serves that window directly, keeping the read native.
 * An origin that cannot (it transcodes, so its ranges describe encoded bytes) is
 * read whole and trimmed in-process — correct, and bounded, because such files
 * were measured at create time.
 */
async function openBundleSlice(
  ctx: RequestContext,
  file: BundleFile | undefined,
  start: number,
  length: number,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  if (!file) throw new NotFoundError('bundle entry missing');

  if (isR2Source(file.url)) {
    // A bucket read is not an external subrequest, which is what lets an R2
    // bundle hold ~1,000 files on the Free plan instead of ~48.
    const key = r2Key(file.url);
    const object = await requireBucket(ctx).get(key, { range: { offset: start, length } });
    if (!object || !('body' in object)) {
      throw new NotFoundError('object disappeared from the bound R2 bucket', { key });
    }
    return object.body;
  }

  const headers: Record<string, string> = { ...IDENTITY };
  if (file.ranged && file.size > 0) {
    headers[Header.RANGE] = 'bytes=' + String(start) + '-' + String(start + length - 1);
  }

  const response = await fetchWithResilience(
    ctx.deps.fetch,
    file.url,
    { method: HttpMethod.GET, headers },
    {
      timeoutMs: ctx.config.originTimeoutMs,
      retries: ctx.config.originRetries,
      signal: signal ?? ctx.signal,
    },
  );
  const body = response.body as ReadableStream<Uint8Array> | null;
  if (!response.ok || !body) {
    throw new UpstreamError('origin refused a bundle file', {
      url: file.url,
      status: response.status,
    });
  }

  const delivered = contentLengthOf(response);
  const expected = file.ranged ? length : file.size;
  if (delivered !== undefined && delivered !== expected) {
    // The layout was planned from the recorded size; a changed (or re-encoded)
    // file would corrupt the archive, so fail rather than emit a broken one.
    await body.cancel().catch(() => undefined);
    throw new UpstreamError('file changed since the bundle was created', {
      url: file.url,
      expected,
      actual: delivered,
    });
  }

  if (file.ranged) return body;
  return start === 0 && length === file.size ? body : body.pipeThrough(sliceStream(start, length));
}

// --- helpers -----------------------------------------------------------------

function requireLinksKv(ctx: RequestContext): KVNamespace {
  const kv = ctx.deps.links;
  if (!kv) throw new ServiceUnavailableError('bundles are not enabled (no LINKS_KV binding)');
  return kv;
}

function requireOpenMode(ctx: RequestContext): void {
  if (!ctx.config.allowAnyArchiveHost && ctx.config.allowedHosts.size === 0) {
    throw new ForbiddenError('bundles require ALLOW_ANY_ARCHIVE_HOST or ALLOWED_ARCHIVE_HOSTS');
  }
}

async function loadBundle(kv: KVNamespace, code: string): Promise<Bundle> {
  const bundle = await getBundle(kv, code);
  if (!bundle) throw new NotFoundError('bundle not found or expired', { code });
  return bundle;
}

function bundleSummary(code: string, bundle: Bundle): Record<string, unknown> {
  return {
    code,
    tar: `/bundle/${code}.tar`,
    zip: `/bundle/${code}.zip`,
    name: bundle.name,
    files: bundle.files.map((file) => ({
      name: file.name,
      size: file.size,
      crc: typeof file.crc32 === 'number',
    })),
    totalBytes: totalBytes(bundle),
    tarBytes: planTar(bundle.files.map(toTarFile)).contentLength,
    zipBytes: planBundleZip(bundle.files),
    zipReady: isZipReady(bundle),
    crcRemaining: crcRemaining(bundle),
  };
}

function toTarFile(file: BundleFile): TarFile {
  return {
    name: file.name,
    size: file.size,
    ...(file.lastModified === undefined ? {} : { lastModified: file.lastModified }),
  };
}

async function readBundleRequest(
  ctx: RequestContext,
): Promise<{ files: RequestedFile[]; name?: string }> {
  const raw = await ctx.request.text();
  if (raw.length > MAX_BODY_BYTES) throw new BadRequestError('request body too large');
  if (raw.trim() === '') throw new BadRequestError('missing JSON body {"files":[{"url":"…"}]}');

  let parsed: { files?: unknown; urls?: unknown; name?: unknown };
  try {
    parsed = JSON.parse(raw) as typeof parsed;
  } catch {
    throw new BadRequestError('request body must be JSON');
  }

  const files: RequestedFile[] = [];
  const source = Array.isArray(parsed.files) ? parsed.files : parsed.urls;
  if (Array.isArray(source)) {
    for (const item of source) {
      if (typeof item === 'string') files.push({ url: item });
      else if (item && typeof item === 'object') {
        const record = item as { url?: unknown; name?: unknown };
        if (typeof record.url === 'string') {
          files.push({
            url: record.url,
            ...(typeof record.name === 'string' ? { name: record.name } : {}),
          });
        }
      }
    }
  }
  return { files, ...(typeof parsed.name === 'string' ? { name: parsed.name } : {}) };
}

/** A caller-supplied name, when it is non-empty. */
function trimmedName(given: string | undefined): string | undefined {
  const value = given?.trim();
  return value === undefined || value === '' ? undefined : value;
}

function contentLengthOf(response: Response): number | undefined {
  const raw = response.headers.get(Header.CONTENT_LENGTH);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function totalFromContentRange(value: string | null): number | undefined {
  const match = /\/(\d+)\s*$/.exec(value ?? '');
  if (!match?.[1]) return undefined;
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : undefined;
}

function lastModifiedOf(response: Response): number | undefined {
  const raw = response.headers.get(Header.LAST_MODIFIED);
  if (!raw) return undefined;
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? undefined : parsed;
}

/** Derive a filename from Content-Disposition, else the URL path. */
function nameFromResponse(response: Response, url: string): string {
  const disposition = response.headers.get(Header.CONTENT_DISPOSITION) ?? '';
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(disposition);
  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  const raw = star?.[1] ?? plain?.[1];
  if (raw) {
    try {
      return safeName(decodeURIComponent(raw.trim()));
    } catch {
      return safeName(raw.trim());
    }
  }
  try {
    const path = new URL(url).pathname;
    const base = decodeURIComponent(path.slice(path.lastIndexOf('/') + 1));
    if (base) return safeName(base);
  } catch {
    /* fall through */
  }
  return 'file';
}

/** Strip path separators and control characters from a proposed entry name. */
function safeName(value: string): string {
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) continue;
    out += char === '/' || char === '\\' ? '_' : char;
  }
  out = out.replace(/^\.+/, '').trim();
  return out === '' ? 'file' : out.slice(0, 200);
}

/** Ensure entry names are unique inside the archive. */
function dedupeNames(files: readonly BundleFile[]): BundleFile[] {
  const seen = new Map<string, number>();
  return files.map((file) => {
    const count = seen.get(file.name) ?? 0;
    seen.set(file.name, count + 1);
    if (count === 0) return file;
    const dot = file.name.lastIndexOf('.');
    const name =
      dot > 0
        ? `${file.name.slice(0, dot)} (${count})${file.name.slice(dot)}`
        : `${file.name} (${count})`;
    return { ...file, name };
  });
}

function bundleName(raw: string | undefined): string {
  const base = (raw ?? '').trim().replace(/[/\\]/g, '_').replace(/\.(tar|zip)$/i, '');
  return base === '' ? 'bundle' : base.slice(0, 100);
}
