# Thread: Orchestrator Drift - Self Improvement (IN PROGRESS)

Date: 2026-03-16
Status: IN_PROGRESS

## Incident

New planning artifacts were written into `docs/` (for example `docs/RESEARCHER_MCP_*.md`) instead of using the vault-native planning memory and the configured task-wave workflow (`vault/` + `vault/sprint/`).

## Impact

- Canonical planning memory drifted out of `vault/`, making it harder for agents to find the source of truth.
- The workflow configuration was effectively bypassed, increasing the chance of inconsistent execution later.

## Root Cause

- I did not follow the repo's configured workflow after loading the task-wave skill.
- I treated `docs/` as a planning destination instead of a publish/reference location.

## Guardrail (Do This Next Time)

- When creating or updating planning memory, write it to `vault/ai/docs/`.
- If you must produce a non-vault artifact (like `docs/`), first create a vault thread that explains why, and link the non-vault artifact from `vault/ai/docs/index.md`.
- Keep `vault/sprint/` as the execution system; do not mix planning memory into `docs/`.

## Corrective Action (This Change)

- Add the missing vault scaffold (`vault/README.md`, `vault/ai/*` indexes).
- Create vault-native versions of the Researcher MCP planning docs under `vault/ai/docs/` and treat them as canonical.

## Next Action

- Deprecate `docs/RESEARCHER_MCP_*.md` as planning memory by adding a short banner in those files pointing to the canonical `vault/ai/docs/` versions (do this in a later, explicit docs-only change).
