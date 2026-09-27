# Open FMS

[![CI](https://github.com/xcvzmoon/open-fms/actions/workflows/ci.yaml/badge.svg)](https://github.com/xcvzmoon/open-fms/actions/workflows/ci.yaml)
[![Release](https://github.com/xcvzmoon/open-fms/actions/workflows/release.yaml/badge.svg)](https://github.com/xcvzmoon/open-fms/actions/workflows/release.yaml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE.md)

File management API for S3-compatible object storage (RustFS, MinIO, AWS S3).

Other services upload and download over HTTP. They never need an S3 SDK, bucket names, or storage credentials.

## What it does

- Uploads files through the API (proxy single, resumable parts, or direct presigned PUT)
- Quarantines every upload until malware scanning finishes
- Promotes only clean objects into the clean bucket
- Serves downloads only for files whose database status is `clean`
- Tracks quotas, retention, audit events, and API keys per caller

Security rule in one line: **if PostgreSQL does not say the file is `clean`, the bytes are not downloadable.**

## Architecture

```text
Clients ──HTTPS──► Nitro API (apps/api)
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
   PostgreSQL      S3 storage    Scan worker
   (metadata)   quarantine/clean  (SHA-256, type,
                                   archive, ClamAV)
```

| Package                | Role                                                    |
| ---------------------- | ------------------------------------------------------- |
| `apps/api`             | HTTP API, auth, uploads, downloads, scheduled tasks     |
| `packages/database`    | Drizzle schema, queries, migrations                     |
| `packages/lifecycle`   | File state machine and quota transitions                |
| `packages/storage`     | Single AWS SDK v3 S3 adapter                            |
| `packages/scan-worker` | Job claim, integrity checks, ClamAV, lifecycle verdicts |
| `packages/mailer`      | Typed auth email events (verify, reset, setup code)     |

## Requirements

- Node.js 26 (via `devEngines`)
- pnpm 12.5.1 (managed by Vite+)
- PostgreSQL 16
- Optional: MinIO/RustFS/S3, ClamAV, SMTP

## Setup

```bash
cp .env.example .env
vp install
```

Set at least:

| Variable                                              | Purpose                                       |
| ----------------------------------------------------- | --------------------------------------------- |
| `DB_URL`                                              | PostgreSQL connection string                  |
| `BETTER_AUTH_SECRET`                                  | 32+ char secret for Better Auth               |
| `BETTER_AUTH_URL`                                     | Public API base URL                           |
| `AUTH_TOKEN_PEPPER`                                   | HMAC pepper for setup codes and upload passes |
| `STORAGE_ACCESS_KEY_ID` / `STORAGE_SECRET_ACCESS_KEY` | S3 credentials (when storage is used)         |
| `MAIL_MODE`, `MAIL_FROM`                              | `mock` or `smtp` mail transport               |

## Commands

```bash
vp run check      # format + lint + type-aware lint
vp run typecheck  # tsc across workspaces
vp run test       # unit + integration tests
vp run build      # build packages and the API
vp run api        # run API package scripts
```

Migration is CI/operator only. The API never migrates on boot.

```bash
vp run --filter "@open-fms/database" generate
vp run --filter "@open-fms/database" migrate
```

## API surface (summary)

| Area    | Examples                                                                                              |
| ------- | ----------------------------------------------------------------------------------------------------- |
| Health  | `GET /healthz`, `GET /readyz`                                                                         |
| Auth    | `/api/auth/*` (Better Auth)                                                                           |
| Signup  | `POST /api/v1/signup`, `POST /api/v1/signup/redeem`                                                   |
| Uploads | `POST /api/v1/uploads`, `PUT .../content`, `PUT .../parts/{n}`, `POST .../complete`, `POST .../abort` |
| Files   | `GET /api/v1/files/{id}`, `GET /api/v1/files/{id}/content`                                            |
| Keys    | `POST /api/v1/callers/{id}/keys/{keyId}/rotate`, `DELETE .../keys/{keyId}`                            |
| Admin   | `POST /api/v1/admin/approvals`, `GET/PATCH /api/v1/admin/settings/signup`                             |

OpenAPI docs: `/_openapi.json` and Scalar UI `/_scalar` in development.

## Storage and scanning

1. Client uploads to quarantine (`incoming/` or sealed prefix)
2. Scan worker claims a job (`FOR UPDATE SKIP LOCKED`)
3. Worker verifies SHA-256, sniffs type, checks archives, optionally runs ClamAV
4. Lifecycle promotes a clean object and marks the file `clean`
5. Download API streams only those files

## Testing

```bash
DB_URL=postgres://user:pass@localhost:5432/open-fms vp run test
```

Lifecycle integration tests cover the state machine with a controllable storage double. Without `DB_URL` they are skipped.

Storage integration tests talk to a real S3-compatible backend. They cover the adapter and the resumable multipart path (`proxy_parts`). Start one, then set the test env vars:

```bash
docker compose -f compose.storage.yml up -d --wait
STORAGE_TEST_ENDPOINT=http://127.0.0.1:9000 \
STORAGE_TEST_ACCESS_KEY_ID=rustfsadmin \
STORAGE_TEST_SECRET_ACCESS_KEY=rustfsadmin \
  vp run test
```

Without `STORAGE_TEST_ENDPOINT` the storage suite is skipped. The suites create the quarantine/clean/forensic buckets on first run. Point the same variables at RustFS, MinIO, or AWS S3 to validate a real backend. Resumable parts use S3 multipart under the hood: non-final parts must be at least 5 MiB (session default part size is 16 MiB).

## License

MIT. See [LICENSE.md](./LICENSE.md).
