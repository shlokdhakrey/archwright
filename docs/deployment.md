# Deployment

## Prerequisites

- Node.js 20+ (22 recommended).
- A Cloudflare account. The Free plan is enough for STORED archives; DEFLATE at
  scale wants Paid.
- `npx wrangler login` (or a `CLOUDFLARE_API_TOKEN` for CI).

## Configure

Edit `wrangler.jsonc` (or copy an [example](../examples/)):

- **Single archive:** set `ARCHIVE_URL`.
- **Multiple archives:** leave `ARCHIVE_URL` empty and set `ALLOWED_ARCHIVE_HOSTS`
  and/or `ARCHIVE_SIGNING_SECRET`.

Sensitive values go in secrets, not `vars`:

```bash
wrangler secret put ARCHIVE_SIGNING_SECRET
```

## Deploy

```bash
npm install
npm run cf-typegen
npm run check          # optional but recommended
npm run deploy         # wrangler deploy
```

Validate a build without deploying:

```bash
npm run build          # wrangler dry-run → dist/
node scripts/check-bundle-size.mjs
```

Smoke-test the deployment:

```bash
node scripts/smoke.mjs https://archwright.<account>.workers.dev movie.mkv
```

## Free vs Paid

The base `wrangler.jsonc` deploys unchanged on **both** plans. Differences you
opt into:

| Setting                          | Effect                             | Plan                        |
| -------------------------------- | ---------------------------------- | --------------------------- |
| `"limits": { "cpu_ms": 300000 }` | Up to 5 min CPU for large DEFLATE  | Paid only (ignored on Free) |
| `METADATA_KV` binding            | Cross-colo central-directory cache | Free tier available         |
| `METRICS` (Analytics Engine)     | Queryable custom metrics           | Paid                        |

The Worker **detects optional bindings at runtime**, so the same code runs with
or without them — the Free deployment simply skips KV/Analytics.

## Optional bindings

Create and bind KV for a cross-colo directory cache:

```bash
wrangler kv namespace create METADATA_KV
# add the printed id to wrangler.jsonc under "kv_namespaces"
```

Uncomment the `kv_namespaces` / `analytics_engine_datasets` blocks in
`wrangler.jsonc` as needed.

## Custom domains & routes

Add a route or custom domain in `wrangler.jsonc` or the dashboard:

```jsonc
"routes": [{ "pattern": "files.example.com", "custom_domain": true }]
```

## Observability

`observability.enabled` is on by default — logs appear in the dashboard (Workers
→ your Worker → Logs) and can be shipped via Logpush. Each line is one JSON
object with the `requestId`, timings, and cache source. Set `LOG_LEVEL`
(`debug`/`info`/`warn`/`error`/`silent`).

## CI/CD

- `.github/workflows/ci.yml` runs typecheck, lint, format, tests+coverage,
  build, and the bundle-size gate on every push/PR.
- `.github/workflows/deploy.yml` deploys on `v*` tags (or manual dispatch) when
  `CLOUDFLARE_API_TOKEN` (+ `CLOUDFLARE_ACCOUNT_ID`) secrets are present; it
  no-ops safely otherwise.
