import { Header } from '../constants/http.js';
import type { RequestContext } from '../types/context.js';
import { renderAppPage } from '../ui/page.js';

/** Serve the self-contained browser UI (HTML) at `/`. */
export function uiHandler(ctx: RequestContext): Response {
  const html = renderAppPage({
    mode: ctx.config.mode,
    prefix: ctx.config.controlPrefix,
    open: ctx.config.allowAnyArchiveHost,
  });
  return new Response(html, {
    status: 200,
    headers: {
      [Header.CONTENT_TYPE]: 'text/html; charset=utf-8',
      [Header.CACHE_CONTROL]: 'public, max-age=300',
      [Header.X_REQUEST_ID]: ctx.requestId,
    },
  });
}
