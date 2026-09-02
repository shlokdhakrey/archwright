import { Header, HttpMethod, Status } from '../constants/http.js';
import type { RequestContext } from '../types/context.js';
import { FAVICON_SVG } from '../ui/favicon.js';

/** A year — the icon is part of the build, so it can be cached hard. */
const ONE_YEAR = 31_536_000;

/**
 * Serve `/favicon.ico`.
 *
 * Rendered pages inline the icon as a `data:` URI, so a browser that follows the
 * `<link>` never asks for this at all — which matters because on Workers the
 * request would be a billed invocation spent on a 404. This route exists for the
 * cases that still ask: a browser that ignores SVG icons, a bookmark, or a
 * direct hit. It is answered from memory with an immutable cache header, so a
 * given client asks at most once.
 */
export function faviconHandler(ctx: RequestContext): Response {
  const headers = new Headers({
    [Header.CONTENT_TYPE]: 'image/svg+xml; charset=utf-8',
    [Header.CACHE_CONTROL]: `public, max-age=${String(ONE_YEAR)}, immutable`,
    [Header.X_REQUEST_ID]: ctx.requestId,
  });
  const isHead = ctx.request.method === HttpMethod.HEAD;
  return new Response(isHead ? null : FAVICON_SVG, { status: Status.OK, headers });
}
