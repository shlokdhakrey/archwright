import {
  bundleDownloadHandler,
  createBundleHandler,
  downloadHandler,
  healthHandler,
  listHandler,
  metaHandler,
  optionsHandler,
  playHandler,
  prepareBundleHandler,
  rootHandler,
  shortenHandler,
  subtitleHandler,
  tarHandler,
  uiHandler,
  versionHandler,
  zipHandler,
} from '../handlers/index.js';
import type { RequestContext } from '../types/context.js';
import type { Handler } from '../middleware/types.js';
import { resolveRoute } from './resolve.js';

/**
 * The terminal handler: resolve the route, then dispatch to the matching
 * handler. The `switch` is exhaustive over the {@link Route} union, so adding a
 * route is a compile error until it is wired here.
 */
export const router: Handler = async (ctx: RequestContext): Promise<Response> => {
  const route = await resolveRoute(ctx);
  switch (route.kind) {
    case 'root':
      return ctx.config.serveUi ? uiHandler(ctx) : rootHandler(ctx);
    case 'health':
      return healthHandler(ctx);
    case 'version':
      return versionHandler(ctx);
    case 'options':
      return optionsHandler(ctx);
    case 'shorten':
      return shortenHandler(ctx);
    case 'bundle-create':
      return createBundleHandler(ctx);
    case 'bundle-prepare':
      return prepareBundleHandler(ctx, route.code);
    case 'bundle-download':
      return bundleDownloadHandler(ctx, route.code, route.format);
    case 'list':
      return listHandler(ctx, route.archiveUrl);
    case 'zip':
      return zipHandler(ctx, route.archiveUrl);
    case 'tar':
      return tarHandler(ctx, route.archiveUrl);
    case 'meta':
      return metaHandler(ctx, route.archiveUrl, route.entryPath);
    case 'play':
      return playHandler(ctx, route.archiveUrl, route.entryPath);
    case 'subtitle':
      return subtitleHandler(ctx, route.archiveUrl, route.entryPath);
    case 'download':
      return downloadHandler(ctx, route.archiveUrl, route.entryPath);
  }
};
