# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Browser UI** served at `/`: paste a ZIP link, browse the files, and download
  one, several, or all of them.
- **Combined download** (`GET /__/zip?path=…`): stream a selection of entries as
  a single ZIP built on the fly — zero re-compression, constant memory, exact
  Content-Length, automatic ZIP64.
- **Open mode** (`ALLOW_ANY_ARCHIVE_HOST`): opt-in acceptance of any public
  archive host (private/reserved IPs stay blocked) for the "paste any link" UX.
- `SERVE_UI` and `MAX_ZIP_ENTRIES` settings.

### Documented

- Clarified that large **DEFLATE** entries are bounded by the plan's per-request
  **CPU** limit (decompression is CPU work): ~100 MB on Free, up to many GB on
  Paid with `limits.cpu_ms`. STORED entries use ~0 CPU and stream to completion
  at any size on any plan. See [docs/troubleshooting.md](docs/troubleshooting.md).

## [1.0.0] - 2026-07-25

### Added

- Initial release: stream individual files out of a remote ZIP archive at the
  edge, with no extraction and constant memory.
- Single-archive and multi-archive (allowlisted / HMAC-signed) addressing modes.
- Full ZIP support: STORED and DEFLATE, ZIP64, data descriptors, UTF-8 and CP437
  names, Unicode Path extra fields.
- HTTP semantics: byte ranges (`206`/`416`), conditional requests (`304`),
  `If-Range`, HEAD, OPTIONS/CORS, strong ETags.
- Random-access ranges for STORED entries; sequential-access ranges for DEFLATE.
- Caching: in-isolate memo, per-colo Cache API, and optional KV for the parsed
  central directory.
- Security: SSRF allowlist + private-range blocking, ZIP-bomb guards, header
  sanitisation, oversized-metadata ceilings.
- Observability: structured JSON logs, per-request metrics, request ids.
- Endpoints: `/__/health`, `/__/version`, `/__/list`, `/__/meta/{entry}`, and
  entry downloads.
- Comprehensive test suite, benchmarks, and documentation.

[1.0.0]: https://github.com/your-org/archwright/releases/tag/v1.0.0
