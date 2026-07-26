import { REPOSITORY_URL, SERVICE_NAME, VERSION } from '../constants/app.js';
import type { RequestContext } from '../types/context.js';
import { jsonResponse } from './respond.js';

/**
 * A small, self-describing index at `/`. It documents the available routes for
 * the current mode so an operator hitting the root gets something useful rather
 * than a 404.
 */
export function rootHandler(ctx: RequestContext): Response {
  const prefix = ctx.config.controlPrefix;
  const single = ctx.config.mode === 'single';

  const endpoints = single
    ? {
        health: `/${prefix}/health`,
        version: `/${prefix}/version`,
        list: `/${prefix}/list`,
        metadata: `/${prefix}/meta/{entryPath}`,
        download: `/{entryPath}`,
      }
    : {
        health: `/${prefix}/health`,
        version: `/${prefix}/version`,
        list: `/a/{archiveRef}/${prefix}/list`,
        metadata: `/a/{archiveRef}/${prefix}/meta/{entryPath}`,
        download: `/a/{archiveRef}/{entryPath}`,
      };

  return jsonResponse(
    ctx,
    {
      service: SERVICE_NAME,
      version: VERSION,
      description: 'Stream individual files out of a remote ZIP archive, without extraction.',
      mode: ctx.config.mode,
      repository: REPOSITORY_URL,
      endpoints,
    },
    200,
    { 'cache-control': 'public, max-age=300' },
  );
}
