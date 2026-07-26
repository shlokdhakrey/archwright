import { describe, expect, it } from 'vitest';
import { parseConfig } from '../../src/config/parse.js';

describe('parseConfig', () => {
  it('selects single-archive mode and derives the allowlist from ARCHIVE_URL', () => {
    const config = parseConfig({ ARCHIVE_URL: 'https://storage.googleapis.com/bucket/a.zip' });
    expect(config.mode).toBe('single');
    expect(config.archiveUrl).toBe('https://storage.googleapis.com/bucket/a.zip');
    expect(config.allowedHosts.has('storage.googleapis.com')).toBe(true);
  });

  it('selects multi-archive mode when ARCHIVE_URL is empty', () => {
    const config = parseConfig({ ARCHIVE_URL: '' });
    expect(config.mode).toBe('multi');
    expect(config.archiveUrl).toBeUndefined();
  });

  it('applies safe defaults', () => {
    const config = parseConfig({});
    expect(config.controlPrefix).toBe('__');
    expect(config.cacheTtlSeconds).toBe(3600);
    expect(config.originTimeoutMs).toBe(15000);
    expect(config.originRetries).toBe(2);
    expect(config.logLevel).toBe('info');
    expect(config.disposition).toBe('attachment');
    expect(config.serveUi).toBe(true);
    expect(config.allowAnyArchiveHost).toBe(false);
    expect(config.maxZipEntries).toBe(64);
    expect(config.deflatePassthrough).toBe(true);
    expect(config.shortLinkTtlSeconds).toBe(0);
  });

  it('parses boolean flags leniently', () => {
    expect(parseConfig({ ALLOW_ANY_ARCHIVE_HOST: 'true' }).allowAnyArchiveHost).toBe(true);
    expect(parseConfig({ ALLOW_ANY_ARCHIVE_HOST: '1' }).allowAnyArchiveHost).toBe(true);
    expect(parseConfig({ SERVE_UI: 'false' }).serveUi).toBe(false);
    expect(parseConfig({ SERVE_UI: 'no' }).serveUi).toBe(false);
  });

  it('clamps out-of-range numeric values', () => {
    const config = parseConfig({ ORIGIN_RETRIES: '999', ORIGIN_TIMEOUT_MS: '10' });
    expect(config.originRetries).toBe(5);
    expect(config.originTimeoutMs).toBe(1000);
  });

  it('falls back to defaults for non-numeric values', () => {
    const config = parseConfig({ CACHE_TTL_SECONDS: 'abc' });
    expect(config.cacheTtlSeconds).toBe(3600);
  });

  it('parses a multi-host allowlist', () => {
    const config = parseConfig({ ALLOWED_ARCHIVE_HOSTS: 'a.com, b.com ,C.COM' });
    expect(config.allowedHosts.has('a.com')).toBe(true);
    expect(config.allowedHosts.has('b.com')).toBe(true);
    expect(config.allowedHosts.has('c.com')).toBe(true);
  });

  it('validates the log level', () => {
    expect(parseConfig({ LOG_LEVEL: 'verbose' }).logLevel).toBe('info');
    expect(parseConfig({ LOG_LEVEL: 'debug' }).logLevel).toBe('debug');
  });

  it('exposes the signing secret only when set', () => {
    expect(parseConfig({}).signingSecret).toBeUndefined();
    expect(parseConfig({ ARCHIVE_SIGNING_SECRET: 's3cret' }).signingSecret).toBe('s3cret');
  });
});
