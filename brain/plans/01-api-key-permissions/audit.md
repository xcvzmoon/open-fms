# API key permission audit

Date: 2026-10-22. Branch: `refactor/api-key-permissions`.

Back to [[plans/01-api-key-permissions/overview]].

## Result

No unresolved actionable findings in the reviewed changes. An independent read-only review and the implementation review covered authorization, ownership, rotation, failure cleanup, schema consistency, and tests. This result applies to the local diff; no deployment has occurred.

## Verified behavior

- Better Auth is the sole permission store and checks route grants once per API-key request.
- Issuance rejects obsolete scopes, unknown grants, empty grants, and restricted upload grants without MIME restrictions.
- Rotation preserves native grants and FMS policy. Cross-caller, revoked, expired, missing, and malformed credentials cannot be rotated.
- Concurrent rotation produces one successor. Failed issuance/rotation disables the unpaired key without revoking a working source key.
- CIDR, MIME, caller status, verified ownership, credential expiry, and shared caller limits remain enforced.
- Per-key counters advance once for an admitted request and do not advance on permission denial.
- API keys cannot impersonate sessions, access admin/signup routes, or use the disabled public creation endpoint.
- The generated drop-only migration removes scopes and passes the schema consistency checks. Historical migrations are unchanged.

## Necessary fixes and plan adjustments

- CI's migration-generation check requires a schema migration when the Drizzle scopes column is removed. Added a drop-only migration rather than retaining schema drift. No permission backfill or compatibility path was added.
- Built HTTP sign-in exposed a pre-existing request conversion failure: Node's native Request constructor rejected Nitro's request wrapper. `createAuthRequest` now uses the request's standard clone method and updates only the trusted IP header. Existing request unit tests and built sign-in/issuance exercise this fix.
- Integration scenarios share one real database/API fixture rather than duplicating setup across issuance and rotation suites.

## Verification

- `vp install`: passed.
- `vp run check`: passed, no formatting, lint, or type errors.
- `vp run typecheck`: passed.
- `vp run test`: 265 tests passed across 39 files, none skipped.
- `vp run build`: passed.
- `vp run --filter @open-fms/database check`: passed.
- `vp run --filter @open-fms/database generate`: no schema changes remaining.
- `git diff --check`: passed.

All integration flags were enabled: `FMS_AUTH_INTEGRATION`, `FMS_AUTH_BOUNDARY_INTEGRATION`, `FMS_HTTP_INTEGRATION`, `FMS_LIFECYCLE_INTEGRATION`, and `FMS_SCAN_INTEGRATION`. Tests used an isolated loopback PostgreSQL instance and MinIO with disposable data. Migration history was applied only to these fixtures. No module mocks were used.

## Deployment requirements

The issuance API now accepts native permissions. Existing keys without grants require fresh issuance. Insufficient permissions return 401 rather than the old scope-denied 403. The scopes-column removal is destructive; deployment needs the coordinated maintenance and backup procedure in `docs/1.docs/5.security.md`. No existing database was migrated, no real keys were issued or revoked, and no commits or pushes were made.
