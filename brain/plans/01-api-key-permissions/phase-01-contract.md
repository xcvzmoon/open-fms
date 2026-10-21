# 1. Define the permission contract

Back to [[plans/01-api-key-permissions/overview]]

## Goal and structures

Define `apiKeyPermissionsSchema` and inferred `ApiKeyPermissions` once. Place them in `packages/database/src/auth/permissions.ts`, beside the stored auth model, so both database rotation reads and HTTP validation can reuse them without a database-to-API dependency.

## Changes

- Add `packages/database/src/auth/permissions.ts`: a small Valibot schema admitting only optional `uploads/write` and `files/read` grants, with at least one action overall. Reject unknown resources/actions and empty grants; no grant defaults.
- Export the schema and inferred type from `packages/database/src/index.ts`.
- Add `packages/database/tests/api-key-permissions.test.ts` for the contract.

## Verification

Static: typecheck the exports and consumers; no assertions or broad generic permission aliases.

Runtime: test read-only, write-only, combined grants, empty grants, and unsupported resources/actions. Schema failures must not become permissive defaults. Run the focused tests and lint.

Routing: current configured agent; focused implementation. Depends on no other phase.
