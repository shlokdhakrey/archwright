import { HttpMethod } from '../constants/http.js';
import {
  BadRequestError,
  ForbiddenError,
  MethodNotAllowedError,
  NotFoundError,
} from '../errors/http-error.js';
import { verifyArchiveRef } from '../security/signing.js';
import { getShortLink } from '../services/short-link.js';
import type { RequestContext } from '../types/context.js';
import { base64UrlToString } from '../utils/base64url.js';

/** The resolved route for a request — a small discriminated union. */
export type Route =
  | { readonly kind: 'root' }
  | { readonly kind: 'health' }
  | { readonly kind: 'version' }
  | { readonly kind: 'options' }
  | { readonly kind: 'favicon' }
  | { readonly kind: 'shorten' }
  | { readonly kind: 'bundle-create' }
  | { readonly kind: 'bundle-prepare'; readonly code: string }
  | { readonly kind: 'bundle-download'; readonly code: string; readonly format: 'tar' | 'zip' }
  | { readonly kind: 'list'; readonly archiveUrl: string }
  | { readonly kind: 'zip'; readonly archiveUrl: string }
  | { readonly kind: 'tar'; readonly archiveUrl: string }
  | { readonly kind: 'meta'; readonly archiveUrl: string; readonly entryPath: string }
  | { readonly kind: 'play'; readonly archiveUrl: string; readonly entryPath: string }
  | { readonly kind: 'subtitle'; readonly archiveUrl: string; readonly entryPath: string }
  | { readonly kind: 'download'; readonly archiveUrl: string; readonly entryPath: string };

const ALLOWED_METHODS = [HttpMethod.GET, HttpMethod.HEAD, HttpMethod.OPTIONS] as const;

/**
 * Map a request to a {@link Route}. Method and the two addressing modes are
 * resolved here so handlers stay ignorant of URL shape:
 *
 *  - single-archive mode serves one configured archive at the path root;
 *  - multi-archive mode addresses archives via `/a/{ref}/…`, where `ref` is a
 *    signed token (if a secret is configured) or a base64url URL (gated by the
 *    host allowlist). Without either, multi-archive mode refuses to proxy.
 */
export async function resolveRoute(ctx: RequestContext): Promise<Route> {
  const { config } = ctx;
  const method = ctx.request.method;
  const path = ctx.url.pathname;
  const prefix = config.controlPrefix;

  if (method === HttpMethod.OPTIONS) return { kind: 'options' };
  // `POST /{prefix}/shorten` is the only non-idempotent endpoint — it creates a
  // short-link mapping. Every other route is GET/HEAD.
  if (method === HttpMethod.POST) {
    if (path === `/${prefix}/shorten`) return { kind: 'shorten' };
    if (path === `/${prefix}/bundle`) return { kind: 'bundle-create' };
    const prepare = new RegExp(`^/${prefix}/bundle/([^/]+)/prepare$`).exec(path);
    if (prepare?.[1]) return { kind: 'bundle-prepare', code: prepare[1] };
    throw new MethodNotAllowedError([...ALLOWED_METHODS]);
  }
  if (method !== HttpMethod.GET && method !== HttpMethod.HEAD) {
    throw new MethodNotAllowedError([...ALLOWED_METHODS]);
  }

  // Global, archive-independent control endpoints.
  if (path === `/${prefix}/health`) return { kind: 'health' };
  if (path === `/${prefix}/version`) return { kind: 'version' };
  // Pages inline their icon, so this only catches old browsers and direct hits.
  if (path === '/favicon.ico') return { kind: 'favicon' };
  if (path === '/') return { kind: 'root' };

  // Bundles: one archive assembled from many remote files.
  const bundleMatch = /^\/bundle\/([^/]+)\.(tar|zip)$/.exec(path);
  if (bundleMatch?.[1] && bundleMatch[2]) {
    return {
      kind: 'bundle-download',
      code: bundleMatch[1],
      format: bundleMatch[2] as 'tar' | 'zip',
    };
  }

  // Short links: `/zfile/{code}` (browse) and `/sfile/{code}/{file}` (download)
  // both resolve the code to an archive URL via KV, then behave exactly like
  // `/a/{ref}/…`. Two prefixes, one resolution — the split is presentational.
  const shortMatch = /^\/(?:zfile|sfile)\/([^/]+)(\/.*)?$/.exec(path);
  if (shortMatch?.[1]) {
    const archiveUrl = await resolveShortCode(ctx, shortMatch[1]);
    return resolveSubPath(archiveUrl, shortMatch[2] ?? '/', prefix);
  }

  if (config.mode === 'single') {
    const archiveUrl = config.archiveUrl ?? '';
    return resolveSubPath(archiveUrl, path, prefix);
  }

  const match = /^\/a\/([^/]+)(\/.*)?$/.exec(path);
  if (!match?.[1]) {
    throw new NotFoundError('unknown route');
  }
  const archiveUrl = await resolveArchiveRef(ctx, match[1]);
  return resolveSubPath(archiveUrl, match[2] ?? '/', prefix);
}

/** Resolve a `/s/{code}` short code to its archive URL via KV. */
async function resolveShortCode(ctx: RequestContext, code: string): Promise<string> {
  const kv = ctx.deps.links;
  if (!kv) {
    throw new NotFoundError('short links are not enabled on this deployment');
  }
  const url = await getShortLink(kv, code);
  if (url === null) {
    throw new NotFoundError('short link not found or expired', { code });
  }
  return url;
}

function resolveSubPath(archiveUrl: string, subPath: string, prefix: string): Route {
  if (subPath === '/') return { kind: 'root' };
  if (subPath === `/${prefix}/list`) return { kind: 'list', archiveUrl };
  if (subPath === `/${prefix}/zip`) return { kind: 'zip', archiveUrl };
  if (subPath === `/${prefix}/tar`) return { kind: 'tar', archiveUrl };

  const playBase = `/${prefix}/play/`;
  if (subPath.startsWith(playBase)) {
    return { kind: 'play', archiveUrl, entryPath: subPath.slice(playBase.length) };
  }

  const subtitleBase = `/${prefix}/subtitle/`;
  if (subPath.startsWith(subtitleBase)) {
    return { kind: 'subtitle', archiveUrl, entryPath: subPath.slice(subtitleBase.length) };
  }

  const metaBase = `/${prefix}/meta/`;
  if (subPath.startsWith(metaBase)) {
    return { kind: 'meta', archiveUrl, entryPath: subPath.slice(metaBase.length) };
  }
  if (subPath === `/${prefix}/meta` || subPath === `/${prefix}/meta/`) {
    throw new BadRequestError('metadata requests require an entry path');
  }

  return { kind: 'download', archiveUrl, entryPath: subPath.replace(/^\/+/, '') };
}

async function resolveArchiveRef(ctx: RequestContext, ref: string): Promise<string> {
  if (ctx.config.signingSecret !== undefined) {
    const verified = await verifyArchiveRef(ctx.config.signingSecret, ref, ctx.deps.clock.now());
    return verified.url;
  }
  // Without signing, the caller passes a base64url URL. It is only accepted when
  // an allowlist is configured (host membership enforced downstream) or open
  // mode is explicitly enabled (any public host; private IPs still blocked).
  if (!ctx.config.allowAnyArchiveHost && ctx.config.allowedHosts.size === 0) {
    throw new ForbiddenError(
      'multi-archive mode requires ALLOW_ANY_ARCHIVE_HOST, ALLOWED_ARCHIVE_HOSTS, or ARCHIVE_SIGNING_SECRET',
    );
  }
  try {
    return base64UrlToString(ref);
  } catch {
    throw new BadRequestError('invalid archive reference encoding');
  }
}
