import { NotFoundError } from '../errors/http-error.js';
import { openArchive } from '../services/archive-service.js';
import { entryValidators } from '../services/entry-validators.js';
import type { RequestContext } from '../types/context.js';
import { normaliseRequestedPath } from '../validation/entry-path.js';
import { entryToJson } from './entry-json.js';
import { cacheHeaders, jsonResponse } from './respond.js';

/**
 * Return metadata for a single entry without transferring its bytes. Carries the
 * same ETag/Last-Modified the download endpoint uses, so a client can cheaply
 * discover and cache-validate an entry before fetching it.
 */
export async function metaHandler(
  ctx: RequestContext,
  archiveUrl: string,
  entryPath: string,
): Promise<Response> {
  const key = normaliseRequestedPath(entryPath);
  const { archive } = await openArchive(ctx, archiveUrl);

  const entry = archive.getEntry(key);
  if (!entry) {
    throw new NotFoundError('entry not found in archive', { path: key });
  }

  const validators = entryValidators(archive.validators, entry);
  return jsonResponse(ctx, entryToJson(entry), 200, cacheHeaders(ctx, validators));
}
