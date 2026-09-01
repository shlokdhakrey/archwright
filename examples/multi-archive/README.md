# Example: multi-archive mode

Front many archives. Each request addresses an archive with a reference under
`/a/{ref}/{entryPath}`. Two ways to authorise which archives may be fetched:

## Option A — host allowlist (base64url references)

Set `ALLOWED_ARCHIVE_HOSTS`. The reference is the base64url of the archive URL.

```bash
# Encode the archive URL as a reference
REF=$(node -e "process.stdout.write(Buffer.from('https://storage.googleapis.com/bucket/a.zip').toString('base64url'))")

# List and download
curl "https://archwright-multi.workers.dev/a/$REF/__/list"
curl -O "https://archwright-multi.workers.dev/a/$REF/movie.mkv"
```

Only archives whose host is in the allowlist are fetched; everything else is
`403`.

## Option B — HMAC-signed references (recommended for untrusted callers)

Set a secret and hand out short-lived, tamper-proof tokens. Callers cannot forge
or alter the target URL.

```bash
wrangler secret put ARCHIVE_SIGNING_SECRET   # e.g. openssl rand -hex 32

# Mint a token that expires in 1 hour
TOKEN=$(node scripts/sign-ref.mjs "$SECRET" "https://storage.googleapis.com/bucket/a.zip" 3600 | head -1)

curl -O "https://archwright-multi.workers.dev/a/$TOKEN/movie.mkv"
```

With a signing secret configured, the allowlist becomes optional — the signature
is the authorisation. You can use both together for defence in depth.

## Safety

Multi-archive mode **refuses to proxy** unless an allowlist **or** a signing
secret is configured, so it can never become an open proxy. Private/reserved IP
ranges are always blocked regardless of configuration.
