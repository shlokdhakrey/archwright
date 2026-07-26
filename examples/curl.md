# curl cookbook

Assumes single-archive mode at `https://zs.example`. In multi-archive mode,
prefix entry paths with `/a/{ref}`.

## Discovery

```bash
# Service metadata & detected features
curl https://zs.example/__/version

# Liveness
curl https://zs.example/__/health

# List entries (paginated; filter by prefix)
curl "https://zs.example/__/list?limit=50&prefix=season-1/"

# Metadata for a single entry (size, method, ETag, content type)
curl https://zs.example/__/meta/movie.mkv
```

## Downloading

```bash
# Full download (streamed; has Content-Length even for DEFLATE entries)
curl -O https://zs.example/movie.mkv

# HEAD — headers only, no bytes fetched from inside the archive
curl -I https://zs.example/movie.mkv
```

## Range requests (seeking)

```bash
# First 1 MiB
curl -H 'Range: bytes=0-1048575' https://zs.example/movie.mkv -o part.bin

# Last 500 bytes (suffix range)
curl -H 'Range: bytes=-500' https://zs.example/movie.mkv -o tail.bin

# A middle window; responds 206 with Content-Range
curl -i -H 'Range: bytes=1000000-2000000' https://zs.example/movie.mkv
```

> STORED entries seek instantly (the range maps straight onto the origin).
> DEFLATE entries are range-capable but seek sequentially — see
> [docs/limitations.md](../docs/limitations.md).

## Conditional requests (caching)

```bash
# Grab the ETag
ETAG=$(curl -sI https://zs.example/movie.mkv | tr -d '\r' | awk -F': ' '/^etag/i{print $2}')

# Revalidate — expect 304 Not Modified
curl -i -H "If-None-Match: $ETAG" https://zs.example/movie.mkv

# If-Range: only honour the range if the entry is unchanged, else full 200
curl -i -H "If-Range: $ETAG" -H 'Range: bytes=0-1023' https://zs.example/movie.mkv
```

## CORS preflight

```bash
curl -i -X OPTIONS https://zs.example/movie.mkv \
  -H 'Origin: https://app.example' \
  -H 'Access-Control-Request-Method: GET'
```
