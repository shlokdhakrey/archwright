# 0003 — Single-archive vs. multi-archive addressing

**Status:** Accepted

## Context

Two use cases: (a) expose the files of **one** known archive as clean root paths
(`/movie.mkv`), and (b) serve files from **many** archives chosen per request.
Case (b) risks becoming an open proxy or an SSRF vector.

## Decision

Support both, selected by whether `ARCHIVE_URL` is set:

- **Single-archive mode** (`ARCHIVE_URL` set): entries at the path root; the
  archive host is auto-allowlisted.
- **Multi-archive mode** (empty): address via `/a/{ref}/{entry}`, where `ref` is
  a base64url URL (gated by `ALLOWED_ARCHIVE_HOSTS`) or an HMAC-signed token
  (`ARCHIVE_SIGNING_SECRET`). Without either, the mode refuses all requests.

Global control endpoints (`/__/health`, `/__/version`) work in both modes.

## Consequences

- Clean, ZIP-invisible URLs for the common single-archive case.
- Flexible multi-tenant serving without an open proxy: allowlist or signature is
  mandatory, and private IPs are always blocked.
- A reserved control-plane prefix (`__`, configurable) can, in principle, shadow
  an entry literally named `__/...`; acceptable and documented.

## Alternatives considered

- **Archive URL as a query parameter:** leaks into logs/caches and is awkward to
  sign. Rejected in favour of a path segment.
- **Multi-archive only:** worse ergonomics for the most common case. Rejected.
