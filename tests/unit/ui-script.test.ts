import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { renderBundlePage } from '../../src/ui/pages/bundle.js';
import { renderExtractPage } from '../../src/ui/pages/extract.js';
import { renderHomePage } from '../../src/ui/pages/home.js';
import { renderNotFoundPage } from '../../src/ui/pages/not-found.js';
import { renderPlayerPage } from '../../src/ui/player.js';

/**
 * The browser UI is authored as one large TypeScript template literal, which
 * makes it silently vulnerable to escape sequences: a `\n` written inside the
 * embedded script is consumed by the *outer* literal and emitted as a real
 * newline, leaving an unterminated string. That is a `SyntaxError`, and because
 * the whole UI is a single IIFE it takes every event handler on the page down
 * with it — the markup still looks perfect, so grepping the HTML proves nothing.
 *
 * These tests actually parse what we emit.
 */

/** Every inline `<script>` body in the rendered page. */
function scriptBlocks(html: string): string[] {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? '');
}

function expectParses(html: string, label: string): void {
  const blocks = scriptBlocks(html);
  expect(blocks.length, `${label}: expected inline scripts`).toBeGreaterThan(0);
  blocks.forEach((code, index) => {
    // Compile without executing: a SyntaxError here is exactly the failure the
    // browser would hit, and it takes the whole IIFE down.
    expect(
      () => new Script(code),
      `${label}: script block ${String(index)} must parse`,
    ).not.toThrow();
  });
}

describe('rendered UI scripts are syntactically valid', () => {
  it('parses the extract page in multi-archive mode', () => {
    expectParses(renderExtractPage({ mode: 'multi', prefix: '__', open: true }), 'extract/multi');
  });

  it('parses the extract page in single-archive mode', () => {
    expectParses(renderExtractPage({ mode: 'single', prefix: '__', open: false }), 'extract/single');
  });

  it('parses the bundle page', () => {
    expectParses(renderBundlePage({ prefix: '__' }), 'bundle');
  });

  it('parses the static pages', () => {
    expectParses(renderHomePage(), 'home');
    expectParses(renderNotFoundPage(), 'not-found');
  });

  it('parses the player page, with and without subtitles', () => {
    const base = {
      name: 'Movie.mkv',
      path: 'dir/Movie.mkv',
      mediaUrl: '/dir/Movie.mkv?inline',
      backUrl: '/',
      kind: 'video' as const,
      size: 1024,
      stored: true,
      native: false,
    };
    expectParses(renderPlayerPage({ ...base, subtitles: [], subtitleUrls: [] }), 'player/plain');
    expectParses(
      renderPlayerPage({
        ...base,
        subtitles: [{ path: 'dir/Movie.en.srt', label: 'en', language: 'en' }],
        subtitleUrls: ['/__/subtitle/dir/Movie.en.srt'],
      }),
      'player/subtitled',
    );
  });

  it('emits no stray raw newline inside a single-quoted string', () => {
    // The exact shape of the bug this suite exists for.
    const html = renderExtractPage({ mode: 'multi', prefix: '__', open: true });
    for (const code of scriptBlocks(html)) {
      expect(code).not.toMatch(/'[^'\n]*\n[^'\n]*'\s*\)/);
    }
  });
});
