# Researcher MCP - Plan (Vault Canonical)

This is the canonical plan for delivering the locked v1 direction.

Source: Derived from `docs/RESEARCHER_MCP_PLAN.md` (non-canonical).

## Waves (High Level)

- Wave 0: Spike/validation (server runs locally; endpoints reachable; sample AI-ingestion output)
- Wave 1: Foundation + tool contracts + response schema + dedup/truncation policy
- Wave 2: SearXNG provider v1 (normalized search)
- Wave 3: Jina Reader provider v1 (full content default + explicit truncation)
- Wave 4: Schema freeze + contract tests
- Wave 5: Optional SQLite cache (off by default)
- Wave 6: Packaging + docs + release (`npx` / `pnpm dlx`)

## Critical Path

Wave 0 -> Wave 1 -> (Wave 2 + Wave 3) -> Wave 4 -> Wave 6

## Parallelism

- Wave 2 and Wave 3 run in parallel after Wave 1.
- Wave 6 can draft earlier, but should not finalize before Wave 4.

## Migration Into Task-Waves

- Treat `vault/ai/docs/researcher-mcp-task-skeletons.md` as the canonical backlog draft.
- When ready to execute, mint real task-wave tasks under `vault/sprint/` and keep RMCP ids in frontmatter for traceability.
