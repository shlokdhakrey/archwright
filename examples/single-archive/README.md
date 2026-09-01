# Example: single-archive mode

Front one fixed archive. Entries are exposed at the path root, so a file named
`movie.mkv` inside the archive is served at `/movie.mkv`.

## Deploy

```bash
# From the project root, using this example's config:
cp examples/single-archive/wrangler.jsonc wrangler.jsonc
# Edit ARCHIVE_URL, then:
npm run deploy
```

## Use

```bash
# List what's inside
curl https://archwright-single.workers.dev/__/list

# Metadata for one entry
curl https://archwright-single.workers.dev/__/meta/movie.mkv

# Download (streams straight from inside the ZIP)
curl -O https://archwright-single.workers.dev/movie.mkv

# Seek — first 10 MiB only (STORED entries seek instantly)
curl -H 'Range: bytes=0-10485759' https://archwright-single.workers.dev/movie.mkv -o head.bin
```

The client never knows the file came from inside a ZIP: it sees a normal
streamed download with `Content-Length`, `Accept-Ranges`, `ETag`, and
`Last-Modified`.
