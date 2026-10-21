# 8. Document the contract and verify the branch

Back to [[plans/01-api-key-permissions/overview]]

## Goal and structures

Document the final ownership boundary and finish with evidence for the complete change.

## Changes

- Update `README.md`: Better Auth owns key grants and verification; FMS owns resource and caller restrictions.
- Update `CONTEXT.md`: remove the statement that FMS stores scopes and document the same boundary.
- Update `docs/1.docs/5.security.md`: explain native issuance permissions, 401 for insufficient grants, legacy-key reissuance, rotation preservation, and the drop-only schema migration. Include a concrete native-grant request example here; do not add a compatibility path.

## Verification

Static: use unslop on prose. Check references and confirm no documentation claims zero downtime or preserved legacy keys. Review API index descriptions; update only if their existing wording becomes false.

Runtime: run `vp run check`, then `vp run typecheck`, then `vp run test`, then `vp run build`, following `vp install`. Record integration execution versus skips. Resolve failures caused by the change before calling implementation complete.

Before rollout, produce a credential inventory by counts and owners, confirm a replacement distribution window, and keep schema/data operations outside the implementation test run. A rollback requires the previous complete release and its original keys/policy; no claim of automatic rollback after revocation. Do not perform the rollout as part of this plan.

Routing: current configured agent; docs and final verification. Depends on all earlier phases. No commit or push without explicit user instruction.
