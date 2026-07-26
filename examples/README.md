# Examples

Recipes for the two addressing modes. Each contains a `wrangler.jsonc` you can
copy over the project root (or merge into your own), plus usage notes.

- [`single-archive/`](single-archive/) — front **one** fixed archive; entries are
  served at the path root (`GET /movie.mkv`). Simplest; great for a download page
  backed by one large ZIP.
- [`multi-archive/`](multi-archive/) — front **many** archives, addressed by a
  reference under `/a/{ref}/…`, gated by a host allowlist and/or HMAC-signed
  tokens.

See [`curl.md`](curl.md) for a command cookbook covering ranges, conditional
requests, and the JSON API.
