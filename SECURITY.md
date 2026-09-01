# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** via
[GitHub Security Advisories](https://github.com/your-org/archwright/security/advisories/new)
rather than opening a public issue.

We aim to acknowledge reports within 3 business days and to ship a fix or
mitigation for confirmed issues promptly.

## Scope and threat model

Archwright fetches remote ZIP archives and streams their entries to clients. The
most relevant risks and the controls that address them:

| Risk                                                   | Control                                                                                                                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SSRF** (Worker coerced into fetching internal hosts) | Host allowlist + private/reserved IP-literal blocking (`src/security/ssrf.ts`); multi-archive mode refuses to proxy without an allowlist or signing secret |
| **Open proxy**                                         | Signed references (HMAC) or an explicit host allowlist are required in multi-archive mode                                                                  |
| **ZIP bombs / resource exhaustion**                    | Bodies always stream (constant memory); optional max-uncompressed-size and max-ratio guards bound CPU/egress                                               |
| **Path traversal / entry spoofing**                    | Entries are served only if present in the central-directory index; names are decoded, NFC-normalised, and `..`/control characters rejected                 |
| **HTTP header/response injection**                     | Filenames and header values are stripped of control characters; RFC 5987 encoding for `Content-Disposition`                                                |
| **Cache poisoning**                                    | Cache keys fold in the origin validator (ETag/Last-Modified); no untrusted request data is used in keys                                                    |
| **Oversized metadata**                                 | Central-directory size and entry-count ceilings enforced before buffering                                                                                  |
| **Malformed archives**                                 | Every field read is bounds-checked (`ByteView`); parse failures return `502 malformed_archive`, never a crash                                              |

See [docs/security.md](docs/security.md) for the full analysis.

## Supported versions

The latest `1.x` release receives security fixes.
