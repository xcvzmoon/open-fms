# 2. Issue keys with native grants

Back to [[plans/01-api-key-permissions/overview]]

## Goal and structures

Treat permissions as authentication input alongside the FMS-only `CredentialPolicyInput`, not as a field persisted in `caller_credentials`.

## Changes

- Update `apps/api/server/routes/api/v1/callers/[id]/keys/index.post.ts`: replace `scopes` with the shared permissions schema, explicitly reject the obsolete scopes input, and preserve the restricted-upload MIME requirement using the upload grant.
- Update `apps/api/server/registration/service.ts`: pass explicit validated grants to `auth.api.createApiKey`; pass only FMS policy to credential persistence. Preserve expiry, per-key limits, and cleanup after persistence failure.
- Cover issuance in `apps/api/tests/api-key-permissions.integration.test.ts` using a disposable database and actual auth/service calls.

## Verification

Static: typecheck the issuance input separately from FMS persistence policy. Review the boundary against unknown/legacy input acceptance.

Runtime: prove issued grants are persisted and returned correctly, invalid input is rejected, restricted upload grants require MIME restrictions, and failed FMS persistence leaves the new key unusable. Exercise the HTTP boundary validation in phase 7 as well.

Routing: current configured agent; focused implementation. Depends on phase 1. Coordinate the policy type change with phases 3 and 5; do not release this intermediate state.
