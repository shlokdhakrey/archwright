# Contributing to Archwright

Thanks for your interest in improving Archwright! This project aims to be a
correct, secure, and maintainable reference implementation, so contributions are
held to a high bar — and the tooling makes that easy.

## Getting started

```bash
npm install
npm run cf-typegen   # generate worker-configuration.d.ts
npm run check        # typecheck + lint + format + tests
```

Copy `.dev.vars.example` to `.dev.vars` and run `npm run dev` for a local server.

## Development workflow

- **One concern per PR.** Small, focused changes are reviewed faster.
- **Tests are required** for behaviour changes. The suite runs in plain Node via
  dependency injection (see `tests/helpers/`), so it is fast and needs no network.
- **No new runtime dependencies** without a strong justification. The Worker
  ships with zero runtime dependencies by design; that keeps the bundle tiny,
  cold starts fast, and the supply chain minimal.
- **Match the surrounding style.** Prettier and ESLint are authoritative; run
  `npm run lint:fix` and `npm run format`.

## Before you open a PR

Run the full gate locally — CI runs the same commands:

```bash
npm run check && npm run build && node scripts/check-bundle-size.mjs
```

## Working on the ZIP core

The parsing, streaming, and HTTP layers are correctness-critical. When touching
them, please consider (and, where relevant, add fixtures for):

- STORED vs DEFLATE entries
- ZIP64 records and the ZIP64 extra field
- Entries with a data descriptor (general-purpose flag bit 3)
- Local-file-header vs central-directory field divergence
- Range requests (206/416), conditional requests (304), and `If-Range`

`tests/helpers/build-zip.ts` builds spec-valid fixtures for all of these.

## Commit messages

Use clear, imperative subject lines (e.g. "Fix ZIP64 offset resolution"). Group
logically related changes.

## Reporting security issues

Please do **not** open a public issue for vulnerabilities. See
[SECURITY.md](SECURITY.md).
