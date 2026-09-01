import { BadRequestError, ForbiddenError, ServiceUnavailableError } from '../errors/http-error.js';
import { assertSourceAllowed } from '../security/source.js';
import { putShortLink } from '../services/short-link.js';
import type { RequestContext } from '../types/context.js';
import { jsonResponse } from './respond.js';

/** A body larger than this is not a URL — refuse before reading it all. */
const MAX_BODY_BYTES = 8_192;

/**
 * `POST /{prefix}/shorten` — turn a (long, often signed) archive URL into a short
 * code so the UI can serve `/s/{code}/{file}` links. The URL is validated exactly
 * as a download would validate it (SSRF + allowlist), then stored in KV under a
 * deterministic code. Returns `{ code, path, url, ttl }`.
 *
 * Requires the `LINKS_KV` binding and the same access as multi-archive mode
 * (open host mode or an allowlist); otherwise it refuses rather than storing an
 * arbitrary URL a locked-down deployment would never serve.
 */
export async function shortenHandler(ctx: RequestContext): Promise<Response> {
  const kv = ctx.deps.links;
  if (!kv) {
    throw new ServiceUnavailableError('short links are not enabled (no LINKS_KV binding)');
  }
  if (!ctx.config.allowAnyArchiveHost && ctx.config.allowedHosts.size === 0) {
    throw new ForbiddenError(
      'shortening requires ALLOW_ANY_ARCHIVE_HOST or ALLOWED_ARCHIVE_HOSTS',
    );
  }

  const url = await readUrl(ctx);
  // Reject anything we would not be willing to fetch as an archive.
  assertSourceAllowed(ctx, url);

  const code = await putShortLink(kv, url, ctx.config.shortLinkTtlSeconds);
  ctx.log.info('short link created', { code, ttl: ctx.config.shortLinkTtlSeconds });

  return jsonResponse(ctx, {
    code,
    zfile: `/zfile/${code}`, // browse the archive
    sfile: `/sfile/${code}`, // prefix for single-file downloads: /sfile/{code}/{file}
    url,
    ttl: ctx.config.shortLinkTtlSeconds,
  });
}

/** Read the URL from `?url=` or a JSON body (`{"url":…}`), size-guarded. */
async function readUrl(ctx: RequestContext): Promise<string> {
  const fromQuery = ctx.url.searchParams.get('url');
  if (fromQuery?.trim()) return fromQuery.trim();

  const declared = Number(ctx.request.headers.get('content-length') ?? '0');
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new BadRequestError('request body too large');
  }
  const raw = await ctx.request.text();
  if (raw.length > MAX_BODY_BYTES) {
    throw new BadRequestError('request body too large');
  }
  if (raw.trim()) {
    try {
      const body = JSON.parse(raw) as { url?: unknown };
      if (typeof body.url === 'string' && body.url.trim()) return body.url.trim();
    } catch {
      throw new BadRequestError('request body must be JSON: {"url":"…"}');
    }
  }
  throw new BadRequestError('missing archive URL (send {"url":"…"} or ?url=)');
}
