# Troubleshooting

Every response includes `x-request-id`; use it to find the matching structured
log line (Workers → Logs, or `wrangler tail`).

## `502 malformed_archive`

The bytes fetched are not a valid ZIP, or the origin returned unexpected content
(e.g. an HTML error page, or a gzip-transcoded body).

- Confirm the URL is a real ZIP: `node scripts/probe-archive.mjs <url>`.
- Ensure the origin serves the archive **identity-encoded** (no gzip transform).
  Archwright requests `Accept-Encoding: identity`; some proxies ignore it.
- Check for a signed-URL expiry returning an error body.

## `502 upstream_error` / `504 upstream_timeout`

The origin failed or was too slow to return **headers**.

- Increase `ORIGIN_TIMEOUT_MS` (this guards TTFB, not the streaming body).
- Check the origin supports range requests (see below).
- Transient failures are retried (`ORIGIN_RETRIES`); persistent ones surface here.

## `403 forbidden`

- **Multi-archive mode with no allowlist/secret:** set `ALLOWED_ARCHIVE_HOSTS`
  or `ARCHIVE_SIGNING_SECRET`.
- **Host not allowlisted:** add the archive's host to `ALLOWED_ARCHIVE_HOSTS`.
- **Private/reserved host:** the target resolves to a blocked IP range by design.

## `404 not_found` for a file you know exists

- Names are case-sensitive and normalised (NFC). Check exact spelling via
  `/__/list?prefix=…`.
- Directory paths (trailing `/`) are not downloadable — request the file itself.
- The path is percent-decoded; ensure special characters are encoded correctly.

## `416 range_not_satisfiable`

The `Range` start is beyond the entry size, or `bytes=-0`. The `Content-Range:
bytes */<size>` header tells you the actual size.

## `501 unsupported_entry`

The entry is encrypted or uses a compression method other than STORED/DEFLATE.
See [Limitations](limitations.md).

## Range requests are slow on a compressed file

DEFLATE entries seek sequentially — a range far into the file inflates
everything before it. This is expected; use STORED archives for fast seeking. See
[Performance](performance.md).

## "Origin ignored the range request on a large resource"

The origin returned `200` (whole file) to a range request and the file is larger
than `MAX_CENTRAL_DIRECTORY_BYTES`. The origin does not support ranges for this
resource; Archwright cannot stream from it. Use a range-capable origin.

## A large DEFLATE download stops partway (browser may say "complete")

By default this **does not happen** — a full DEFLATE download is passed through
untouched under `Content-Encoding: deflate` and the client inflates it, so the
Worker uses ≈ 0 CPU and the entry streams to completion at any size, even on Free
(see [Limitations](limitations.md)). If you are still seeing a truncated download:

- **Confirm the passthrough is active.** The response should carry
  `Content-Encoding: deflate` and an exact `Content-Length`. If it shows neither,
  `DEFLATE_PASSTHROUGH` is disabled (set it back to `true`, the default) or the
  client sent `Accept-Encoding: identity` (which forces server-side inflation).
- **A truncated *server-side-inflated* download** (no `Content-Encoding`, chunked)
  ends after a fraction of the file, and `wrangler tail` shows
  `outcome: "exceededCpu"`. That path is only taken when passthrough is off, for a
  DEFLATE **range**, or for a **combined** ZIP — all of which must touch the bytes.

Rough per-request ceilings for the paths that *do* decompress or re-frame in the
Worker (ranges, combined ZIP, or `DEFLATE_PASSTHROUGH=false`):

| Plan                           | CPU/invocation | Approx. processable |
| ------------------------------ | -------------- | ------------------- |
| Free                           | ~2 s           | ~100–125 MB         |
| Paid (default)                 | 30 s           | ~1–1.5 GB           |
| Paid + `limits.cpu_ms: 300000` | 5 min          | many GB             |

Full **DEFLATE** and **STORED** downloads are passthroughs and are **not** bounded
by this table — they stream to completion at any size on any plan.

**If you hit a ceiling on the range/combined paths:**

- **Serve a STORED archive.** STORED entries are a byte passthrough (**~0 CPU**)
  at any size, including ranges. If you control the archive, store media
  uncompressed (`zip -0`).
- **Upgrade to Paid and raise the CPU limit:** add `"limits": { "cpu_ms": 300000 }`
  to `wrangler.jsonc` (it is rejected on Free).

## Download manager fails: "unknown compression method" / `libz::inflate() failed`

A download manager (IDM, 1DM, FDM, …) rejects a **DEFLATE** entry with an error
like `Download: libz::inflate() failed. cause: unknown compression method`. The
same file downloads fine in a browser.

**Why:** to serve large compressed entries at ≈ 0 CPU, Archwright passes the entry's
**raw** DEFLATE bytes through under `Content-Encoding: deflate` and lets the client
inflate them (see [Limitations](limitations.md)). Browsers, `curl`, and most HTTP
libraries accept raw DEFLATE — if the zlib header looks wrong they retry as raw
(RFC 1951). Some download managers use a **strict** zlib that requires the RFC 1950
wrapper (a 2-byte header + Adler-32 trailer) and reject the first raw byte with
"unknown compression method". This is a client-side strictness difference, not a
corrupt stream.

**Workarounds (in order of ease):**

- **Download in the browser.** Fully supported at any size — this is the primary
  path and needs no configuration.
- **Configure the download manager to send `Accept-Encoding: identity`.** Archwright
  then inflates server-side and returns a plain, unencoded file every client
  accepts. Bounded by the plan's CPU limit (~100 MB on Free; any size on Paid).
- **Set `DEFLATE_PASSTHROUGH=false`** to force server-side inflation for *all*
  clients. This restores universal compatibility, but it also removes the zero-CPU
  benefit for browsers, so large DEFLATE downloads then need the Paid plan
  (`limits.cpu_ms`). A global trade-off — prefer the per-client `identity` header
  above unless most of your traffic is strict download managers.

**STORED entries are unaffected** — they are a plain identity passthrough that every
client (including download managers) handles at any size on any plan. If you control
the archive, `zip -0` sidesteps this entirely.

**Bundles are unaffected too.** `/bundle/{code}.tar` and `.zip` are plain, unencoded
archives that answer `Range` requests, so download managers handle them natively and
interrupted downloads resume. If a download manager is the primary client, bundling
the files is the smoothest path.

## High CPU / hitting the Free CPU limit

Full DEFLATE/STORED downloads are zero-copy passthroughs and should not spend CPU.
If you see high CPU or `exceededCpu`, you are on a path that must touch the bytes:
a DEFLATE **range**, a **combined** `/__/zip`, or `DEFLATE_PASSTHROUGH=false`. Move
to the Paid plan with `limits.cpu_ms`, or serve STORED archives (≈ 0 CPU).

## Local development

- `npm run dev` starts `wrangler dev`. Put `ARCHIVE_URL` etc. in `.dev.vars`.
- Use `LOG_LEVEL=debug` for verbose structured logs.
- `wrangler tail` streams logs from a deployed Worker.
