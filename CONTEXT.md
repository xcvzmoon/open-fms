# Context

Open FMS is a production file management service in front of S3-compatible storage. This document is the working context for humans and agents.

## Product intent

- Callers are services and apps. They use HTTP API keys or admin sessions.
- The service is byte-preserving. No transformations.
- Security beats convenience. A file is downloadable only after database status is `clean`.
- Scale target is modest: a few API instances, one Postgres primary, object storage.

## System boundaries

| Concern                     | Owner                    |
| --------------------------- | ------------------------ |
| HTTP, auth, rate limits     | `apps/api` + Better Auth |
| Tables, migrations, queries | `@open-fms/database`     |
| Status transitions, quota   | `@open-fms/lifecycle`    |
| S3 protocol details         | `@open-fms/storage` only |
| Scan checks and ClamAV      | `@open-fms/scan-worker`  |
| Auth emails                 | `@open-fms/mailer`       |

Rules that must stay true:

1. Routes and workers never import `@aws-sdk/*`.
2. Routes and workers never write `files.status` directly. They call lifecycle.
3. Migrations never run on API boot.
4. Downloads always re-check PostgreSQL state. No presigned GET in v1.
5. Setup codes and upload passes are stored as HMAC hashes only.

## File state machine

```text
initiated → uploading → uploaded → quarantined → scanning
    → clean | infected | rejected | failed → deleted
```

Every transition matches `status` and `row_version` and updates exactly one row.

## Auth model

- Better Auth owns sessions, password hashing, API key verification, and rate limiting.
- `caller_credentials` stores FMS policy: scopes, CIDR lists, size limits, rotation/revocation.
- `loadCallerContext` joins tenant policy for request handlers.
- Admin users use email/password. Service callers use API keys.

## Database

- Schema name is `fms`, never `public`.
- Driver is `postgres` (postgres.js) via `drizzle-orm/postgres-js`.
- IDs are application-generated UUID v7 except natural keys (`service_settings.key`, `caller_usage.caller_id`).
- Helpers: `generateUuid`, `generateTimestamps`, `generateTimestampsWithAudit`.

## Operational defaults

| Setting                   | Default    |
| ------------------------- | ---------- |
| Max file size             | 1 GiB      |
| Part size                 | 16 MiB     |
| Upload pass TTL           | 15 minutes |
| Incoming object lifecycle | 24 hours   |
| API key expiry            | 180 days   |
| Setup code TTL            | 24 hours   |

## Verification gate

Before calling work done:

```bash
vp run fmt
vp run lint
vp run check
vp run typecheck
vp run test
vp run build
```

Integration tests need `DB_URL` and migrations applied.

## Known intentional limits

- OpenAPI is enabled in development by default.
- Full end-to-end storage canary waits for a real backend compatibility suite (RustFS/MinIO/S3).
- Reconcile reports mismatches and does not repair status on its own.
- `MISSING_CODE_SPLITTING_GROUP_DEBUG_NAME` can appear during Nitro builds. It is a toolchain warning.

## Where to change things

| If you need to...      | Start in                                                  |
| ---------------------- | --------------------------------------------------------- |
| Add a table            | `packages/database/src/tables/` then generate a migration |
| Change lifecycle rules | `packages/lifecycle/src/`                                 |
| Add an HTTP route      | `apps/api/server/routes/`                                 |
| Add a background job   | `apps/api/server/tasks/` + `nitro.config.ts`              |
| Adjust scan policy     | `packages/scan-worker/src/checks.ts`                      |
| Send product email     | `packages/mailer/src/events.ts`                           |
