# Simplify API key permissions

Status: implemented and audited; deployment pending. Created: 2026-10-22.

Evidence: [[plans/01-api-key-permissions/audit]]. Issuance, rotation, and HTTP tests share one disposable fixture in `apps/api/tests/api-key-permissions.integration.test.ts`. Shared HTTP process helpers live in `apps/api/tests/http-fixture.ts`.

## Decision

Use Better Auth's existing `auth_api_keys.permissions` field for grants and its `verifyApiKey` permission check for resource authorization. Remove FMS scope storage from application code. Keep caller eligibility, CIDRs, MIME types, size limits, quotas, caller rate limits, and audited credential lifecycle in FMS.

Accept native `permissions` in the admin issuance API: `uploads` permits only `write`; `files` permits only `read`. Require at least one grant. Remove the old `scopes` input rather than supporting both. No web UI or custom key-list route exists in this checkout.

## Evidence and principles

- Installed Better Auth and API key plugin both resolve to 1.7.6. The installed implementation in `apps/api/node_modules/@better-auth/api-key/dist/index.mjs` supports permissions on creation and verification, serializes them on storage, and returns parsed grants on successful verification.
- Missing or insufficient permissions return `valid: false`, `key: null`, and `KEY_NOT_FOUND`. Required permissions are checked before request-limit consumption. Verification without required permissions skips this check.
- [Official permission reference](https://better-auth.com/docs/plugins/api-key/reference) documents resource/action grants and verification. The public site currently describes 1.7.12; installed 1.7.6 source governs this plan.
- Apply AGENTS.md principles: smallest correct change, dependencies before custom implementations, validate at boundaries, no compatibility layers or data-conversion migrations, and retain a working product during development.
- `brain/` and its principles index did not exist at planning time. This plan uses the supplied AGENTS.md and CONTEXT.md rather than inventing principle notes or links.

## Alternatives

1. Keep custom scopes. Lowest change risk, but leaves authorization duplicated outside the plugin.
2. Populate plugin permissions while retaining FMS scopes. Rejected: two sources can disagree and rotation must synchronize both.
3. Use native permissions throughout. Chosen: one stored grant representation and one authorization engine. The issuance API changes deliberately; its callers must change with it.

Keeping the existing scope-string API would require translation in issuance and rotation. Native permissions avoid that extra mapping for two simple grants. No generic permission framework or new dependency is needed.

## Behavioral contract

- Verify each API key once, supplying the route's required permissions. Missing/insufficient permissions return HTTP 401 `AUTH_REQUIRED`, matching the installed plugin's indistinguishable failure result. This deliberately replaces today's scope-denied 403.
- Preserve 403 responses for FMS policy denial and admin/session restrictions. Do not invent an error-code distinction that the plugin does not provide. Do not add a second verification to recover 403.
- Preserve route requirements: upload GET/HEAD require `files/read`; upload mutations require `uploads/write`; file routes require `files/read`. Keep required upload classification available for the restricted-MIME check after removing the scope comparison.
- Routes currently returning no required scope keep that behavior. Review each route explicitly; do not introduce unrelated authorization changes. Admin and signup API-key rejection remains before verification.
- Rotation copies grants from the linked Better Auth key after caller ownership and credential validity checks. Missing, malformed, or empty stored grants fail with a stable application error; no inferred defaults.
- Public Better Auth mutation paths remain disabled. API keys continue to have no session impersonation. Database storage and synchronous updates remain configured.

## Cutover and schema boundary

Existing keys were created without plugin permissions. They cannot be assumed to work after this change. Before rollout, inventory credential counts and owning callers without exposing secrets. Schedule fresh issuance with explicit grants and revoke superseded credentials. Existing clients must adopt the new issuance contract; service requests still use `x-api-key`.

No backfill, legacy scope fallback, or compatibility migration is included. Never rotate a legacy key into inferred permissions. An administrator must issue its replacement with explicit permissions. Coordinate replacement delivery and activation as a maintenance cutover; existing endpoints cannot pre-provision native grants before the new code is deployed. This plan does not promise zero downtime.

The Better Auth permissions column already exists. Remove `scopes` from the current Drizzle model, selects, inserts, and runtime types. CI regenerates database migrations and rejects schema drift, so include a generated drop-only schema migration for `caller_credentials.scopes`. Historical migrations remain unchanged. This replaces the original proposal to leave the unused column behind; no grant backfill or compatibility migration is added. Validate the complete history on a disposable database. Do not apply this migration to an existing deployment during implementation.

Develop the phases on one branch and release the complete change together. Intermediate phases are review boundaries, not independently deployable releases. Do not deploy mixed old/new API instances. Do not wipe databases or issue/revoke real credentials while implementing or validating this plan.

## Phases

1. [[plans/01-api-key-permissions/phase-01-contract]]
2. [[plans/01-api-key-permissions/phase-02-issuance]]
3. [[plans/01-api-key-permissions/phase-03-rotation]]
4. [[plans/01-api-key-permissions/phase-04-verification]]
5. [[plans/01-api-key-permissions/phase-05-remove-scopes]]
6. [[plans/01-api-key-permissions/phase-06-fixtures]]
7. [[plans/01-api-key-permissions/phase-07-http-proof]]
8. [[plans/01-api-key-permissions/phase-08-docs-and-gate]]

## Verification and execution

Use better-auth-best-practices, ts-best-practices, valibot, drizzle, nitro, testing, vitest, xcvzmoon-code-conventions, and unslop as applicable. Use the current configured provider/model; the plan requires no model override. Follow the repository's Vite+ commands, never the package manager directly. Do not commit or push unless explicitly requested.

Run `vp install` before implementation checks. Final gate, in order: `vp run check`, `vp run typecheck`, `vp run test`, `vp run build`. Check integration prerequisites in each test; report skips separately from passes. Prove permissions and rotation against a disposable PostgreSQL database and the real installed plugin, without module mocking. Existing built HTTP tests also require their opt-in environment and local storage fixture.

Done means one permission store and verifier, preserved FMS restrictions, rotation preserving exact grants, no obsolete runtime scopes contract, documented 401 and reissuance behavior, and the full verification gate passing with integration results reported honestly.
