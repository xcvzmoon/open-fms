# 4. Delegate permission enforcement

Back to [[plans/01-api-key-permissions/overview]]

## Goal and structures

Replace `ResourceScope` and `requiredScope` with a typed route requirement using the shared native grants. Preserve the upload/write classification needed by FMS MIME restrictions.

## Changes

- Update `apps/api/server/auth/policy.ts`: return native requirements for the existing path/method rules. Remove the credential scope comparison from `applyCredentialPolicy`. Keep CIDR, effective size/rate limits, and restricted MIME behavior.
- Update `apps/api/server/middleware/auth.ts`: pass the requirement into the existing single `verifyApiKey` call, omitting it only for currently unscoped routes. Preserve caller eligibility and admin/session boundaries.
- Update `apps/api/tests/auth-policy.test.ts` for route requirements and FMS-only restrictions.

## Verification

Static: remove the old scope type and function imports. Inspect every current protected route against the existing classification.

Runtime: test upload GET/HEAD, upload mutations, file reads, unscoped paths, and retained FMS restrictions. HTTP permission failures are proven in phase 7. Do not use a second plugin verification or a second custom grant comparison to distinguish 403 from 401.

Routing: current configured agent; focused implementation. Depends on phases 1 and 2.
