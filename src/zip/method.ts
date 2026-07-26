import { CompressionMethod } from '../constants/zip.js';

/** True when this Worker can serve an entry with the given compression method. */
export function isSupportedMethod(method: number): boolean {
  return method === CompressionMethod.STORED || method === CompressionMethod.DEFLATE;
}

/** Human-readable label for a compression method (for logs and the API). */
export function methodName(method: number): string {
  switch (method) {
    case CompressionMethod.STORED:
      return 'stored';
    case CompressionMethod.DEFLATE:
      return 'deflate';
    default:
      return `method-${method}`;
  }
}
