import { iconArrow, iconDownload, iconExtract, iconLink, iconPlay } from '../icons.js';
import { renderPage } from '../layout.js';

/**
 * The extract page: open an archive and take things out of it.
 *
 * The shape of the task drives the layout. Everything begins with one URL, so
 * the page starts as a single field and nothing else; the listing, the filter
 * and the selection bar only appear once there is something to act on. That
 * keeps the empty state honest instead of showing a scaffold of dead controls.
 *
 * The selection bar separates two genuinely different actions that had been
 * reading as one menu: taking the files *separately*, and combining them into a
 * single archive (where the format is the only remaining choice).
 */

export interface ExtractConfig {
  readonly mode: 'single' | 'multi';
  readonly prefix: string;
  readonly open: boolean;
}

const CSS = `
.tool-head { padding: 44px 0 8px; }
.tool-head h1 { font-size: clamp(32px, 4.6vw, 44px); margin-bottom: 12px; }

.opener { margin-top: 26px; padding: 22px; }
.opener-row { display: flex; gap: 12px; align-items: stretch; }
.opener-row .field { font-size: 15px; }
@media (max-width: 640px) { .opener-row { flex-direction: column; } }

.msg { margin-top: 18px; padding: 15px 18px; border-radius: var(--r-md);
  background: var(--sunk); box-shadow: var(--carve-sm); font-size: 15px; }
.msg-error { color: var(--danger); }

.result { margin-top: 34px; }
.result-top { display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-wrap: wrap; margin-bottom: 14px; }
.permalink { display: inline-flex; align-items: center; gap: 9px; font-size: 14px;
  color: var(--ink-soft); background: var(--sunk); box-shadow: var(--carve-sm);
  padding: 9px 14px; border-radius: var(--r-md); max-width: 100%; }
.permalink code { color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.permalink button { border: 0; background: none; color: var(--accent); cursor: pointer;
  font: inherit; font-size: 13px; padding: 0; }

.filter { max-width: 300px; }

.files { margin-top: 14px; padding: 8px; }
.file {
  display: grid; grid-template-columns: 24px 1fr auto; gap: 14px;
  align-items: center; padding: 12px 14px; border-radius: var(--r-md);
}
.file + .file { box-shadow: inset 0 1px 0 var(--edge); }
.file:hover { background: var(--sunk); }
.file-name { min-width: 0; }
.file-name .n { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-name .d { font-size: 12.5px; color: var(--ink-faint);
  font-family: "IBM Plex Mono", ui-monospace, monospace; }
.file-acts { display: flex; gap: 6px; }
.file a.act { display: inline-flex; align-items: center; gap: 6px; font-size: 13.5px;
  padding: 7px 11px; border-radius: var(--r-sm); color: var(--ink-soft); }
.file a.act:hover { color: var(--accent); box-shadow: var(--lift-sm); text-decoration: none; }
input[type=checkbox] { width: 17px; height: 17px; accent-color: var(--accent); cursor: pointer; }

.empty { padding: 40px 24px; text-align: center; color: var(--ink-soft); }

.selbar {
  position: sticky; bottom: 16px; margin-top: 18px;
  padding: 13px 16px; display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
}
.selbar .count { font-weight: 500; margin-right: auto; font-size: 14.5px; }
.selbar .divider { width: 1px; align-self: stretch; background: var(--edge); }
.selbar .label { font-size: 14px; color: var(--ink-soft); }
`;

/**
 * Client script.
 *
 * Written with **no escape sequences**: the page is emitted from a template
 * literal, so a backslash-n here would be consumed by it and leave an
 * unterminated string, which takes the whole script down. Rows are built with
 * DOM calls rather than concatenated HTML for the same reason — and because it
 * makes the file names injection-proof.
 */
const SCRIPT = [
  '(function () {',
  'var AW = window.AW;',
  "var $ = function (id) { return document.getElementById(id); };",
  'var entries = [];',
  'var selected = new Set();',
  "var code = '';",
  "var ref = '';",

  // --- addressing -------------------------------------------------------
  'function b64url(str) {',
  "  var bytes = new TextEncoder().encode(str), bin = '';",
  '  for (var i = 0; i < bytes.length; i++) { bin += String.fromCharCode(bytes[i]); }',
  "  return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');",
  '}',
  "function listBase() { return AW.mode === 'single' ? '' : (code ? '/zfile/' + code : '/a/' + ref); }",
  "function fileBase() { return AW.mode === 'single' ? '' : (code ? '/sfile/' + code : '/a/' + ref); }",
  "function encodePath(name) { return name.split('/').map(encodeURIComponent).join('/'); }",
  "function downloadUrl(name) { return fileBase() + '/' + encodePath(name); }",
  "function playUrl(name) { return listBase() + '/' + AW.prefix + '/play/' + encodePath(name); }",
  "function listUrl() { return listBase() + '/' + AW.prefix + '/list?limit=10000'; }",

  'function shorten(url) {',
  "  return fetch('/' + AW.prefix + '/shorten', {",
  "    method: 'POST', headers: { 'content-type': 'application/json' },",
  '    body: JSON.stringify({ url: url })',
  '  }).then(function (r) { return r.ok ? r.json() : null; })',
  "   .then(function (d) { return (d && d.code) ? d.code : ''; })",
  "   .catch(function () { return ''; });",
  '}',

  // --- helpers ----------------------------------------------------------
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
  'function busy(on) {',
  "  $('load').disabled = on;",
  "  $('load').textContent = on ? 'Opening' : 'Open';",
  '}',

  // --- loading ----------------------------------------------------------
  'function openArchive() {',
  "  if (AW.mode === 'single') { load(); return; }",
  "  var url = $('url').value.trim();",
  "  if (!url) { say('Paste a link to an archive first.', true); return; }",
  "  try { new URL(url); } catch (e) { say('That is not a valid link.', true); return; }",
  "  ref = b64url(url); code = '';",
  '  say(0); busy(true);',
  '  shorten(url).then(function (c) { code = c; load(); });',
  '}',

  'function load() {',
  '  say(0); busy(true);',
  "  $('result').className = 'result hidden';",
  '  fetch(listUrl())',
  '    .then(function (r) {',
  '      return r.json().then(function (b) {',
  "        if (!r.ok) { throw new Error((b && b.error && b.error.message) || ('HTTP ' + r.status)); }",
  '        return b;',
  '      });',
  '    })',
  '    .then(function (body) {',
  '      entries = (body.entries || []).filter(function (e) { return !e.directory; });',
  '      selected = new Set();',
  '      render();',
  "      $('result').className = 'result';",
  "      if (!entries.length) { say('This archive has no downloadable files.', false); }",
  '    })',
  "    .catch(function (e) { say('Could not open that archive. ' + e.message, true); })",
  '    .finally(function () { busy(false); });',
  '}',

  // --- rendering --------------------------------------------------------
  'function action(html, label, href) {',
  "  var a = document.createElement('a');",
  "  a.className = 'act';",
  '  a.innerHTML = html;',
  "  a.appendChild(document.createTextNode(' ' + label));",
  '  a.href = href;',
  '  return a;',
  '}',

  'function render() {',
  "  var q = ($('filter').value || '').toLowerCase();",
  "  var list = $('files');",
  "  list.textContent = '';",
  '  var shown = 0;',
  '  entries.forEach(function (e, i) {',
  '    if (q && e.name.toLowerCase().indexOf(q) === -1) { return; }',
  '    shown++;',
  "    var type = e.contentType || '';",
  "    var playable = type.indexOf('video/') === 0 || type.indexOf('audio/') === 0;",

  "    var row = document.createElement('div');",
  "    row.className = 'file';",

  "    var box = document.createElement('input');",
  "    box.type = 'checkbox';",
  "    box.setAttribute('data-i', String(i));",
  "    box.setAttribute('aria-label', 'Select ' + e.name);",
  '    box.checked = selected.has(i);',
  '    row.appendChild(box);',

  "    var cell = document.createElement('div');",
  "    cell.className = 'file-name';",
  "    var nameEl = document.createElement('span');",
  "    nameEl.className = 'n';",
  '    nameEl.textContent = e.name;',
  "    var sizeEl = document.createElement('span');",
  "    sizeEl.className = 'd';",
  '    sizeEl.textContent = human(e.size);',
  '    cell.appendChild(nameEl); cell.appendChild(sizeEl);',
  '    row.appendChild(cell);',

  "    var acts = document.createElement('div');",
  "    acts.className = 'file-acts';",
  "    if (playable) { acts.appendChild(action(AW.icons.play, 'Play', playUrl(e.name))); }",
  "    var save = action(AW.icons.download, 'Download', downloadUrl(e.name));",
  "    save.setAttribute('download', e.name.split('/').pop());",
  '    acts.appendChild(save);',
  '    row.appendChild(acts);',

  '    list.appendChild(row);',
  '  });',

  '  if (!shown) {',
  "    var empty = document.createElement('div');",
  "    empty.className = 'empty';",
  "    empty.textContent = entries.length ? 'Nothing matches that filter.' : 'This archive is empty.';",
  '    list.appendChild(empty);',
  '  }',
  "  $('count').textContent = entries.length + (entries.length === 1 ? ' file' : ' files');",
  '  permalink();',
  '  updateBar();',
  '}',

  'function permalink() {',
  "  var el = $('permalink');",
  "  if (AW.mode === 'single' || !code) { el.className = 'permalink hidden'; return; }",
  "  el.className = 'permalink';",
  "  $('permalink-url').textContent = location.origin + '/zfile/' + code;",
  '}',

  'function updateBar() {',
  "  var bar = $('selbar');",
  '  var n = selected.size;',
  "  if (!n) { bar.className = 'selbar raised hidden'; return; }",
  "  bar.className = 'selbar raised';",
  '  var total = 0;',
  '  selected.forEach(function (i) { total += entries[i].size; });',
  "  $('selcount').textContent = n + (n === 1 ? ' file' : ' files') + ' selected · ' + human(total);",
  '}',

  'function names() {',
  '  var out = [];',
  '  selected.forEach(function (i) { out.push(entries[i].name); });',
  '  return out;',
  '}',
  'function combined(kind) {',
  "  var q = names().map(function (n) { return 'path=' + encodeURIComponent(n); });",
  "  q.push('name=selection');",
  "  return listBase() + '/' + AW.prefix + '/' + kind + '?' + q.join('&');",
  '}',

  // --- events -----------------------------------------------------------
  "document.addEventListener('change', function (ev) {",
  '  var t = ev.target;',
  "  if (t.id === 'all') {",
  '    selected = new Set();',
  '    if (t.checked) { entries.forEach(function (_, i) { selected.add(i); }); }',
  '    render();',
  '  } else if (t.dataset && t.dataset.i !== undefined) {',
  '    var i = Number(t.dataset.i);',
  '    if (t.checked) { selected.add(i); } else { selected.delete(i); }',
  '    updateBar();',
  '  }',
  '});',

  "$('load').addEventListener('click', openArchive);",
  "$('url').addEventListener('keydown', function (e) { if (e.key === 'Enter') { openArchive(); } });",
  "$('filter').addEventListener('input', render);",

  "$('each').addEventListener('click', function () {",
  '  names().forEach(function (name, k) {',
  '    setTimeout(function () {',
  "      var a = document.createElement('a');",
  "      a.href = downloadUrl(name); a.download = name.split('/').pop();",
  '      document.body.appendChild(a); a.click(); a.remove();',
  '    }, k * 400);',
  '  });',
  '});',
  "$('as-zip').addEventListener('click', function () {",
  "  if (selected.size) { window.location.href = combined('zip'); }",
  '});',
  "$('as-tar').addEventListener('click', function () {",
  "  if (selected.size) { window.location.href = combined('tar'); }",
  '});',
  "$('copy-link').addEventListener('click', function () {",
  '  var btn = this;',
  "  var url = $('permalink-url').textContent;",
  "  var done = function () { btn.textContent = 'Copied';",
  "    setTimeout(function () { btn.textContent = 'Copy'; }, 1500); };",
  '  if (navigator.clipboard) { navigator.clipboard.writeText(url).then(done, done); } else { done(); }',
  '});',

  // --- entry ------------------------------------------------------------
  "if (AW.mode === 'single') {",
  "  $('opener').className = 'opener raised hidden';",
  '  load();',
  '} else {',
  "  var parts = location.pathname.split('/').filter(Boolean);",
  "  if (parts.length === 2 && (parts[0] === 'zfile' || parts[0] === 'sfile')) {",
  "    code = parts[1]; ref = '';",
  '    load();',
  "  } else if (parts.length === 2 && parts[0] === 'a') {",
  "    ref = parts[1]; code = '';",
  '    load();',
  '  }',
  '}',
  '})();',
].join('\n');

export function renderExtractPage(config: ExtractConfig): string {
  const injected = JSON.stringify({
    mode: config.mode,
    prefix: config.prefix,
    open: config.open,
    icons: { play: iconPlay(15), download: iconDownload(15) },
  });

  const body = `
<section class="shell narrow tool-head">
  <p class="eyebrow">Open an archive</p>
  <h1>Take what you need out of a ZIP</h1>
  <p class="lede">Paste a link to an archive and read what is inside it straight away. Download one
  file or several — the rest is never fetched.</p>
</section>

<section class="shell narrow">
  <div class="opener raised" id="opener">
    <div class="opener-row">
      <input class="field" type="url" id="url" autocomplete="off" spellcheck="false"
        placeholder="https://example.com/archive.zip" aria-label="Link to an archive" />
      <button class="btn btn-primary" id="load" type="button">${iconExtract(18)} Open</button>
    </div>
  </div>

  <div class="msg hidden" id="msg" role="status"></div>

  <div class="result hidden" id="result">
    <div class="result-top">
      <div class="row">
        <strong id="count"></strong>
        <span class="permalink hidden" id="permalink">${iconLink(15)}
          <code id="permalink-url"></code>
          <button type="button" id="copy-link">Copy</button>
        </span>
      </div>
      <input class="field filter" type="search" id="filter" placeholder="Filter by name"
        aria-label="Filter files by name" />
    </div>

    <label class="row" style="gap:10px; font-size:14px; color:var(--ink-soft); padding-left:14px">
      <input type="checkbox" id="all" /> Select all
    </label>

    <div class="files raised" id="files"></div>

    <div class="selbar raised hidden" id="selbar">
      <span class="count" id="selcount"></span>
      <button class="btn btn-sm" id="each" type="button">${iconDownload(15)} Download separately</button>
      <span class="divider"></span>
      <span class="label">Combine as</span>
      <button class="btn btn-sm btn-primary" id="as-zip" type="button">ZIP</button>
      <button class="btn btn-sm" id="as-tar" type="button">TAR</button>
    </div>
  </div>

  <p class="faint" style="margin-top:28px">
    Going the other way? <a href="/bundle">Build an archive from several links ${iconArrow(14)}</a>
  </p>
</section>
`;

  return renderPage({
    title: 'Open an archive',
    description: 'Paste a link to a ZIP and take what you need out of it.',
    active: 'extract',
    css: CSS,
    body,
    script: `window.AW = ${injected};` + SCRIPT,
  });
}
