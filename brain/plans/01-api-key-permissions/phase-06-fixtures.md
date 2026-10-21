# 6. Update FMS policy fixtures

Back to [[plans/01-api-key-permissions/overview]]

## Goal and structures

Align test fixtures with the separation between native grants and FMS policy.

## Changes

- Update `apps/api/tests/upload-service.test.ts`: remove the obsolete scopes fixture property.
- Update `packages/database/tests/auth-registration.integration.test.ts`: remove scope fields from FMS persistence input and seed native grants where a rotation read requires them.
- Update `packages/database/tests/tables.test.ts`: assert the current Drizzle model without scopes. Prove physical column removal separately against the migrated integration fixture.

## Verification

Static: typecheck fixtures against current policy types and review all remaining `scopes` search hits. Historical migrations are expected hits.

Runtime: run the focused tests, preserving caller isolation and credential eligibility assertions. Integration skips do not establish correctness; run them with their configured disposable database prerequisites.

Routing: current configured agent; focused fixture updates. Depends on phase 5.
