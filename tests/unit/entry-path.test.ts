import { describe, expect, it } from 'vitest';
import { BadRequestError } from '../../src/errors/http-error.js';
import { normaliseRequestedPath } from '../../src/validation/entry-path.js';

describe('normaliseRequestedPath', () => {
  it('strips the leading slash', () => {
    expect(normaliseRequestedPath('/dir/movie.mkv')).toBe('dir/movie.mkv');
  });

  it('percent-decodes the path', () => {
    expect(normaliseRequestedPath('/season%201/ep%2001.mkv')).toBe('season 1/ep 01.mkv');
  });

  it('folds backslashes to forward slashes', () => {
    expect(normaliseRequestedPath('/dir\\movie.mkv')).toBe('dir/movie.mkv');
  });

  it('applies Unicode NFC normalisation', () => {
    // U+0065 U+0301 (e + combining acute) normalises to U+00E9 (é).
    expect(normaliseRequestedPath('/café.txt')).toBe('café.txt');
  });

  it('rejects traversal segments', () => {
    expect(() => normaliseRequestedPath('/a/../b')).toThrow(BadRequestError);
  });

  it('rejects invalid percent-encoding', () => {
    expect(() => normaliseRequestedPath('/%zz')).toThrow(BadRequestError);
  });

  it('rejects control characters', () => {
    expect(() => normaliseRequestedPath('/a%00b')).toThrow(BadRequestError);
  });
});
