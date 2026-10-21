# Audit resolutions

This implementation addresses the general audit and security leads recorded against
`61ce7bca28849434101bd90459c8ff2aa8a48aa2`. Original reports remain in the root
checkout's `docs/audit` directory. The implementation is on the `fix/audit-resolutions` branch.

| Finding                      | Resolution                                                                                     | Regression coverage                                                |
| ---------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Missing worker consumer      | Packaged CLI, polling, required antivirus and shutdown                                         | Clean/infected INSTREAM fixtures and SIGTERM                       |
| Discarded lifecycle patches  | Typed persisted timestamps and promotion metadata                                              | Database scan, promotion and deletion assertions                   |
| Stranded running jobs        | Token fencing, heartbeats, running-lease recovery and exhaustion                               | Lease recovery and stale-token tests                               |
| Incomplete onboarding        | Verified text user ownership, delivered setup codes, indexed redemption and operator bootstrap | Bootstrap, verification, approval and 51-code fixture              |
| Incomplete CI                | Node 26, check, typecheck, disposable integration fixtures and full build                      | Required workspace gate                                            |
| Unbounded reconciliation     | Keyset pages, four concurrent requests, cached adapters and cleanup                            | More than 1,000 rows, outages and cleanup failures                 |
| Missing retention            | Upload-time schedule, legal hold, physical deletion and quota release                          | Retention boundaries and deletion failure/retry                    |
| Administrative authorization | Verified active administrator session and trusted mutation origin                              | Policy and live HTTP tests                                         |
| Disconnected API keys        | Native keys paired with enforced policy; authoritative revocation and rotation                 | Missing/expired/revoked policy and HTTP tests                      |
| Public fixture ports         | Loopback-only ports and disposable Compose project                                             | Compose configuration and local fixture                            |
| Insecure SMTP                | Required TLS, certificate verification and explicit production configuration                   | Missing-STARTTLS and self-signed TLS fixtures                      |
| Upload accounting            | Exact reservation, streamed bodies, bounded parts and atomic delta accounting                  | Concurrent admission, overflow, truncation and stored-byte hashing |
| Obsolete upload passes       | Removed endpoint, helpers and table                                                            | Unsupported upload modes rejected                                  |

Additional hardening includes strict pepper and SMTP port parsing, reset-session
revocation, pending registration expiry, bounded mock mail retention, archive
inspection through yauzl, safe download headers and cancellation, and storage
canary reporting that distinguishes skipped probes.

## Operating contract

Each caller has one verified Better Auth owner. Service keys cannot administer
callers. Unpaired native keys fail closed. Direct upload sessions, upload passes,
and unused direct-transfer settings have been removed.

Production needs PostgreSQL migrations, configured storage buckets and credentials,
a separate scanner, ClamAV, and SMTP with valid TLS. Check storage compatibility
against the deployment provider.

The ownership constraint cannot infer identities for existing caller rows. An
existing deployment needs an explicit ownership mapping and reviewed migration
rollout before applying it. Fresh installations apply the supplied migrations
directly. Deployment remains an operator action.

ZIP inspection caps entries and declared and actual expanded bytes. Encrypted,
nested, malformed, and unsupported archives fail closed. It does not claim to
recognize every disguised archive format. See the scanner README for exact limits.

## Validation

The required sequence passed: `vp run check` → `vp run typecheck` →
`vp run test` → `vp run build`. All 244 tests across 37 files passed with
integration suites enabled against disposable loopback PostgreSQL and RustFS.
The check reports zero errors and 52 warnings, primarily sequential async work
and test helper style. The build retains Nitro's code-splitting debug-name warning.

Drizzle migration validation passed, regeneration found no schema drift, and both
new migrations applied successfully. Live tests include the built HTTP server,
packaged scanner with a local antivirus protocol fixture, and SMTP TLS rejection.
An independent source review found no remaining P1/P2 blockers in the reviewed
upload, lifecycle, queue, cleanup, and auth boundaries. These results do not certify
a production provider or replace deployment configuration checks.
