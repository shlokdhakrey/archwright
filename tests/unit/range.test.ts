import { describe, expect, it } from 'vitest';
import { formatContentRange, parseRange } from '../../src/http/range.js';

describe('parseRange', () => {
  const size = 1000;

  it('returns "none" when there is no Range header', () => {
    expect(parseRange(null, size)).toEqual({ kind: 'none' });
  });

  it('parses a closed range', () => {
    expect(parseRange('bytes=0-99', size)).toEqual({ kind: 'satisfiable', range: { start: 0, end: 99 } });
  });

  it('parses an open-ended range', () => {
    expect(parseRange('bytes=500-', size)).toEqual({ kind: 'satisfiable', range: { start: 500, end: 999 } });
  });

  it('parses a suffix range', () => {
    expect(parseRange('bytes=-100', size)).toEqual({ kind: 'satisfiable', range: { start: 900, end: 999 } });
  });

  it('clamps an end that exceeds the resource size', () => {
    expect(parseRange('bytes=900-5000', size)).toEqual({
      kind: 'satisfiable',
      range: { start: 900, end: 999 },
    });
  });

  it('treats a suffix larger than the resource as the whole resource', () => {
    expect(parseRange('bytes=-5000', size)).toEqual({ kind: 'satisfiable', range: { start: 0, end: 999 } });
  });

  it('reports an unsatisfiable range when start is beyond the end', () => {
    expect(parseRange('bytes=1000-1100', size)).toEqual({ kind: 'unsatisfiable' });
  });

  it('reports "bytes=-0" as unsatisfiable', () => {
    expect(parseRange('bytes=-0', size)).toEqual({ kind: 'unsatisfiable' });
  });

  it('ignores multi-range requests (serves the whole body)', () => {
    expect(parseRange('bytes=0-10,20-30', size)).toEqual({ kind: 'none' });
  });

  it('ignores syntactically invalid ranges', () => {
    expect(parseRange('items=0-10', size)).toEqual({ kind: 'none' });
    expect(parseRange('bytes=abc', size)).toEqual({ kind: 'none' });
    expect(parseRange('bytes=-', size)).toEqual({ kind: 'none' });
  });

  it('ignores a range whose end precedes its start', () => {
    expect(parseRange('bytes=50-10', size)).toEqual({ kind: 'none' });
  });

  it('is unsatisfiable for any range on a zero-length resource', () => {
    expect(parseRange('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' });
  });
});

describe('formatContentRange', () => {
  it('formats a Content-Range value', () => {
    expect(formatContentRange(0, 99, 1000)).toBe('bytes 0-99/1000');
  });
});
