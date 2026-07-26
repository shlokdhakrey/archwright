import { SERVICE_NAME, VERSION } from '../constants/app.js';

/** Config injected into the page so the client knows how to build API URLs. */
export interface UiConfig {
  readonly mode: 'single' | 'multi';
  readonly prefix: string;
  readonly open: boolean;
}

/**
 * Render the single-page browser UI. It is fully self-contained (inline CSS +
 * vanilla JS, no dependencies, no external requests), served from `/` by the
 * Worker, and talks to the same-origin `list`/`zip`/download endpoints. The
 * embedded script uses string concatenation (not template literals) so this
 * outer template literal needs no escaping.
 */
export function renderAppPage(config: UiConfig): string {
  const configJson = JSON.stringify(config);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${SERVICE_NAME} — stream files from a remote ZIP</title>
<style>
  :root {
    --bg: #f7f8fa; --panel: #ffffff; --text: #1a1d21; --muted: #6b7280;
    --border: #e5e7eb; --accent: #2563eb; --accent-fg: #ffffff; --row-hover: #f2f5f9;
    --danger: #b91c1c;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0e1116; --panel: #161b22; --text: #e6edf3; --muted: #9aa4b2;
      --border: #2a313c; --accent: #3b82f6; --accent-fg: #ffffff; --row-hover: #1c232d;
      --danger: #f87171;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.5 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; }
  .wrap { max-width: 920px; margin: 0 auto; padding: 32px 20px 120px; }
  header h1 { margin: 0 0 4px; font-size: 22px; letter-spacing: -0.01em; }
  header p { margin: 0 0 24px; color: var(--muted); }
  header .v { font-size: 12px; color: var(--muted); }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 16px; }
  .loader { display: flex; gap: 8px; }
  input[type=url] { flex: 1; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg); color: var(--text); font-size: 14px; min-width: 0; }
  button { font: inherit; cursor: pointer; border-radius: 8px; border: 1px solid var(--border);
    background: var(--panel); color: var(--text); padding: 10px 14px; }
  button.primary { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .hint { color: var(--muted); font-size: 13px; margin-top: 8px; }
  .msg { margin-top: 16px; padding: 12px 14px; border-radius: 8px; border: 1px solid var(--border); }
  .msg.error { color: var(--danger); border-color: var(--danger); }
  .msg.hidden, .hidden { display: none; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); font-size: 14px; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
  td.size, td.type { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.name { word-break: break-all; }
  tr:hover td { background: var(--row-hover); }
  a.dl { color: var(--accent); text-decoration: none; font-size: 13px; }
  .bar { position: fixed; left: 0; right: 0; bottom: 0; background: var(--panel);
    border-top: 1px solid var(--border); padding: 12px 20px; display: flex; align-items: center;
    gap: 12px; justify-content: center; }
  .bar .info { color: var(--muted); font-size: 14px; margin-right: auto; }
  .bar-inner { max-width: 920px; width: 100%; margin: 0 auto; display: flex; align-items: center; gap: 12px; }
  .spinner { width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--accent);
    border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${SERVICE_NAME}</h1>
    <p>Stream individual files out of a remote ZIP — no extraction, no full download.</p>
  </header>

  <div class="panel">
    <div class="loader" id="loader">
      <input type="url" id="url" placeholder="https://example.com/archive.zip" autocomplete="off" spellcheck="false" />
      <button class="primary" id="load">Load files</button>
    </div>
    <div class="hint" id="hint"></div>
  </div>

  <div class="msg hidden" id="msg"></div>

  <div id="results" class="hidden">
    <p class="hint hidden" id="shortlink"></p>
    <table>
      <thead>
        <tr>
          <th style="width:28px"><input type="checkbox" id="all" /></th>
          <th>Name</th>
          <th style="width:120px">Size</th>
          <th style="width:120px">Type</th>
          <th style="width:80px"></th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <p class="hint" id="dlnote">Tip: download in your browser for best results — some download managers (IDM, 1DM…) can't open compressed files served straight from a ZIP.</p>
  </div>
</div>

<div class="bar hidden" id="bar">
  <div class="bar-inner">
    <span class="info" id="selinfo">0 selected</span>
    <button class="primary" id="each">Download each</button>
  </div>
</div>

<script>window.ZS = ${configJson};</script>
<script>
(function () {
  var ZS = window.ZS;
  var $ = function (id) { return document.getElementById(id); };
  var entries = [];
  var selected = new Set();
  var code = ''; // short code when shortening succeeded ('' otherwise)
  var ref = '';  // base64 fallback ref when shortening is unavailable

  function b64url(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');
  }
  // Browse/list via '/zfile/{code}', download via '/sfile/{code}/{file}'; both
  // fall back to the base64 '/a/{ref}' form when shortening is unavailable.
  function listBase() { return ZS.mode === 'single' ? '' : (code ? '/zfile/' + code : '/a/' + ref); }
  function fileBase() { return ZS.mode === 'single' ? '' : (code ? '/sfile/' + code : '/a/' + ref); }

  // Ask the server to store the URL and return its stable code; '' if disabled.
  function resolveCode(url) {
    return fetch('/' + ZS.prefix + '/shorten', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: url })
    }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { return (d && d.code) ? d.code : ''; })
      .catch(function () { return ''; });
  }
  function encodePath(name) { return name.split('/').map(encodeURIComponent).join('/'); }
  function downloadUrl(name) { return fileBase() + '/' + encodePath(name); }
  function listUrl() { return listBase() + '/' + ZS.prefix + '/list?limit=10000'; }
  function human(n) {
    if (n < 1024) return n + ' B';
    var u = ['KiB', 'MiB', 'GiB', 'TiB'], i = -1;
    do { n /= 1024; i++; } while (n >= 1024 && i < u.length - 1);
    return n.toFixed(1) + ' ' + u[i];
  }
  function showMsg(text, isError) {
    var m = $('msg'); m.textContent = text; m.className = 'msg' + (isError ? ' error' : '');
  }
  function hideMsg() { $('msg').className = 'msg hidden'; }

  function setLoading(on) {
    $('load').disabled = on;
    $('load').textContent = on ? 'Loading…' : 'Load files';
  }

  function load() {
    if (ZS.mode === 'single') { listFiles(); return; }
    var url = $('url').value.trim();
    if (!url) { showMsg('Paste a ZIP URL first.', true); return; }
    try { new URL(url); } catch (e) { showMsg('That is not a valid URL.', true); return; }
    ref = b64url(url); code = '';
    hideMsg(); setLoading(true); $('results').className = 'hidden';
    resolveCode(url).then(function (c) { code = c; listFiles(); });
  }

  function showShortLink() {
    var el = $('shortlink');
    if (ZS.mode !== 'single' && code) {
      el.textContent = 'Permanent link: ' + location.origin + '/zfile/' + code;
      el.className = 'hint';
    } else {
      el.className = 'hint hidden';
    }
  }

  function listFiles() {
    hideMsg(); setLoading(true); $('results').className = 'hidden';
    fetch(listUrl())
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw new Error((body && body.error && body.error.message) || ('HTTP ' + r.status));
          return body;
        });
      })
      .then(function (body) {
        entries = (body.entries || []).filter(function (e) { return !e.directory; });
        selected = new Set();
        render();
        showShortLink();
        if (entries.length === 0) showMsg('No downloadable files found in this archive.', false);
      })
      .catch(function (e) { showMsg('Could not load: ' + e.message, true); })
      .finally(function () { setLoading(false); });
  }

  function render() {
    var rows = $('rows'); rows.innerHTML = '';
    entries.forEach(function (e, i) {
      var tr = document.createElement('tr');
      tr.innerHTML =
        '<td><input type="checkbox" data-i="' + i + '"></td>' +
        '<td class="name"></td>' +
        '<td class="size">' + human(e.size) + '</td>' +
        '<td class="type">' + (e.method === 'stored' ? 'stored' : 'deflate') + '</td>' +
        '<td><a class="dl" download>Download</a></td>';
      tr.querySelector('.name').textContent = e.name;
      var a = tr.querySelector('a.dl');
      a.href = downloadUrl(e.name);
      a.setAttribute('download', e.name.split('/').pop());
      rows.appendChild(tr);
    });
    $('results').className = entries.length ? '' : 'hidden';
    $('all').checked = false;
    updateBar();
  }

  function updateBar() {
    var count = selected.size;
    var bar = $('bar');
    if (count === 0) { bar.className = 'bar hidden'; return; }
    bar.className = 'bar';
    var total = 0;
    selected.forEach(function (i) { total += entries[i].size; });
    $('selinfo').textContent = count + ' selected · ' + human(total);
  }

  function selectedNames() {
    var names = [];
    selected.forEach(function (i) { names.push(entries[i].name); });
    return names;
  }

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'all') {
      selected = new Set();
      if (t.checked) entries.forEach(function (_, i) { selected.add(i); });
      document.querySelectorAll('#rows input[type=checkbox]').forEach(function (c) { c.checked = t.checked; });
      updateBar();
    } else if (t.dataset && t.dataset.i !== undefined) {
      var i = Number(t.dataset.i);
      if (t.checked) selected.add(i); else selected.delete(i);
      updateBar();
    }
  });

  $('load').addEventListener('click', load);
  $('url').addEventListener('keydown', function (e) { if (e.key === 'Enter') load(); });

  $('each').addEventListener('click', function () {
    var names = selectedNames();
    names.forEach(function (name, k) {
      setTimeout(function () {
        var a = document.createElement('a');
        a.href = downloadUrl(name); a.download = name.split('/').pop();
        document.body.appendChild(a); a.click(); a.remove();
      }, k * 400);
    });
  });

  // Single-archive mode: no URL box, auto-load the configured archive.
  if (ZS.mode === 'single') {
    $('loader').className = 'loader hidden';
    $('hint').textContent = 'Serving the archive configured on this deployment.';
    listFiles();
  } else {
    // A shared archive link — '/zfile/{code}', '/sfile/{code}' or '/a/{ref}' —
    // auto-loads its files.
    var parts = location.pathname.split('/').filter(Boolean);
    if (parts.length === 2 && (parts[0] === 'zfile' || parts[0] === 'sfile')) {
      code = parts[1]; ref = '';
      $('hint').textContent = 'Loading shared archive…';
      listFiles();
    } else if (parts.length === 2 && parts[0] === 'a') {
      ref = parts[1]; code = '';
      $('hint').textContent = 'Loading shared archive…';
      listFiles();
    } else {
      $('hint').textContent = ZS.open
        ? 'Paste a link to any public .zip that supports HTTP range requests.'
        : 'This deployment only serves allowlisted or signed archives.';
    }
  }
})();
</script>
</body>
</html>`;
}

/** Exposed for a potential meta tag / diagnostics. */
export const UI_VERSION = VERSION;
