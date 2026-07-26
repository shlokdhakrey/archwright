import { openArchive } from '../services/archive-service.js';
import type { RequestContext } from '../types/context.js';
import { entryToJson } from './entry-json.js';
import { cacheHeaders, jsonResponse } from './respond.js';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 10_000;

/**
 * List the entries of an archive as JSON, with prefix filtering and cursor
 * pagination so even archives with hundreds of thousands of entries return
 * bounded responses. Directories are excluded unless `?dirs=true`.
 */
export async function listHandler(ctx: RequestContext, archiveUrl: string): Promise<Response> {
  const { archive, source } = await openArchive(ctx, archiveUrl);

  const params = ctx.url.searchParams;
  const prefix = params.get('prefix') ?? '';
  const includeDirectories = params.get('dirs') === 'true';
  const limit = clampParam(params.get('limit'), DEFAULT_LIMIT, 1, MAX_LIMIT);
  const cursor = clampParam(params.get('cursor'), 0, 0, Number.MAX_SAFE_INTEGER);

  const filtered = archive.entries.filter(
    (entry) => (includeDirectories || !entry.isDirectory) && entry.name.startsWith(prefix),
  );
  const page = filtered.slice(cursor, cursor + limit);
  const nextCursor = cursor + limit < filtered.length ? cursor + limit : null;

  return jsonResponse(
    ctx,
    {
      archive: {
        size: archive.archiveSize,
        entryCount: archive.entries.length,
        zip64: archive.directory.isZip64,
        source,
      },
      pagination: { cursor, limit, returned: page.length, total: filtered.length, nextCursor },
      entries: page.map(entryToJson),
    },
    200,
    cacheHeaders(ctx, archive.validators),
  );
}

function clampParam(value: string | null, fallback: number, min: number, max: number): number {
  if (value === null || value.trim() === '') return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}
