import { describe, expect, it } from 'vitest';
import { contentDisposition } from '../../src/http/content-disposition.js';

describe('contentDisposition', () => {
  it('produces an ASCII fallback and an RFC 5987 filename*', () => {
    const value = contentDisposition('inline', 'video.mkv');
    expect(value).toBe('inline; filename="video.mkv"; filename*=UTF-8\'\'video.mkv');
  });

  it('uses the base name of a nested path', () => {
    const value = contentDisposition('attachment', 'season 1/episode.mkv');
    expect(value).toContain('filename="episode.mkv"');
    expect(value).toContain("filename*=UTF-8''episode.mkv");
  });

  it('encodes non-ASCII names and provides a safe ASCII fallback', () => {
    const value = contentDisposition('inline', 'фильм.mkv');
    expect(value).toContain('filename="_____.mkv"');
    expect(value).toContain("filename*=UTF-8''");
    expect(value).toContain('.mkv');
  });

  it('strips a trailing slash and never emits control characters', () => {
    const value = contentDisposition('inline', 'weird\r\nname.txt');
    expect(value).not.toContain('\r');
    expect(value).not.toContain('\n');
  });
});
