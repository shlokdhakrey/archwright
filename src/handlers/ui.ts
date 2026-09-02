import { Header } from '../constants/http.js';
import { NotFoundError } from '../errors/http-error.js';
import type { SitePage } from '../routes/resolve.js';
import type { RequestContext } from '../types/context.js';
import { renderHomePage } from '../ui/pages/home.js';
import { renderNotFoundPage } from '../ui/pages/not-found.js';
import { renderBundlePage } from '../ui/pages/bundle.js';
import { renderExtractPage } from '../ui/pages/extract.js';
import { rootHandler } from './root.js';

/** Every page of the site is served the same way; only the body differs. */
function htmlResponse(ctx: RequestContext, html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: {
      [Header.CONTENT_TYPE]: 'text/html; charset=utf-8',
      [Header.CACHE_CONTROL]: status === 200 ? 'public, max-age=120' : 'no-store',
      [Header.X_REQUEST_ID]: ctx.requestId,
    },
  });
}

/** The homepage at `/`. With the UI switched off this is a JSON index instead. */
export function homeHandler(ctx: RequestContext): Response {
  if (!ctx.config.serveUi) return rootHandler(ctx);
  return htmlResponse(ctx, renderHomePage());
}

/** A reserved site page. */
export function pageHandler(ctx: RequestContext, name: SitePage): Response {
  if (!ctx.config.serveUi) {
    throw new NotFoundError('the browser UI is disabled on this deployment (SERVE_UI=false)');
  }
  if (name === 'guide') {
    // The guide is built in the next stage; keep navigation honest until then.
    return htmlResponse(ctx, renderNotFoundPage(), 404);
  }
  if (name === 'bundle') {
    return htmlResponse(ctx, renderBundlePage({ prefix: ctx.config.controlPrefix }));
  }
  return htmlResponse(ctx, extractPage(ctx));
}

/** The archive tool, also served at an archive-scoped root such as /zfile/{code}. */
function extractPage(ctx: RequestContext): string {
  return renderExtractPage({
    mode: ctx.config.mode,
    prefix: ctx.config.controlPrefix,
    open: ctx.config.allowAnyArchiveHost,
  });
}

/** The styled 404, for browsers. */
export function notFoundPageHandler(ctx: RequestContext): Response {
  return htmlResponse(ctx, renderNotFoundPage(), 404);
}

/**
 * The archive tool at an archive-scoped root — `/zfile/{code}` and `/a/{ref}` —
 * which auto-loads the archive named in the path.
 */
export function uiHandler(ctx: RequestContext): Response {
  return htmlResponse(ctx, extractPage(ctx));
}
