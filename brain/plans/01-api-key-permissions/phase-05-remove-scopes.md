# 5. Remove application scope storage

Back to [[plans/01-api-key-permissions/overview]]

## Goal and structures

Leave `caller_credentials` responsible only for FMS credential policy and lifecycle. Better Auth is the sole grant authority.

## Changes

- Remove `scopes` from `packages/database/src/tables/registration.ts`.
- Remove it from `CallerCredentialPolicy`, query projection, and the ownership comment in `packages/database/src/queries/callers.ts`.
- Remove it from `CredentialPolicyInput` and credential persistence in `packages/database/src/queries/registration.ts`. Ensure rotation already reads native grants.

## Verification

Static: inspect the diff for accidental edits to expiry, revocation, audits, or caller policies. Search production TypeScript for obsolete scopes consumers.

Runtime: exercise issue/load/revoke/rotate using an existing migration-created disposable database. Generate a drop-only schema migration for the removed scopes column; CI requires migration snapshots to match the Drizzle model. Apply the full migration history only to a disposable fixture. Do not backfill grants, rewrite old migrations, push a schema, or reset an existing database.

Routing: current configured agent; mechanical cleanup after phases 2–4. Fixture compilation is restored in phase 6 before the branch is released.

Implementation note: the generated schema migration and snapshot are required files in addition to the three source files above.
