import { SERVICE_NAME, VERSION } from '../constants/app.js';
import { FAVICON_LINK } from './favicon.js';

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
${FAVICON_LINK}
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
  /* Utility: must beat any later component rule of equal specificity.
     The .bar display:flex rule below is declared later and used to win,
     which kept the action bar on screen even when marked hidden. */
  .msg.hidden, .hidden { display: none !important; }
  table { width: 100%; border-collapse: collapse; margin-top: 20px; }
  th, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--border); font-size: 14px; }
  th { color: var(--muted); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: 0.03em; }
  td.size, td.type { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
  td.name { word-break: break-all; }
  tr:hover td { background: var(--row-hover); }
  a.dl { color: var(--accent); text-decoration: none; font-size: 13px; }
  td.actions { display: flex; gap: 12px; }
  a.play::before { content: "▶"; font-size: 9px; margin-right: 4px; vertical-align: 1px; }
  .bar { position: fixed; left: 0; right: 0; bottom: 0; background: var(--panel);
    border-top: 1px solid var(--border); padding: 12px 20px; display: flex; align-items: center;
    gap: 12px; justify-content: center; }
  .bar .info { color: var(--muted); font-size: 14px; margin-right: auto; }
  .bar .sep { width: 1px; align-self: stretch; background: var(--border); margin: 0 4px; }
  .bar .barlabel { color: var(--muted); font-size: 13px; white-space: nowrap; }
  .bar-inner { max-width: 920px; width: 100%; margin: 0 auto; display: flex; align-items: center; gap: 12px; }
  .spinner { width: 16px; height: 16px; border: 2px solid var(--border); border-top-color: var(--accent);
    border-radius: 50%; animation: spin 0.7s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .tabs { display: flex; gap: 6px; margin-bottom: 16px; }
  .tab { background: transparent; border: 1px solid transparent; color: var(--muted); padding: 8px 14px; }
  .tab.active { background: var(--panel); border-color: var(--border); color: var(--text); font-weight: 600; }
  textarea { width: 100%; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--bg); color: var(--text); font: 13px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
    resize: vertical; }
  a.btn { display: inline-block; text-decoration: none; font: inherit; cursor: pointer;
    border-radius: 8px; border: 1px solid var(--border); padding: 10px 14px; color: var(--text); }
  a.btn.primary { background: var(--accent); color: var(--accent-fg); border-color: transparent; }
  a.btn.disabled { opacity: 0.5; pointer-events: none; }
  .progress { height: 6px; background: var(--border); border-radius: 3px; overflow: hidden; margin-top: 10px; }
  .progress > div { height: 100%; width: 0; background: var(--accent); transition: width 0.3s; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>${SERVICE_NAME}</h1>
    <p>Stream files out of a remote ZIP — or bundle many remote files into one archive.</p>
  </header>

  <div class="tabs">
    <button class="tab active" id="tab-open">Open a ZIP</button>
    <button class="tab" id="tab-bundle">Bundle files</button>
  </div>

  <div id="view-open">
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
          <th style="width:150px"></th>
        </tr>
      </thead>
      <tbody id="rows"></tbody>
    </table>
    <p class="hint" id="dlnote">Tip: download in your browser for best results — some download managers (IDM, 1DM…) can't open compressed files served straight from a ZIP.</p>
  </div>
  </div>

  <div id="view-bundle" class="hidden">
    <div class="panel">
      <textarea id="urls" rows="6" placeholder="https://example.com/one.mkv&#10;https://example.com/two.mkv&#10;one URL per line…" spellcheck="false"></textarea>
      <div class="loader" style="margin-top:10px">
        <input type="url" id="bname" placeholder="archive name (optional)" autocomplete="off" />
        <button class="primary" id="make">Create bundle</button>
      </div>
      <div class="hint">Direct links to any public files. They are streamed into one archive on demand — nothing is ever stored.</div>
    </div>

    <div class="msg hidden" id="bmsg"></div>

    <div id="bres" class="hidden">
      <p class="hint" id="blink"></p>
      <table>
        <thead><tr><th>Name</th><th style="width:120px">Size</th></tr></thead>
        <tbody id="brows"></tbody>
      </table>
      <div class="loader" style="margin-top:14px">
        <a class="btn primary" id="btar" download>Download .tar</a>
        <button id="bzip">Prepare .zip</button>
      </div>
      <div class="progress hidden" id="bprog"><div id="bbar"></div></div>
      <p class="hint" id="bnote"></p>
    </div>
  </div>
</div>

<div class="bar hidden" id="bar">
  <div class="bar-inner">
    <span class="info" id="selinfo">0 selected</span>
    <button id="each">Download separately</button>
    <span class="sep"></span>
    <span class="barlabel">Combine into one archive</span>
    <button class="primary" id="zip">ZIP</button>
    <button id="tar">TAR</button>
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
      // Audio and video can be played straight from inside the archive.
      var type = e.contentType || '';
      var playable = type.indexOf('video/') === 0 || type.indexOf('audio/') === 0;
      tr.innerHTML =
        '<td><input type="checkbox" data-i="' + i + '"></td>' +
        '<td class="name"></td>' +
        '<td class="size">' + human(e.size) + '</td>' +
        '<td class="type">' + (e.method === 'stored' ? 'stored' : 'deflate') + '</td>' +
        '<td class="actions">' +
          (playable ? '<a class="dl play">Play</a>' : '') +
          '<a class="dl save" download>Download</a>' +
        '</td>';
      tr.querySelector('.name').textContent = e.name;
      var save = tr.querySelector('a.save');
      save.href = downloadUrl(e.name);
      save.setAttribute('download', e.name.split('/').pop());
      var play = tr.querySelector('a.play');
      if (play) play.href = listBase() + '/' + ZS.prefix + '/play/' + encodePath(e.name);
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

  // Combined downloads. Both stream at any size: ZIP copies entries verbatim
  // (reusing their CRC-32s), TAR passes STORED entries straight through.
  function combinedUrl(kind, names, outName) {
    var q = names.map(function (n) { return 'path=' + encodeURIComponent(n); });
    q.push('name=' + encodeURIComponent(outName));
    return listBase() + '/' + ZS.prefix + '/' + kind + '?' + q.join('&');
  }

  $('zip').addEventListener('click', function () {
    var names = selectedNames();
    if (names.length) window.location.href = combinedUrl('zip', names, 'selection.zip');
  });

  $('tar').addEventListener('click', function () {
    var names = selectedNames();
    if (names.length) window.location.href = combinedUrl('tar', names, 'selection.tar');
  });

  // ---- Bundle mode: many remote files in, one archive out ----
  var bundle = null;

  function showTab(which) {
    var isOpen = which === 'open';
    $('view-open').className = isOpen ? '' : 'hidden';
    $('view-bundle').className = isOpen ? 'hidden' : '';
    $('tab-open').className = 'tab' + (isOpen ? ' active' : '');
    $('tab-bundle').className = 'tab' + (isOpen ? '' : ' active');
    if (!isOpen) $('bar').className = 'bar hidden'; else updateBar();
  }
  $('tab-open').addEventListener('click', function () { showTab('open'); });
  $('tab-bundle').addEventListener('click', function () { showTab('bundle'); });

  function bundleMsg(text, isError) {
    var m = $('bmsg');
    if (!text) { m.className = 'msg hidden'; return; }
    m.textContent = text; m.className = 'msg' + (isError ? ' error' : '');
  }

  function zipState() {
    var btn = $('bzip');
    if (bundle.zipReady) {
      btn.textContent = 'Download .zip';
      $('bnote').textContent = 'Both formats stream at any size, resume if the connection drops, '
        + 'and work with download managers. Nothing is stored on the server.';
    } else {
      btn.textContent = 'Prepare .zip';
      $('bnote').textContent = '.tar is ready now and has no size limit. .zip additionally needs a one-time '
        + 'checksum pass over ' + human(bundle.crcRemaining) + ' (ZIP stores a CRC per file; TAR does not).';
    }
  }

  function renderBundle(data) {
    bundle = data;
    var rows = $('brows'); rows.innerHTML = '';
    data.files.forEach(function (f) {
      var tr = document.createElement('tr');
      tr.innerHTML = '<td class="name"></td><td class="size">' + human(f.size) + '</td>';
      tr.querySelector('.name').textContent = f.name;
      rows.appendChild(tr);
    });
    $('blink').textContent = 'Permanent links — .tar: ' + location.origin + data.tar
      + '  ·  .zip: ' + location.origin + data.zip;
    $('btar').href = data.tar;
    $('bres').className = '';
    zipState();
  }

  $('make').addEventListener('click', function () {
    // Split on newlines via a char code, not an escape: this whole file is a
    // template literal, where a backslash-n would be consumed as a real
    // newline and leave an unterminated string in the emitted script.
    var urls = $('urls').value.split(String.fromCharCode(10)).map(function (line) { return line.trim(); })
      .filter(function (line) { return line.length > 0; });
    if (!urls.length) { bundleMsg('Paste at least one file URL.', true); return; }
    bundleMsg('');
    $('make').disabled = true; $('make').textContent = 'Creating…';
    fetch('/' + ZS.prefix + '/bundle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        files: urls.map(function (u) { return { url: u }; }),
        name: $('bname').value
      })
    }).then(function (r) {
      return r.json().then(function (b) {
        if (!r.ok) throw new Error((b && b.error && b.error.message) || ('HTTP ' + r.status));
        return b;
      });
    }).then(renderBundle)
      .catch(function (e) { bundleMsg('Could not create bundle: ' + e.message, true); })
      .finally(function () { $('make').disabled = false; $('make').textContent = 'Create bundle'; });
  });

  $('bzip').addEventListener('click', function () {
    if (!bundle) return;
    if (bundle.zipReady) { window.location.href = bundle.zip; return; }
    prepareZip();
  });

  // Checksum the bundle in resumable passes, each bounded so it stays inside the
  // Worker CPU budget, until ZIP can be streamed natively.
  function prepareZip() {
    var btn = $('bzip');
    btn.disabled = true;
    $('bprog').className = 'progress';
    var total = bundle.totalBytes || 1;
    function step() {
      fetch('/' + ZS.prefix + '/bundle/' + bundle.code + '/prepare', { method: 'POST' })
        .then(function (r) {
          return r.json().then(function (b) {
            if (!r.ok) throw new Error((b && b.error && b.error.message) || ('HTTP ' + r.status));
            return b;
          });
        })
        .then(function (d) {
          bundle = d;
          var pct = Math.round(((total - d.crcRemaining) / total) * 100);
          $('bbar').style.width = pct + '%';
          $('bnote').textContent = 'Preparing .zip — ' + pct + '% (' + human(d.crcRemaining) + ' to go)';
          if (d.complete) {
            btn.disabled = false;
            $('bprog').className = 'progress hidden';
            zipState();
            window.location.href = bundle.zip;
          } else {
            step();
          }
        })
        .catch(function (e) {
          btn.disabled = false;
          $('bprog').className = 'progress hidden';
          bundleMsg('Prepare failed: ' + e.message, true);
        });
    }
    step();
  }

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
