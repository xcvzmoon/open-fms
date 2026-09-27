# @open-fms/database

PostgreSQL schema and query layer for Open FMS.

## Contents

- `src/schema.ts` — named schema `fms`
- `src/helpers/` — `generateUuid`, timestamp helpers
- `src/tables/` — registration, files, uploads, scanning, usage, auth tables
- `src/queries/` — callers, files, scan jobs, registration, sweeps, reconcile, health
- `src/security/` — token hashing and email domain allowlist
- `migrations/` — generated and handwritten SQL

## Conventions

- All tables live in schema `fms`.
- Use the shared helpers for UUIDs and timestamps when the shape matches.
- Partial indexes and multi-column checks go in handwritten migrations.
- Never run migrations from the API process.

## Scripts

```bash
vp run build --filter @open-fms/database
vp run --filter "@open-fms/database" generate
vp run --filter "@open-fms/database" migrate
vp run --filter "@open-fms/database" check
```

`DB_URL` is required for migrate and for importing the live client.
