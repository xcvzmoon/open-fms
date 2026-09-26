# Open FMS — TODO

- [x] **T1** Scaffold `apps/api` (Nitro standalone) and `packages/database`; pin `drizzle-orm`/`drizzle-kit` `1.0.0-rc.5-5935859` + `postgres` (postgres.js) in the workspace catalog
- [x] **T2** Database core: postgres.js client, `pgSchema('fms')`, buildr-style helpers (`generateUuid`, `generateTimestamps`, `generateTimestampsWithAudit`) with JSDoc on exports
- [x] **T3** Define all tables with indexes: registration/credentials/files plus `upload_sessions`, `upload_parts`, `scan_jobs`, `scan_results`, `caller_usage`, `audit_events`
- [ ] **T4** Migration pipeline: `drizzle-kit generate` against the `fms` schema + handwritten SQL for partial indexes/check constraints, wired as a CI-only step (never on boot)
- [ ] **T5** Complete PLAN.md gaps: full registration rules, build order, complete invariant list, presigned-GET revocation decision
- [ ] **T6** Auth: H3 middleware, HMAC-SHA256 key hashing with versioned pepper, `timingSafeEqual`, LRU key cache, cross-instance rate limiting
- [ ] **T7** Registration flows: setup codes, admin approval, allowlisted `self_signup`, API key rotation/revocation, upload passes
- [ ] **T8** Storage adapter: one AWS SDK v3 S3 adapter, backend selection by `storage_backends` row, presigner, path-style config, no SDK imports outside the adapter
- [ ] **T9** File lifecycle module: guarded state machine with `row_version`, sealing, atomic enqueue transaction, promotion, abort/expiry, quota reserve/release — the single test surface
- [ ] **T10** Upload routes: streaming proxy single (body + in-flight SHA-256), part-based resumable, direct presigned PUT, complete/abort with `Idempotency-Key`
- [ ] **T11** Scan worker: `FOR UPDATE SKIP LOCKED` claim, SHA-256, `file-type` sniff, structure/archive-bomb checks, ClamAV `INSTREAM`, verdict submitted to lifecycle only
- [ ] **T12** Downloads: `clean`-state gate, proxy stream with range headers, short presigned GET behind caller capability (enabled only after revocation policy is documented)
- [ ] **T13** Scheduled sweepers: stale files, expired sessions/codes, retention, purge, reconcile (all through the lifecycle module)
- [ ] **T14** Health and observability: `/healthz` and `/readyz` as separate signals, OTel bootstrap before server start, metrics + scheduled canary upload/scan/download
- [ ] **T15** Tests: lifecycle interface tests on a real test DB with controllable storage — crashes/retries between storage and DB, duplicate completions, stale ETags, quota release, download denial before `clean`
- [ ] **T16** Verification pass: `vp run check` → `typecheck` → `test` → `build` all green; backend compatibility tests (PLAN.md §19) before enabling any S3 deployment
