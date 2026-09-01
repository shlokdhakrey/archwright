# API Reference

Base URL is your Worker's origin. In **single-archive mode**, entry paths are at
the root. In **multi-archive mode**, prefix every data/control path with
`/a/{ref}` (see [addressing](#addressing)).

The control-plane prefix is `__` by default (`CONTROL_PREFIX`).

## Conventions

- All error responses are JSON: `{ "error": { code, message, status, requestId } }`.
- Every response carries `x-request-id` (from `cf-ray` when present) for
  correlation with logs.
- CORS headers are present on every response; `OPTIONS` returns a `204` preflight.
- Security headers: `x-content-type-options: nosniff`, `referrer-policy: no-referrer`,
  `cross-origin-resource-policy: cross-origin`.

---

## `GET` / `HEAD` `/{entryPath}` — download

Streams an entry as if it were a standalone file.

**Query parameters**

| Parameter    | Effect                                                              |
| ------------ | ------------------------------------------------------------------ |
| `?download`  | Force `Content-Disposition: attachment` (save dialog). Also `?dl=1` |
| `?inline`    | Force `Content-Disposition: inline` (render/preview). Also `?dl=0`  |

Without a flag, the `CONTENT_DISPOSITION` default applies (`attachment`).

**Request headers**

| Header                                | Effect                                                             |
| ------------------------------------- | ------------------------------------------------------------------ |
| `Range: bytes=…`                      | Serve a byte range (`206`); `416` if unsatisfiable                 |
| `If-None-Match` / `If-Modified-Since` | `304 Not Modified` when the validator matches                      |
| `If-Range`                            | Honour the `Range` only if the entry is unchanged, else full `200` |
| `Accept-Encoding: gzip`/`deflate`     | Enables the zero-copy DEFLATE passthrough on a full download       |

**Response headers**

| Header                 | Notes                                                              |
| ---------------------- | ------------------------------------------------------------------ |
| `Content-Type`         | Inferred from the entry extension; `nosniff` set                   |
| `Content-Length`       | Exact. Uncompressed size, except on the DEFLATE passthrough where it is the compressed size (the wire length) |
| `Content-Encoding`     | `deflate` on a full DEFLATE download served as a zero-copy passthrough (client inflates); absent otherwise |
| `Accept-Ranges: bytes` | Present except on the encoded passthrough (an encoded body is not range-served) |
| `Content-Range`        | On `206` responses                                                 |
| `ETag`                 | Strong; derived from archive validator + entry CRC-32 + size       |
| `Last-Modified`        | From the entry's DOS timestamp                                     |
| `Content-Disposition`  | `attachment` (default) or `inline`; per-request `?inline`/`?download` override; RFC 5987 encoded |
| `Cache-Control`        | `public, max-age=<CACHE_TTL_SECONDS>`; `no-transform` added on the passthrough |
| `x-zip-method`         | `stored` or `deflate` (diagnostic)                                 |

**Status codes**: `200`, `206`, `304`, `404` (missing entry / directory),
`416` (bad range), `403` (disallowed archive host), `413` (guard exceeded),
`501` (unsupported/encrypted entry), `502` (malformed archive / upstream),
`504` (upstream timeout).

`HEAD` returns identical headers with no body and **without fetching any entry
data** — it costs only the (cached) directory load.

---

## `GET` / `HEAD` `/__/zip` — combined download

Stream a single ZIP containing a selection of entries, chosen with repeated
`?path=` parameters. The archive is assembled on the fly with **no
re-compression** (each entry's stored bytes are copied verbatim and its CRC
reused) and **constant memory**; the exact `Content-Length` is known up front, so
the browser gets a real progress bar.

```
GET /__/zip?path=movie1.mkv&path=movie2.mkv&name=my-picks
```

| Parameter | Notes                                                     |
| --------- | --------------------------------------------------------- |
| `path`    | An entry name to include; repeat once per file (required) |
| `name`    | Optional download filename (`.zip` appended if missing)   |

**Response**: `application/zip`, `Content-Disposition: attachment`, exact
`Content-Length`, `x-zip-entries: <count>`. `HEAD` returns the size with no body.
ZIP64 is emitted automatically when the combined size or offsets exceed 4 GiB.

**Status codes**: `200`, `400` (no/invalid selection), `404` (a selected entry
is missing), `413` (more than `MAX_ZIP_ENTRIES` selected), `501` (a selected
entry is unsupported). Ranges are not supported on this endpoint.

> Selections travel in the query string, so a very large selection can exceed URL
> length limits; `MAX_ZIP_ENTRIES` (default 64) bounds this.

---

## `GET` / `HEAD` `/__/tar` — combined download as TAR

Identical to `/__/zip` in shape (`?path=` repeated, optional `?name=`), but emits
a POSIX **ustar** archive: `application/x-tar`, exact `Content-Length`, long paths
carried in PAX extended headers, sizes past 8 GiB in base-256.

Pick the format by what the *source* stores, because the two are exact opposites:

| Source entries | `/__/zip`                                  | `/__/tar`                              |
| -------------- | ------------------------------------------ | -------------------------------------- |
| DEFLATE        | verbatim copy, CRC reused → **any size**    | must inflate → CPU-bound (~100 MB Free) |
| STORED         | verbatim copy → **any size**                | native passthrough → **any size**       |

The response carries `x-tar-mode: native` when no entry needed inflating.

---

## `POST` `/__/bundle` — many files in, one archive out

The reverse direction. Give it a list of remote file URLs; it validates each
(SSRF + allowlist), probes its size, and stores a manifest under a permanent code
derived from the canonical URL list.

```
POST /__/bundle
Content-Type: application/json

{ "files": [{ "url": "https://…/one.mkv" }, { "url": "https://…/two.mkv", "name": "custom.mkv" }],
  "name": "my-picks" }
```

`files` also accepts bare URL strings. Response:

```json
{ "code": "U_IbbVpW", "tar": "/bundle/U_IbbVpW.tar", "zip": "/bundle/U_IbbVpW.zip",
  "name": "my-picks", "files": [{ "name": "one.mkv", "size": 123, "crc": false }],
  "totalBytes": 123, "tarBytes": 2048, "zipBytes": 1200,
  "zipReady": false, "crcRemaining": 123 }
```

Duplicate names are de-duplicated (`file (1).mkv`). Nothing is downloaded or
stored — only sizes and names are recorded.

**Status codes**: `200`, `400` (no/invalid files), `403` (host not allowed, or
neither open mode nor an allowlist configured), `413` (too many files, or a
transcoding origin whose file is too large to measure), `503` (no `LINKS_KV`).

### `GET` / `HEAD` `/bundle/{code}.tar` — ready immediately, any size

TAR stores no per-file checksum, so payloads are moved natively and the Worker's
CPU cost is flat regardless of size. This works the moment the bundle exists.

### `POST` `/__/bundle/{code}/prepare` then `GET /bundle/{code}.zip`

ZIP stores a CRC-32 per entry — the one step that must touch every byte. Call
prepare repeatedly; each pass checksums a bounded slice (resuming where the last
stopped) and caches the result on the manifest:

```json
{ "prepared": 1048576, "remaining": 5242880, "complete": false, "zipReady": false }
```

Once `complete` is true the ZIP streams natively at any size. Requesting the ZIP
early returns `400` pointing at the TAR. Files from origins that transcode their
responses are measured (and checksummed) at create time, so they arrive
ZIP-ready.

---

## `POST` `/__/shorten` — permanent short links

Turn a long archive URL (a signed R2/S3 URL can be 600+ characters) into a compact
8-char code. Requires the **`LINKS_KV`** binding.

```
POST /__/shorten
Content-Type: application/json

{ "url": "https://…/archive.zip?X-Amz-…" }
```

The URL may also be passed as `?url=…`. It is validated exactly as a download would
be (SSRF + host allowlist), then stored in KV. Response:

```json
{ "code": "n9Ac6hIu", "zfile": "/zfile/n9Ac6hIu", "sfile": "/sfile/n9Ac6hIu", "url": "https://…", "ttl": 0 }
```

The code is derived from the archive's **canonical identity** — its origin + path,
with the query string dropped — *not* the full URL. For a signed URL the query is
the (expiring) signature, so the same object always yields the **same code**.
Re-submitting a freshly-signed URL refreshes the stored value under that same code:
the shared link is stable. Entries are stored **permanently** by default
(`SHORTLINK_TTL_SECONDS=0`); set a positive value for an expiry.

> The *link* is permanent, but *downloading* still needs a valid backing URL. If
> you shortened a **signed** URL, downloads stop once the signature expires (the
> code resolves, the origin rejects the stale signature) — re-submit to refresh the
> same link. Shorten a **public** URL and it is permanent end-to-end.

**Status codes**: `200`, `400` (missing/invalid URL), `403` (host not allowed, or
neither open mode nor an allowlist is configured), `503` (no `LINKS_KV` binding).

## `/zfile/{code}` and `/sfile/{code}/…` — addressing via a short code

Both prefixes resolve the code to its archive URL and then behave exactly like
`/a/{ref}/…`; the split is presentational:

- **`/zfile/{code}`** — browse: a bare code opens the web UI pre-loaded with the
  archive's files (`/zfile/{code}/__/list` for the raw JSON listing).
- **`/sfile/{code}/{file}`** — download/stream a single file.

Returns `404` if the code is unknown or expired.

---

## `GET` `/__/list` — list entries

Paginated listing of the archive's entries.

**Query parameters**

| Param    | Default | Notes                                    |
| -------- | ------- | ---------------------------------------- |
| `prefix` | `""`    | Only entries whose name starts with this |
| `dirs`   | `false` | Include directory entries when `true`    |
| `limit`  | `1000`  | Page size (max `10000`)                  |
| `cursor` | `0`     | Offset into the filtered list            |

**Response**

```json
{
  "archive": { "size": 2568560482, "entryCount": 1, "zip64": false, "source": "origin" },
  "pagination": { "cursor": 0, "limit": 1000, "returned": 1, "total": 1, "nextCursor": null },
  "entries": [
    {
      "name": "The.Apartment.Job.S01E05…mkv",
      "size": 2568168203,
      "compressedSize": 2568560078,
      "method": "deflate",
      "directory": false,
      "encrypted": false,
      "crc32": "7a22b00e",
      "lastModified": "2026-07-25T16:40:28.000Z",
      "contentType": "video/x-matroska",
      "randomAccess": false
    }
  ]
}
```

`archive.source` is `origin`, `cache`, or `memo` — where the directory was
loaded from. `randomAccess` is `true` for STORED entries (efficient ranges).

---

## `GET` `/__/meta/{entryPath}` — entry metadata

Returns a single entry object (same shape as a `list` entry) plus the same
`ETag`/`Last-Modified` the download endpoint uses. `404` if the entry is absent.

---

## `GET` `/__/health` — liveness

```json
{ "status": "ok", "service": "archwright", "time": "2026-07-25T17:00:00.000Z" }
```

Never contacts the origin — safe for uptime checks and load-balancer probes.

---

## `GET` `/__/version` — version & capabilities

Reports version, mode, effective limits, and **runtime-detected** features
(`kvCache`, `analyticsEngine`, `signedReferences`).

---

## Addressing

### Single-archive mode

`ARCHIVE_URL` set. Entry paths at the root: `GET /movie.mkv`.

### Multi-archive mode

`ARCHIVE_URL` empty. Address an archive via `/a/{ref}/{entryPath}`, where `ref`
is either:

- **base64url of the archive URL** — permitted only if the archive host is in
  `ALLOWED_ARCHIVE_HOSTS`; or
- **an HMAC-signed token** (`ARCHIVE_SIGNING_SECRET` set) — tamper-proof and
  optionally expiring. Mint with `scripts/sign-ref.mjs`.

Control endpoints per archive: `GET /a/{ref}/__/list`, `/a/{ref}/__/meta/{entry}`.
`/__/health` and `/__/version` remain global (no archive needed).

Without an allowlist **and** without a signing secret, multi-archive mode refuses
every request with `403` — it can never be an open proxy.

**Open mode.** Setting `ALLOW_ANY_ARCHIVE_HOST=true` lifts the host restriction so
any base64url URL to a public host is accepted (this powers the "paste any link"
UI). Private/reserved IPs remain blocked. Enabling it makes the Worker a public
proxy for public hosts — prefer an allowlist or signed links for locked-down
deployments. See [security.md](security.md).
