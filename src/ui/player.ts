import { SERVICE_NAME } from '../constants/app.js';
import type { SubtitleTrack } from '../http/media.js';

/** Everything the player page needs, resolved by the handler. */
export interface PlayerConfig {
  readonly name: string;
  /** Entry path inside the archive (for display). */
  readonly path: string;
  /** URL that streams the media itself. */
  readonly mediaUrl: string;
  /** Where the “back to files” link goes. */
  readonly backUrl: string;
  readonly kind: 'video' | 'audio';
  readonly size: number;
  readonly stored: boolean;
  readonly native: boolean;
  readonly subtitles: readonly SubtitleTrack[];
  /** Subtitle URLs, parallel to `subtitles`. */
  readonly subtitleUrls: readonly string[];
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes;
  let index = -1;
  do {
    value /= 1024;
    index++;
  } while (value >= 1024 && index < units.length - 1);
  return `${value.toFixed(1)} ${units[index] ?? 'B'}`;
}

/**
 * Render the playback page for one entry.
 *
 * The media element points straight at the entry's download URL, so the browser
 * drives playback with ordinary `Range` requests — the Worker never buffers or
 * transcodes. Seeking a STORED entry therefore costs one small origin read.
 *
 * The page is honest about the two things that decide whether this works: the
 * container (Matroska and friends are not decodable in-browser, though they play
 * fine in VLC/mpv/Infuse from the same URL) and the storage method (a DEFLATE
 * entry must inflate from the start to reach an offset, so deep seeks are slow).
 */
export function renderPlayerPage(config: PlayerConfig): string {
  const title = escapeHtml(config.name);
  const isVideo = config.kind === 'video';

  const tracks = config.subtitles
    .map((track, index) => {
      const url = config.subtitleUrls[index];
      if (url === undefined) return '';
      return (
        `<track kind="subtitles" src="${escapeHtml(url)}" label="${escapeHtml(track.label)}"` +
        (track.language ? ` srclang="${escapeHtml(track.language)}"` : '') +
        (index === 0 ? ' default' : '') +
        ' />'
      );
    })
    .join('\n        ');

  const notice = config.native
    ? ''
    : `<div class="notice">
      <strong>This container may not play in your browser.</strong>
      <span>${escapeHtml(config.name.split('.').pop() ?? '')} files (Matroska, AVI and similar) are not decoded natively by
      browsers, even when the video inside is H.264. The stream itself is fine — open the URL below
      in VLC, mpv, IINA or Infuse and it will play, with full seeking.</span>
    </div>`;

  const seekNote = config.stored
    ? '<span class="chip chip-good">Instant seeking</span>'
    : '<span class="chip chip-warn">Slow seeking — compressed entry</span>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — ${SERVICE_NAME}</title>
<style>
  :root {
    --bg: #0b0d0f; --panel: #14181b; --text: #e9edef; --muted: #9aa5ac;
    --line: #242b30; --accent: #5fbfa6; --danger: #f2836b;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.6 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 20px 20px 64px; }
  header { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
  a.back { color: var(--muted); text-decoration: none; font-size: 14px; white-space: nowrap; }
  a.back:hover { color: var(--text); }
  h1 { font-size: 17px; font-weight: 600; margin: 0; word-break: break-all; letter-spacing: -.01em; }
  .stage { background: #000; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }
  video, audio { display: block; width: 100%; max-height: 74vh; background: #000; }
  audio { max-height: none; padding: 22px; background: var(--panel); }
  .meta { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; align-items: center; }
  .chip {
    font-size: 12px; padding: 4px 9px; border-radius: 999px;
    border: 1px solid var(--line); color: var(--muted); white-space: nowrap;
  }
  .chip-good { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 40%, transparent); }
  .chip-warn { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, transparent); }
  .notice {
    margin-top: 16px; padding: 14px 16px; border-radius: 8px;
    border: 1px solid color-mix(in srgb, var(--danger) 35%, transparent);
    background: color-mix(in srgb, var(--danger) 8%, transparent);
    display: grid; gap: 6px; font-size: 14px;
  }
  .notice strong { font-weight: 600; }
  .notice span { color: var(--muted); }
  .urlbar { display: flex; gap: 8px; margin-top: 16px; }
  .urlbar input {
    flex: 1; min-width: 0; padding: 9px 11px; border-radius: 8px;
    border: 1px solid var(--line); background: var(--panel); color: var(--text);
    font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  button {
    font: inherit; font-size: 14px; cursor: pointer; white-space: nowrap;
    padding: 9px 14px; border-radius: 8px; border: 1px solid var(--line);
    background: var(--panel); color: var(--text);
  }
  button:hover { border-color: var(--accent); color: var(--accent); }
  .hint { color: var(--muted); font-size: 13px; margin-top: 10px; }
  a { color: var(--accent); }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <a class="back" href="${escapeHtml(config.backUrl)}">← All files</a>
    <h1>${title}</h1>
  </header>

  <div class="stage">
    ${
      isVideo
        ? `<video id="player" controls autoplay playsinline preload="metadata" src="${escapeHtml(config.mediaUrl)}">
        ${tracks}
      </video>`
        : `<audio id="player" controls autoplay preload="metadata" src="${escapeHtml(config.mediaUrl)}">
        ${tracks}
      </audio>`
    }
  </div>

  <div class="meta">
    <span class="chip">${escapeHtml(humanSize(config.size))}</span>
    <span class="chip">${config.stored ? 'stored' : 'deflate'}</span>
    ${seekNote}
    ${config.subtitles.length > 0 ? `<span class="chip chip-good">${String(config.subtitles.length)} subtitle track${config.subtitles.length === 1 ? '' : 's'}</span>` : ''}
    <span class="chip">streamed from inside the archive</span>
  </div>

  ${notice}

  <div class="urlbar">
    <input id="url" readonly value="" aria-label="Direct stream URL" />
    <button id="copy">Copy stream URL</button>
  </div>
  <p class="hint" id="hint">Paste this into VLC (<em>File → Open Network Stream</em>), mpv, IINA or Infuse to play it there — nothing is downloaded up front, and seeking works the same way.</p>
</div>

<script>
(function () {
  var absolute = new URL(${JSON.stringify(config.mediaUrl)}, location.href).href;
  var field = document.getElementById('url');
  field.value = absolute;

  document.getElementById('copy').addEventListener('click', function () {
    var button = this;
    var done = function () {
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = 'Copy stream URL'; }, 1600);
    };
    if (navigator.clipboard) {
      navigator.clipboard.writeText(absolute).then(done, function () { field.select(); });
    } else {
      field.select();
      done();
    }
  });

  // If the browser cannot decode the container it fails silently on some
  // platforms; surface that instead of leaving a black rectangle.
  var player = document.getElementById('player');
  player.addEventListener('error', function () {
    var hint = document.getElementById('hint');
    hint.innerHTML = '<strong>Your browser could not decode this file.</strong> '
      + 'The stream is fine — copy the URL above and open it in VLC, mpv, IINA or Infuse.';
  });
})();
</script>
</body>
</html>`;
}
