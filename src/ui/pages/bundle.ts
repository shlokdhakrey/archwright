import { iconArrow, iconBundle, iconCheck, iconDownload, iconLink } from '../icons.js';
import { renderPage } from '../layout.js';

/**
 * The bundle page: many links in, one archive out.
 *
 * Two formats are offered, and they are not equivalent, so the page does not
 * present them as an idle toggle. TAR is ready the moment the list is accepted;
 * ZIP needs a short one-time pass over the files first. Rather than hide that
 * behind a spinner, the ZIP control states plainly what it is about to do and
 * shows progress while it does it — the difference is explained in terms of the
 * wait, not the mechanism.
 */

export interface BundleConfig {
  readonly prefix: string;
}

const CSS = `
.tool-head { padding: 44px 0 8px; }
.tool-head h1 { font-size: clamp(32px, 4.6vw, 44px); margin-bottom: 12px; }

.composer { margin-top: 26px; padding: 22px; display: grid; gap: 14px; }
.composer .meta { display: flex; gap: 12px; }
.composer .meta .field { max-width: 280px; }
@media (max-width: 640px) { .composer .meta { flex-direction: column; }
  .composer .meta .field { max-width: none; } }

.msg { margin-top: 18px; padding: 15px 18px; border-radius: var(--r-md);
  background: var(--sunk); box-shadow: var(--carve-sm); font-size: 15px; }
.msg-error { color: var(--danger); }

.built { margin-top: 34px; display: grid; gap: 18px; }
.built-head { display: flex; align-items: baseline; justify-content: space-between;
  gap: 14px; flex-wrap: wrap; }

.manifest { padding: 8px; }
.item { display: grid; grid-template-columns: 1fr auto; gap: 14px;
  align-items: center; padding: 11px 14px; border-radius: var(--r-md); }
.item + .item { box-shadow: inset 0 1px 0 var(--edge); }
.item .n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.item .s { font-size: 13px; color: var(--ink-faint);
  font-family: "IBM Plex Mono", ui-monospace, monospace; }

.formats { display: grid; gap: 14px; }
@media (min-width: 760px) { .formats { grid-template-columns: 1fr 1fr; } }
.format { padding: 22px; display: grid; gap: 12px; align-content: start; }
.format-top { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.format h3 { font-size: 19px; }
.format p { font-size: 14.5px; color: var(--ink-soft); }
.format .btn { justify-self: start; }

.bar { height: 7px; border-radius: 999px; background: var(--sunk);
  box-shadow: var(--carve-sm); overflow: hidden; }
.bar > i { display: block; height: 100%; width: 0; background: var(--accent);
  transition: width 320ms ease; }

.linkrow { display: flex; align-items: center; gap: 9px; font-size: 14px;
  color: var(--ink-soft); background: var(--sunk); box-shadow: var(--carve-sm);
  padding: 10px 14px; border-radius: var(--r-md); }
.linkrow code { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.linkrow button { border: 0; background: none; color: var(--accent); cursor: pointer;
  font: inherit; font-size: 13px; padding: 0; }
`;

/** Client script — no escape sequences, for the reason given in extract.ts. */
const SCRIPT = [
  '(function () {',
  'var AW = window.AW;',
  "var $ = function (id) { return document.getElementById(id); };",
  'var NEWLINE = String.fromCharCode(10);',
  'var bundle = null;',

  'function human(n) {',
  "  if (n < 1024) { return n + ' B'; }",
  "  var u = ['KB', 'MB', 'GB', 'TB'], i = -1;",
  '  do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);',
  "  return n.toFixed(1) + ' ' + u[i];",
  '}',
  'function say(text, bad) {',
  "  var m = $('msg');",
  "  if (!text) { m.className = 'msg hidden'; return; }",
  "  m.textContent = text; m.className = 'msg' + (bad ? ' msg-error' : '');",
  '}',

  // --- create -----------------------------------------------------------
  'function create() {',
  "  var raw = $('urls').value.split(NEWLINE);",
  '  var urls = [];',
  '  raw.forEach(function (line) {',
  '    var t = line.trim();',
  '    if (t) { urls.push(t); }',
  '  });',
  "  if (!urls.length) { say('Add at least one link.', true); return; }",
  '  say(0);',
  "  $('make').disabled = true;",
  "  $('make').textContent = 'Building';",
  "  fetch('/' + AW.prefix + '/bundle', {",
  "    method: 'POST', headers: { 'content-type': 'application/json' },",
  '    body: JSON.stringify({',
  '      files: urls.map(function (u) { return { url: u }; }),',
  "      name: $('bname').value",
  '    })',
  '  }).then(function (r) {',
  '    return r.json().then(function (b) {',
  "      if (!r.ok) { throw new Error((b && b.error && b.error.message) || ('HTTP ' + r.status)); }",
  '      return b;',
  '    });',
  '  }).then(show)',
  "   .catch(function (e) { say('Could not build that archive. ' + e.message, true); })",
  '   .finally(function () {',
  "     $('make').disabled = false;",
  "     $('make').textContent = 'Build archive';",
  '   });',
  '}',

  // --- render -----------------------------------------------------------
  'function show(data) {',
  '  bundle = data;',
  "  var list = $('manifest');",
  "  list.textContent = '';",
  '  data.files.forEach(function (f) {',
  "    var row = document.createElement('div');",
  "    row.className = 'item';",
  "    var n = document.createElement('span');",
  "    n.className = 'n';",
  '    n.textContent = f.name;',
  "    var s = document.createElement('span');",
  "    s.className = 's';",
  '    s.textContent = human(f.size);',
  '    row.appendChild(n); row.appendChild(s);',
  '    list.appendChild(row);',
  '  });',
  "  $('summary').textContent = data.files.length +",
  "    (data.files.length === 1 ? ' file · ' : ' files · ') + human(data.totalBytes);",
  "  $('tar-link').href = data.tar;",
  "  $('share').textContent = location.origin + data.tar;",
  "  $('built').className = 'built';",
  '  paintZip();',
  '}',

  'function paintZip() {',
  "  var btn = $('zip-go');",
  "  var note = $('zip-note');",
  '  if (bundle.zipReady) {',
  "    btn.textContent = 'Download .zip';",
  "    btn.className = 'btn btn-primary';",
  "    note.textContent = 'Ready to download.';",
  '  } else {',
  "    btn.textContent = 'Prepare and download';",
  "    btn.className = 'btn';",
  "    note.textContent = 'Needs a short one-time pass over ' + human(bundle.crcRemaining) +",
  "      ' before it can be built. You only wait for this once.';",
  '  }',
  '}',

  // --- prepare ----------------------------------------------------------
  'function prepare() {',
  '  if (!bundle) { return; }',
  '  if (bundle.zipReady) { window.location.href = bundle.zip; return; }',
  "  var btn = $('zip-go');",
  '  btn.disabled = true;',
  "  $('zip-bar').className = 'bar';",
  '  var total = bundle.totalBytes || 1;',
  '  function step() {',
  "    fetch('/' + AW.prefix + '/bundle/' + bundle.code + '/prepare', { method: 'POST' })",
  '      .then(function (r) {',
  '        return r.json().then(function (b) {',
  "          if (!r.ok) { throw new Error((b && b.error && b.error.message) || ('HTTP ' + r.status)); }",
  '          return b;',
  '        });',
  '      })',
  '      .then(function (d) {',
  '        bundle = d;',
  '        var pct = Math.round(((total - d.crcRemaining) / total) * 100);',
  "        $('zip-fill').style.width = pct + '%';",
  "        $('zip-note').textContent = 'Preparing — ' + pct + '%';",
  '        if (d.complete) {',
  '          btn.disabled = false;',
  "          $('zip-bar').className = 'bar hidden';",
  '          paintZip();',
  '          window.location.href = bundle.zip;',
  '        } else { step(); }',
  '      })',
  '      .catch(function (e) {',
  '        btn.disabled = false;',
  "        $('zip-bar').className = 'bar hidden';",
  "        say('Could not prepare the .zip. ' + e.message, true);",
  '      });',
  '  }',
  '  step();',
  '}',

  // --- events -----------------------------------------------------------
  "$('make').addEventListener('click', create);",
  "$('zip-go').addEventListener('click', prepare);",
  "$('copy-share').addEventListener('click', function () {",
  '  var btn = this;',
  "  var url = $('share').textContent;",
  "  var done = function () { btn.textContent = 'Copied';",
  "    setTimeout(function () { btn.textContent = 'Copy'; }, 1500); };",
  '  if (navigator.clipboard) { navigator.clipboard.writeText(url).then(done, done); } else { done(); }',
  '});',
  '})();',
].join('\n');

export function renderBundlePage(config: BundleConfig): string {
  const injected = JSON.stringify({ prefix: config.prefix });

  const body = `
<section class="shell narrow tool-head">
  <p class="eyebrow">Build an archive</p>
  <h1>Gather scattered files into one download</h1>
  <p class="lede">Paste the links, get one archive back. The files stay where they are until somebody
  downloads them, so nothing is copied or stored along the way.</p>
</section>

<section class="shell narrow">
  <div class="composer raised">
    <textarea class="field" id="urls" rows="7" spellcheck="false"
      aria-label="One file link per line"
      placeholder="https://example.com/episode-01.mkv&#10;https://example.com/episode-02.mkv&#10;one link per line"></textarea>
    <div class="meta">
      <input class="field" type="text" id="bname" autocomplete="off"
        placeholder="Archive name (optional)" aria-label="Archive name" />
      <button class="btn btn-primary" id="make" type="button">${iconBundle(18)} Build archive</button>
    </div>
  </div>

  <div class="msg hidden" id="msg" role="status"></div>

  <div class="built hidden" id="built">
    <div class="built-head">
      <h2 style="font-size:22px">Your archive</h2>
      <span class="faint" id="summary"></span>
    </div>

    <div class="linkrow">${iconLink(15)}
      <code id="share" class="grow"></code>
      <button type="button" id="copy-share">Copy</button>
    </div>

    <div class="manifest raised" id="manifest"></div>

    <div class="formats">
      <div class="format raised">
        <div class="format-top">
          <h3>TAR</h3>
          <span class="tag tag-good">${iconCheck(13)} Ready</span>
        </div>
        <p>Available immediately, at any size. Opens on macOS and Linux as-is, and on Windows with
        any common archiver.</p>
        <a class="btn btn-primary" id="tar-link" href="#" download>${iconDownload(16)} Download .tar</a>
      </div>

      <div class="format raised">
        <div class="format-top">
          <h3>ZIP</h3>
          <span class="tag">Opens anywhere</span>
        </div>
        <p id="zip-note"></p>
        <div class="bar hidden" id="zip-bar"><i id="zip-fill"></i></div>
        <button class="btn" id="zip-go" type="button">Prepare and download</button>
      </div>
    </div>

    <p class="faint">Both formats resume if the connection drops, and work with download managers.</p>
  </div>

  <p class="faint" style="margin-top:28px">
    Have an archive already? <a href="/extract">Open it and take files out ${iconArrow(14)}</a>
  </p>
</section>
`;

  return renderPage({
    title: 'Build an archive',
    description: 'Paste a list of links and get back one archive.',
    active: 'bundle',
    css: CSS,
    body,
    script: `window.AW = ${injected};` + SCRIPT,
  });
}
