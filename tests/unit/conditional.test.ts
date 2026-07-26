import { describe, expect, it } from 'vitest';
import { isNotModified, isRangeApplicable } from '../../src/http/conditional.js';

const validators = { etag: '"abc123"', lastModified: 'Wed, 21 Oct 2026 07:28:00 GMT' };

function request(headers: Record<string, string>): Request {
  return new Request('https://x/', { headers });
}

describe('isNotModified', () => {
  it('matches a strong ETag via If-None-Match', () => {
    expect(isNotModified(request({ 'if-none-match': '"abc123"' }), validators)).toBe(true);
  });

  it('matches a weak ETag comparison', () => {
    expect(isNotModified(request({ 'if-none-match': 'W/"abc123"' }), validators)).toBe(true);
  });

  it('matches the wildcard', () => {
    expect(isNotModified(request({ 'if-none-match': '*' }), validators)).toBe(true);
  });

  it('does not match a different ETag', () => {
    expect(isNotModified(request({ 'if-none-match': '"different"' }), validators)).toBe(false);
  });

  it('honours If-Modified-Since when the resource is not newer', () => {
    expect(isNotModified(request({ 'if-modified-since': 'Wed, 21 Oct 2026 07:28:00 GMT' }), validators)).toBe(
      true,
    );
  });

  it('reports modified when the resource is newer than If-Modified-Since', () => {
    expect(isNotModified(request({ 'if-modified-since': 'Tue, 20 Oct 2026 07:28:00 GMT' }), validators)).toBe(
      false,
    );
  });

  it('prefers If-None-Match over If-Modified-Since', () => {
    const req = request({
      'if-none-match': '"different"',
      'if-modified-since': 'Wed, 21 Oct 2026 07:28:00 GMT',
    });
    expect(isNotModified(req, validators)).toBe(false);
  });
});

describe('isRangeApplicable (If-Range)', () => {
  it('applies the range when there is no If-Range', () => {
    expect(isRangeApplicable(request({}), validators)).toBe(true);
  });

  it('applies the range when the strong ETag still matches', () => {
    expect(isRangeApplicable(request({ 'if-range': '"abc123"' }), validators)).toBe(true);
  });

  it('ignores the range when the ETag no longer matches', () => {
    expect(isRangeApplicable(request({ 'if-range': '"stale"' }), validators)).toBe(false);
  });

  it('rejects weak validators for If-Range', () => {
    expect(isRangeApplicable(request({ 'if-range': 'W/"abc123"' }), validators)).toBe(false);
  });

  it('applies the range when the If-Range date is not older than Last-Modified', () => {
    expect(isRangeApplicable(request({ 'if-range': 'Wed, 21 Oct 2026 07:28:00 GMT' }), validators)).toBe(
      true,
    );
  });
});
