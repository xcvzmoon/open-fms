# Open FMS (File Management System for S3-Compatible Object Storage)

> **NOTE: `PLAN.md` and `TODO.md` are working documents. Do not commit them and do not push them.**

## 1. Goal

A production-grade file upload and download API built on **Nitro/H3**, sitting in front of **S3-compatible storage** (RustFS, MinIO, or AWS S3). Other services call it over HTTP and need no S3 SDK, credentials, or bucket knowledge.

Priorities: **security**, **reliability and data integrity**, **horizontal scalability**, **storage isolation**, **observability**.

```text
PostgreSQL = authoritative file/control state
S3 storage = object bytes
Workers    = security verdict
API        = authentication, authorization, orchestration
```

**Expected scale:** at most 20 services and 20k users. That means 2-3 Nitro instances behind a load balancer, a Postgres primary with a standby, and no PgBouncer or read replicas until measurements call for them.

## 2. Scope

Uploads, downloads, resumable part-based uploads, optional direct-to-storage transfer, metadata and lifecycle, auth and registration, quotas, rate limiting, malware scanning, validation, quarantine, rescans, retention, legal holds, audit logging, OpenTelemetry, and multiple S3-compatible storage backends are in scope. Business logic, transformation, and UI are out of scope. The service is byte-preserving.

## 3. Stack

| Layer               | Choice                                                                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime / framework | Nitro (standalone, not the Nuxt-bundled build) + H3                                                                                                             |
| Language            | TypeScript                                                                                                                                                      |
| Package manager     | pnpm                                                                                                                                                            |
| Database            | PostgreSQL, single named schema `fms` (never the default `public`)                                                                                              |
| ORM / kit           | `drizzle-orm` + `drizzle-kit` pinned to `1.0.0-rc.5-5935859`                                                                                                    |
| DB driver           | `postgres` (postgres.js) via `drizzle-orm/postgres-js` — not `pg`                                                                                               |
| Storage client      | `@aws-sdk/client-s3` + `@aws-sdk/lib-storage` (multipart) + `@aws-sdk/s3-request-presigner`                                                                     |
| Validation          | Valibot for request schemas                                                                                                                                     |
| Malware scanning    | ClamAV, called via `clamdscan`/`clamd` TCP protocol (`INSTREAM`) — the `clamscan-async` or a small hand-rolled client works, since maintained wrappers are thin |
| Queue               | PostgreSQL scan jobs; keep the claim query inside the scan worker until another queue adapter is needed                                                         |
| Background workers  | Separate Nitro tasks/processes (Nitro's scheduled tasks for sweepers; long-running worker processes for scanning, not on the request event loop)                |
| Observability       | `@opentelemetry/sdk-node` + auto-instrumentation, exported via OTLP                                                                                             |
| Testing             | Vitest + `@nuxt/test-utils`-style H3 test harness, or plain `supertest` against the Nitro dev server                                                            |

**Why a separate worker process for scanning:** Node is single-threaded per process. Streaming a large file through ClamAV and doing CPU-bound checks (archive inspection, hashing) inside the same process that serves HTTP requests will stall other requests. Run scan workers as their own Nitro tasks or plain Node processes, scaled independently from the API.

## 4. Core security model

No uploaded file is downloadable just because storage accepted it.

```text
Caller ─► API ─► File lifecycle ─► Storage quarantine ──X── downloads prohibited
                       │                    │
                       │               sealed object
                       │                    ▼
                       ◄────────── Scan worker verdict
                       │ verified promotion and database transition
                       ▼
                Storage clean bucket ─► authorized download
```

> Only files whose authoritative PostgreSQL state is `clean` may be served.

## 5. Key decisions

| Area              | Decision                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------- |
| Framework         | Nitro + H3, TypeScript                                                                      |
| Storage           | S3-compatible backends through one internal AWS SDK adapter; lifecycle owns object ordering |
| Metadata          | PostgreSQL via Drizzle ORM `1.0.0-rc.5-5935859`, postgres.js driver, named schema `fms`     |
| Code style        | No comments unless strictly necessary; JSDoc only on exports shared across the workspace    |
| IDs               | Application-generated UUID v7 (`uuid` https://github.com/uuidjs/uuid)                       |
| Caller auth       | Long-lived API keys, HMAC-SHA256 with a versioned server pepper                             |
| Registration      | `admin_approval` (default) and `self_signup` (allowlisted company email domains only)       |
| Upload default    | Proxy through the API                                                                       |
| Direct uploads    | Explicit per-caller capability, never automatic by size                                     |
| Storage isolation | Quarantine bucket (`incoming/`, `sealed/` prefixes) plus clean bucket                       |
| Malware scanning  | ClamAV plus type/structure validation, fail closed                                          |
| Queue             | PostgreSQL scan jobs, claimed by workers                                                    |
| Integrity         | SHA-256, computed via Node's streaming `crypto.createHash`                                  |
| Observability     | OpenTelemetry through a shared collector                                                    |
| Architecture      | Stateless API instances                                                                     |
| File lifecycle    | One shared module owns guarded transitions and the order of database and storage operations |

## 6. Architecture

```text
Callers (services, websites, mobile) ──TLS──► Load balancer ──► Nitro API (stateless, 2-3 instances)
                                                                   │            │
                                                                   ▼            ▼
                                                             PostgreSQL     S3 storage: quarantine
                                                             (Drizzle)      (incoming/, sealed/)
                                                                                │
                                                                          Scan workers (Node)
                                              (SHA-256, type, structure, archives, ClamAV)
                                                                                │ verdict to file lifecycle
                                                                                ▼
                                                                  verified promotion to clean storage
                                                                                │
                                                                                ▼
                                                                       S3 storage: clean ──► downloads

Optional direct path: client ──presigned PUT──► storage incoming/ (control stays with the API)
All components ──OTLP──► OpenTelemetry Collector ──► metrics / logs / traces backends
```

The API, scan workers, and sweepers run in separate processes but use the same file lifecycle module. Route handlers handle HTTP concerns; workers run checks and submit verdicts; sweepers request recovery or expiry. The lifecycle module owns the state transition and the required ordering of PostgreSQL and storage operations. Its interface is the test surface for those rules. Storage and database adapters remain inside its implementation.

## 7. Access and authentication

The system uses `admin_approval` and allowlisted-domain `self_signup`, one-time setup codes, admins, API key rotation, upload passes for browsers/mobile, and tenant isolation. The exact registration and authorization rules still need to be written here before those paths are implemented. Nitro-specific notes:

- **Auth as H3 middleware:** an event handler in `server/middleware/` that runs before route handlers, reads the `Authorization` header, looks up the key (with an in-memory LRU cache, e.g. `lru-cache`, TTL ~30s), and attaches `event.context.caller` for downstream handlers.
- **Key hashing:** `crypto.createHmac('sha256', pepper).update(secret).digest()`, stored as `bytea` via Drizzle. Peppers are versioned and loaded from the secrets manager at boot (or fetched and cached with periodic refresh).
- **Constant-time comparison:** `crypto.timingSafeEqual`.
- **Rate limiting / failed-attempt throttling:** an in-memory token bucket per key/IP for a single instance, but since you run 2-3 instances, back it with a shared store (Redis, or a lightweight Postgres table with `UPDATE ... RETURNING` for atomic counters) so limits hold across instances.
- **Upload passes:** signed, opaque tokens (`crypto.randomBytes(32)`, hashed the same way as API keys) bound to one file ID, checked the same way as keys but scoped to the specific upload endpoints only.

## 8. Upload modes

The three upload modes are proxy single, proxy parts/resumable, and direct. H3-specific implementation:

- **Streaming request bodies:** H3 exposes the raw Node request stream (`event.node.req`) or a Web `ReadableStream` via `getRequestWebStream(event)` (Nitro 2.x / H3 1.x support this). Use that to stream directly into `@aws-sdk/lib-storage`'s `Upload` (for single PUT) without buffering, piping through a `PassThrough` that also feeds a hash stream.
- **Never use `readBody`/`readFormData` for file bytes** — those buffer the whole payload in memory. Reserve H3's body parsers for the small JSON control-plane payloads (create upload, complete, key management).
- **Part-based proxy uploads:** each `PUT /v1/uploads/{id}/parts/{n}` streams one part to a `UploadPartCommand`, sized to fit in memory comfortably (16 MiB default), so no special streaming trick is needed per part.

## 9. Storage adapter

Use one internal S3 adapter backed by the AWS SDK v3. It selects the configured endpoint, credentials, region, and buckets for each file's `storage_backend_id`. Configure path-style addressing per backend when required. The adapter contains S3 requests and translates their results for the file lifecycle module; routes and scan workers do not import `@aws-sdk/*` or choose bucket names.

Do not publish a `StorageDriver` interface that repeats S3 operations. RustFS, MinIO, and AWS S3 are deployments of the same adapter, subject to the compatibility tests in section 19. Add a separate storage seam only when an actual second adapter needs different behavior. Keep storage operations private to the lifecycle implementation in the meantime.

## 10. Storage layout, direct upload security, integrity, atomic enqueue, scan pipeline, promotion, reconciliation, downloads, filenames/keys, quotas

The file lifecycle module coordinates these rules across HTTP requests, scan workers, and sweepers:

- Layout: `incoming/{base}` (client-writable, direct uploads only, 24h lifecycle), `sealed/{base}` (server-only, what the scanner reads), clean bucket `{base}`, optional forensic bucket for infected files.
- Direct-upload overwrite race: after `complete`, the lifecycle module copies `incoming/` to `sealed/`, records the sealed ETag, and deletes the `incoming/` object. The scanner only reads `sealed/`, and promotion is bound to that ETag.
- Presigned PUT size isn't self-enforcing — sign content length where the backend supports it, and always verify actual size at `complete`.
- SHA-256 is canonical, computed in-stream for proxy single uploads (Node's `crypto.createHash('sha256')` piped alongside the body), and by the scanner for parts/direct uploads.
- The lifecycle module records quarantine state and enqueues the scan job in one Drizzle transaction (`db.transaction(async (tx) => { ... })`), with a guarded `UPDATE ... WHERE status = 'uploaded'` that must affect exactly one row. Storage operations outside the transaction must be safe to retry and reconcile.
- Scan pipeline: workers claim jobs with `SELECT ... FOR UPDATE SKIP LOCKED` via Drizzle's raw SQL or `sql` template, run SHA-256, MIME detection (`file-type` npm package, which sniffs magic bytes rather than trusting extensions), structural validation per format, archive-bomb checks (depth, entry count, expanded size — for ZIP-based formats like DOCX/XLSX too), then ClamAV `INSTREAM`. Workers submit the verdict to the lifecycle module; they do not promote files or update file status directly.
- ClamAV limits: prove that `clamd.conf`'s `StreamMaxLength` and `MaxFileSize` cover the configured maximum file size, or lower that maximum. The starting default is 1 GiB.
- Promotion: the lifecycle module checks the sealed object's ETag, copies it to clean storage only if the backend's tested copy behavior preserves that check, verifies the clean object, then transitions the file to `clean`. It deletes the sealed object asynchronously after that transition. Do not enable uploads on a backend without a proven safe promotion path.
- Reconciliation: a scheduled Nitro task asks the lifecycle module to compare PostgreSQL state with storage state and repair or alert. It does not make independent status changes.
- Downloads: the lifecycle module checks authoritative `clean` state and resolves the stored backend and object before a proxy stream or short presigned GET (1-5 min) is returned. The H3 route handles the HTTP response and range headers. Direct downloads require an explicit caller capability. A presigned GET remains usable until expiry even if the database state changes; section 18 records the policy decision needed before enabling it.
- Object keys from `{callerId}/{prefix}/{fileId}`, generated server-side only; filenames are display metadata, validated for length/encoding/NUL but never used as a path.
- Quotas: the lifecycle module reserves `bytes_reserved` at upload start, converts it to `bytes_used` on completion, releases it on abort/expiry, and maintains `file_count`. A scheduled task requests reconciliation through the same module.

## 11. File lifecycle

The file lifecycle module owns the state machine: `initiated → uploading → uploaded → quarantined → scanning → clean/infected/rejected/failed → deleted`. Every transition checks the expected status and `row_version` in PostgreSQL; exactly one row must change. A scan verdict never makes an object downloadable by itself. Only a verified clean object followed by a committed transition to `clean` permits a download.

Its implementation owns upload completion, sealing, scan handoff, promotion, abort/expiry, deletion, and recovery ordering. Routes, workers, and sweepers call into this module instead of duplicating transition rules. The scanner owns the checks that produce a verdict; the lifecycle module owns what that verdict changes. Keep scan checks together in the first worker. Extract a separate scan-verdict module only if initial scans and rescans become distinct callers of the same policy.

Test lifecycle behavior through its interface using a real test database and a controllable storage adapter. Cover retries and crashes between storage operations and database commits, duplicate completion and verdict delivery, stale ETags, quota release, and denial of download before `clean`. These tests should assert stored state and observable file access, not internal call order.

## 12. Registration and API keys — Drizzle schema

Binding database conventions:

- Driver is `postgres` (postgres.js) via `drizzle-orm/postgres-js`; `pg` is never installed or imported.
- Every table lives in the named schema `fms` (`pgSchema('fms')`), never `public`. Migrations, queries, and raw SQL are schema-qualified.
- `drizzle-orm` and `drizzle-kit` are pinned to `1.0.0-rc.5-5935859` in the workspace catalog.
- Column helpers `generateUuid`, `generateTimestamps`, and `generateTimestampsWithAudit` live in the database package with the same shape as buildr's `packages/database/src/helpers` and are used on every table whose columns match; do not fork them or hand-roll equivalent columns. Tables whose timestamp shape differs keep explicit columns.
- Every table declares explicit indexes in the `pgTable` third argument. Partial indexes, multi-column `CHECK`s, and transition constraints go in a handwritten SQL migration next to the drizzle-kit output.

```ts
import {
  pgSchema,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  smallint,
  customType,
  index,
} from 'drizzle-orm/pg-core';
import { generateTimestamps, generateUuid } from '../helpers';

const schema = pgSchema('fms');

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

export const storageBackends = schema.pgTable(
  'storage_backends',
  {
    id: generateUuid('id'),
    name: text('name').notNull().unique(),
    kind: text('kind', { enum: ['rustfs', 'minio', 's3'] }).notNull(),
    endpoint: text('endpoint').notNull(),
    region: text('region').notNull().default('us-east-1'),
    quarantineBucket: text('quarantine_bucket').notNull(),
    cleanBucket: text('clean_bucket').notNull(),
    forensicBucket: text('forensic_bucket'),
    credentialRef: text('credential_ref').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    status: text('status', { enum: ['active', 'read_only', 'disabled'] })
      .notNull()
      .default('active'),
    ...generateTimestamps(),
  },
  (table) => [index('storage_backends_status_idx').on(table.status)],
);

export const callers = schema.pgTable(
  'callers',
  {
    id: generateUuid('id'),
    name: text('name').notNull().unique(),
    kind: text('kind', { enum: ['app', 'admin'] })
      .notNull()
      .default('app'),
    status: text('status', { enum: ['pending_verification', 'active', 'suspended', 'disabled'] })
      .notNull()
      .default('active'),
    signupSource: text('signup_source', { enum: ['admin', 'self_signup'] })
      .notNull()
      .default('admin'),
    ownerEmail: text('owner_email'),
    ownerVerifiedAt: timestamp('owner_verified_at', { withTimezone: true }),
    createdBy: uuid('created_by'),
    maxFileSizeBytes: bigint('max_file_size_bytes', { mode: 'number' })
      .notNull()
      .default(1_073_741_824),
    allowedContentTypes: text('allowed_content_types').array().notNull().default([]),
    quotaBytes: bigint('quota_bytes', { mode: 'number' }),
    rateLimitPerSec: integer('rate_limit_per_sec'),
    allowDirectUpload: boolean('allow_direct_upload').notNull().default(false),
    allowDirectDownload: boolean('allow_direct_download').notNull().default(false),
    retentionDays: integer('retention_days'),
    ...generateTimestamps(),
  },
  (table) => [index('callers_status_idx').on(table.status)],
);

export const callerCredentials = schema.pgTable(
  'caller_credentials',
  {
    id: generateUuid('id'),
    callerId: uuid('caller_id')
      .notNull()
      .references(() => callers.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    kind: text('kind', { enum: ['standard', 'restricted'] })
      .notNull()
      .default('standard'),
    keyPrefix: text('key_prefix').notNull(),
    keyId: text('key_id').notNull().unique(),
    secretHash: bytea('secret_hash').notNull(),
    pepperVersion: smallint('pepper_version').notNull(),
    scopes: text('scopes').array().notNull().default([]),
    allowedCidrs: text('allowed_cidrs').array().notNull().default([]),
    allowedTypes: text('allowed_types').array().notNull().default([]),
    maxFileSizeBytes: bigint('max_file_size_bytes', { mode: 'number' }),
    rateLimitPerSec: integer('rate_limit_per_sec'),
    createdBy: uuid('created_by'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedReason: text('revoked_reason'),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('caller_credentials_caller_id_idx').on(table.callerId)],
);

export const setupCodes = schema.pgTable(
  'setup_codes',
  {
    id: generateUuid('id'),
    callerId: uuid('caller_id')
      .notNull()
      .references(() => callers.id, { onDelete: 'cascade' }),
    codeHash: bytea('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('setup_codes_caller_id_idx').on(table.callerId)],
);

export const serviceSettings = schema.pgTable('service_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: uuid('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const files = schema.pgTable(
  'files',
  {
    id: generateUuid('id'),
    callerId: uuid('caller_id')
      .notNull()
      .references(() => callers.id),
    storageBackendId: uuid('storage_backend_id')
      .notNull()
      .references(() => storageBackends.id),
    ownerRef: text('owner_ref'),
    objectKey: text('object_key').notNull(),
    originalFilename: text('original_filename').notNull(),
    declaredContentType: text('declared_content_type'),
    detectedContentType: text('detected_content_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    checksumSha256: bytea('checksum_sha256'),
    etag: text('etag'),
    sealedEtag: text('sealed_etag'),
    status: text('status', {
      enum: [
        'initiated',
        'uploading',
        'uploaded',
        'quarantined',
        'scanning',
        'clean',
        'infected',
        'rejected',
        'failed',
        'deleted',
      ],
    })
      .notNull()
      .default('initiated'),
    statusReason: text('status_reason'),
    scanPolicyVersion: text('scan_policy_version'),
    idempotencyKey: text('idempotency_key'),
    metadata: jsonb('metadata').notNull().default({}),
    legalHold: boolean('legal_hold').notNull().default(false),
    retainUntil: timestamp('retain_until', { withTimezone: true }),
    rowVersion: integer('row_version').notNull().default(1),
    ...generateTimestamps(),
    uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
    scannedAt: timestamp('scanned_at', { withTimezone: true }),
    promotedAt: timestamp('promoted_at', { withTimezone: true }),
    purgeAfter: timestamp('purge_after', { withTimezone: true }),
  },
  (table) => [
    index('files_caller_status_idx').on(table.callerId, table.status),
    index('files_status_purge_after_idx').on(table.status, table.purgeAfter),
    index('files_storage_backend_id_idx').on(table.storageBackendId),
    index('files_object_key_idx').on(table.objectKey),
  ],
);
```

Indexes, uniqueness rules, and `CHECK`s that Drizzle's table API cannot express — the partial unique `(caller_id, idempotency_key)` on `files`, the live-credential lookup (`WHERE revoked_at IS NULL AND expires_at > now()`), the single-`is_default` backend rule, retention/purge sweeper partial indexes, and multi-column `CHECK`s — go in handwritten SQL migrations alongside the generated one, schema-qualified to `fms`. Every index is chosen from a real query pattern (auth lookup, list-by-caller, sweeper scans, claim query); no table ships without at least the indexes its read paths need.

Specify the required uniqueness and transition constraints for the remaining tables (`upload_sessions`, `upload_parts`, `scan_jobs`, `scan_results`, `caller_usage`, `audit_events`), with their indexes, before implementing the lifecycle module.

## 13. API surface (H3 route files)

Nitro maps file paths under `server/routes/` (or `server/api/`) to routes, with `[id]` for params and `.post.ts`/`.get.ts` suffixes for methods.

```text
server/
  routes/
    v1/
      uploads/
        index.post.ts              # POST /v1/uploads
        [id]/
          content.put.ts           # PUT /v1/uploads/{id}/content
          parts/
            [n].put.ts             # PUT /v1/uploads/{id}/parts/{n}
          index.get.ts             # GET /v1/uploads/{id}
          grants.post.ts           # POST /v1/uploads/{id}/grants
          complete.post.ts
          abort.post.ts
      files/
        index.get.ts                # GET /v1/files
        [id]/
          index.get.ts
          content.get.ts
          index.delete.ts
      callers/
        index.post.ts
        [id]/
          index.patch.ts
          suspend.post.ts
          keys/
            index.post.ts
            index.get.ts
            [keyId]/
              rotate.post.ts
              index.delete.ts
      signup/
        index.post.ts
        redeem.post.ts
      admin/
        files/[id]/rescan.post.ts
        settings/signup.get.ts
        settings/signup.patch.ts
  middleware/
    auth.ts                        # runs on every request, sets event.context.caller
  tasks/
    sweep-expired-sessions.ts      # Nitro scheduled task
    sweep-stale-files.ts
    purge-deleted.ts
    reconcile.ts
    rescan-outdated-policy.ts
```

Plus `healthz.get.ts` and `readyz.get.ts` outside `/v1`.

## 14. Idempotency, health checks

Use an `Idempotency-Key` header on `POST /v1/uploads`, `complete`, and `abort`, scoped per caller. The lifecycle module handles duplicate requests and returns the original outcome. Define persistence and uniqueness for each operation before implementation; a single unique `(caller_id, idempotency_key)` index on `files` only covers upload creation. `/healthz` checks only that the process is up; `/readyz` checks Postgres (and optionally a lightweight storage HEAD), each tracked as a separate signal rather than one boolean.

## 15. Observability

- `@opentelemetry/sdk-node` initialized before the Nitro server starts (a small bootstrap script loaded via Nitro's `unenv`/plugin hooks, or a `--require` preload), auto-instrumenting `http`, postgres.js (Drizzle's driver), and the AWS SDK v3 client.
- Export via OTLP to the same collector RustFS/MinIO's storage node pushes to, if the backend supports OTLP; otherwise correlate via request IDs.
- Metrics and alerts cover upload/download throughput and latency, queue depth, scan latency, infection counts, signature age, failed auth, DB pool usage, and storage latency. A scheduled canary uploads, waits for scanning, downloads, and verifies the checksum.

## 16. Background jobs

Nitro's built-in scheduled tasks (`nitro.config.ts` → `scheduledTasks`) cover the lightweight sweepers (expired sessions, stale files, retention, purge, expired setup codes, unverified-app cleanup). Scanning workers are **not** scheduled tasks — they're long-running processes that poll the queue continuously, run separately from the API and the task scheduler, and scale independently.

## 17. Queue, pooling, migrations

- Queue: Postgres scan jobs. The lifecycle module enqueues jobs with the state transition; workers claim them with `SELECT ... FOR UPDATE SKIP LOCKED` through Drizzle's `sql` template. Keep the claim query inside the worker implementation rather than adding a queue interface with one adapter.
- Connection pooling: `postgres` (postgres.js) through `drizzle-orm/postgres-js`, sized modestly per instance; no PgBouncer needed at this scale.
- Migrations: `drizzle-kit@1.0.0-rc.5-5935859` generates migrations from schema diffs against the `fms` schema; handwritten SQL migrations carry the partial indexes and multi-column constraints; both run as a separate CI/CD step (`drizzle-kit migrate`), never on Nitro boot.

## 18. Compliance, backups, starting defaults, testing, build order, invariants

Audit events are append-only. Run backup and restore drills for PostgreSQL and storage together. Starting defaults are 1 GiB maximum file size, 16 MiB parts, 15-minute upload passes, 24-hour `incoming/` lifecycle, and 180-day API key expiry. Load and failure tests must include interrupted uploads, worker restarts, storage copy failure, database commit failure, duplicate requests, and backend compatibility.

This TypeScript plan still lacks the full registration rules, the remaining table definitions and constraints, the build order, and the complete invariant list from the earlier Rust plan. Bring those decisions into this document before implementing the affected features. The safety invariants already stated here are binding: only PostgreSQL `clean` files may be downloaded; scan workers only read sealed objects; promotion verifies the sealed object and clean copy before `clean`; and lifecycle transitions are guarded and safe to retry.

Direct downloads remain disabled until their revocation rule is chosen. Decide whether a link may remain valid for its 1-5 minute lifetime after a file loses `clean` status. If immediate revocation is required, serve downloads through the API instead of issuing presigned GETs. Document the chosen rule alongside the authorization policy before enabling direct downloads.

## 19. What changes if you swap RustFS for MinIO or AWS S3 later

The internal S3 adapter selects a backend from each file's `storage_backend_id`. Before adding RustFS, MinIO, or AWS S3 as an active backend, test presigned PUT content-length behavior, conditional copy support, multipart minimums, range reads, and ETag behavior against that deployment. Then add its `storage_backends` row and credentials. Existing files remain tied to their original backend; moving them is a separate migration with verification. Route and worker code does not change when the same adapter passes those tests.
