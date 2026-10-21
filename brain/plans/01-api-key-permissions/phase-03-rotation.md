# 3. Preserve grants during rotation

Back to [[plans/01-api-key-permissions/overview]]

## Goal and structures

Load the linked Better Auth grants together with the eligible FMS credential policy. Keep grants separate from `CredentialPolicyInput` in the result.

## Changes

- Update `packages/database/src/queries/registration.ts`: make `loadCredentialPolicy` read permissions from the linked `authApiKeys` row, constrained to the caller's owner/reference ID and eligible credential. Parse stored JSON using the shared schema at this boundary. Reject missing, malformed, empty, or unsupported grants with stable application errors.
- Update `apps/api/server/registration/service.ts`: rotation passes the loaded grants explicitly into issuance; never reconstruct them from legacy scopes.
- Cover rotation in `apps/api/tests/api-key-permissions.integration.test.ts`, sharing its disposable fixture and exercising the real service and plugin.

## Verification

Static: no unvalidated JSON assertion; use the existing schema and database error conventions. Keep transaction and owner checks in the existing lifecycle path.

Runtime: prove exact grant preservation, old-key rejection after successful rotation, rejection for revoked/expired credentials, rejection of missing/malformed source grants, and cross-caller denial. Failure must not revoke a working old key; include that assertion in the failure cases.

Routing: current configured agent; focused implementation. Depends on phases 1 and 2.
