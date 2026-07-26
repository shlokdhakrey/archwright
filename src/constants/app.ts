/**
 * Static service metadata. `VERSION` is surfaced by the `/version` endpoint and
 * on the `Server`/diagnostic surfaces; keep it in sync with package.json (the
 * release workflow asserts this).
 */
export const SERVICE_NAME = 'zipstream';
export const VERSION = '1.0.0';
export const REPOSITORY_URL = 'https://github.com/your-org/zipstream-worker';
export const USER_AGENT = `${SERVICE_NAME}/${VERSION} (+${REPOSITORY_URL})`;
