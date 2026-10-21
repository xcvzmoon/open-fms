# 7. Prove the HTTP authorization boundary

Back to [[plans/01-api-key-permissions/overview]]

## Goal and structures

Exercise the built server and real plugin so a unit-level mapping cannot hide an authorization regression.

## Changes

- Update `apps/api/tests/http-boundary.integration.test.ts`: seed native permissions on Better Auth keys; stop supplying scopes on FMS rows. Extend its existing cases without duplicating server/storage setup.
- Add `apps/api/tests/api-key-permissions.integration.test.ts` for narrowly targeted real-plugin/database behavior where it does not need the storage fixture.

## Verification

Static: follow existing opt-in database/server fixture restrictions; no module mocking and no secret logging.

Runtime groups:

1. Read-only, write-only, and combined grants enforce the exact route/method matrix; HTTP scope failures now return 401. HEAD behavior matches the route policy.
2. Null/empty permissions cannot authorize resource routes; the migrated schema has no scopes column. Unknown/expired/revoked keys remain denied.
3. CIDR and restricted MIME denial remain 403, and disabled/suspended/unverified callers remain denied despite valid grants.
4. One accepted request consumes per-key usage once; requests rejected for permissions do not consume it, matching installed plugin order. Caller-wide limits remain enforced across keys.
5. Admin issuance rejects invalid/obsolete input, returns a usable key once, and direct Better Auth mutations and API-key access to admin/signup routes remain denied.

Routing: current configured agent; integration verification. Depends on phases 2–6. Preserve the full existing tenant and file-status test coverage.
