# Scripts

Standalone utilities. They use only the Node standard library (global `fetch`,
Web Crypto, `zlib`) and require no build step.

## `probe-archive.mjs`

Inspect a remote ZIP over HTTP range requests, without downloading it. Useful
for confirming an origin supports ranges and for eyeballing an archive.

```bash
node scripts/probe-archive.mjs "https://storage.googleapis.com/bucket/archive.zip"
```

Prints the archive size, ETag, ZIP64 status, and a table of entries (method,
sizes, CRC-32, name).

## `sign-ref.mjs`

Generate a signed archive reference for multi-archive mode. The token format
matches `src/security/signing.ts` exactly.

```bash
node scripts/sign-ref.mjs "$SECRET" "https://storage.googleapis.com/bucket/a.zip" 3600
# → <token>, usable at https://<worker>/a/<token>/<entryPath>
```

## `smoke.mjs`

End-to-end smoke test against a deployed Worker. CI-friendly (non-zero exit on
failure).

```bash
node scripts/smoke.mjs https://archwright.example.workers.dev movie.mkv
```

## `check-bundle-size.mjs`

Fail if the built bundle exceeds the gzip budget. Run after `npm run build`.

```bash
npm run build && node scripts/check-bundle-size.mjs
```
