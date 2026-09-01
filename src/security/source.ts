import { BadRequestError, ForbiddenError, ServiceUnavailableError } from '../errors/http-error.js';
import { isR2Source, r2Key } from '../r2/r2-reader.js';
import type { RequestContext } from '../types/context.js';
import { validateArchiveUrl } from './ssrf.js';

/**
 * The single gate every byte source passes through, whether it is an archive to
 * read or a file to bundle.
 *
 * HTTP sources are checked by the SSRF rules. `r2://` sources address the bound
 * bucket directly, so those rules do not apply — but a different exposure does:
 * binding a bucket makes its objects reachable by anyone who can reach the
 * Worker. `R2_PREFIX` narrows that to a subtree, and a deployment serving a
 * private bucket should also be locked down with `ALLOWED_ARCHIVE_HOSTS` or
 * `ARCHIVE_SIGNING_SECRET` rather than left in open mode.
 */
export function assertSourceAllowed(ctx: RequestContext, source: string): void {
  if (!isR2Source(source)) {
    validateArchiveUrl(source, ctx.config.allowedHosts);
    return;
  }

  if (!ctx.deps.bucket) {
    throw new ServiceUnavailableError('r2:// sources require an R2_BUCKET binding');
  }
  const key = r2Key(source);
  if (key === '') {
    throw new BadRequestError('an r2:// source needs an object key');
  }
  const prefix = ctx.config.r2Prefix;
  if (prefix !== '' && !key.startsWith(prefix)) {
    throw new ForbiddenError('this deployment only serves R2 keys under its configured prefix', {
      prefix,
    });
  }
}

/** The bound bucket, or a clear error explaining what is missing. */
export function requireBucket(ctx: RequestContext): R2Bucket {
  const bucket = ctx.deps.bucket;
  if (!bucket) {
    throw new ServiceUnavailableError('r2:// sources require an R2_BUCKET binding');
  }
  return bucket;
}
