/** HTTP methods this service handles. */
export const HttpMethod = {
  GET: 'GET',
  HEAD: 'HEAD',
  OPTIONS: 'OPTIONS',
  POST: 'POST',
} as const;

/** HTTP status codes used across the service. */
export const Status = {
  OK: 200,
  PARTIAL_CONTENT: 206,
  NOT_MODIFIED: 304,
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  NOT_ACCEPTABLE: 406,
  RANGE_NOT_SATISFIABLE: 416,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_SERVER_ERROR: 500,
  NOT_IMPLEMENTED: 501,
  BAD_GATEWAY: 502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

/** Canonical header names (lower-case as used by the Fetch API `Headers`). */
export const Header = {
  ACCEPT_RANGES: 'accept-ranges',
  CACHE_CONTROL: 'cache-control',
  CONTENT_DISPOSITION: 'content-disposition',
  CONTENT_ENCODING: 'content-encoding',
  CONTENT_LENGTH: 'content-length',
  CONTENT_RANGE: 'content-range',
  CONTENT_TYPE: 'content-type',
  ETAG: 'etag',
  IF_MODIFIED_SINCE: 'if-modified-since',
  IF_NONE_MATCH: 'if-none-match',
  IF_RANGE: 'if-range',
  LAST_MODIFIED: 'last-modified',
  LOCATION: 'location',
  RANGE: 'range',
  VARY: 'vary',
  X_REQUEST_ID: 'x-request-id',
  X_CONTENT_TYPE_OPTIONS: 'x-content-type-options',
} as const;

/** Default MIME type for entries whose extension we do not recognise. */
export const DEFAULT_CONTENT_TYPE = 'application/octet-stream';

/** The unit token used by HTTP range requests. */
export const BYTES_UNIT = 'bytes';
