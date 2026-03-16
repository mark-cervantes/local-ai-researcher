# Researcher MCP - Task Skeletons (Vault Canonical)

These are documentation-only task skeletons intended to be migrated into `vault/sprint/` task-waves later.

Source: Condensed from `docs/RESEARCHER_MCP_TASK_SKELETONS.md` (non-canonical).

## Stable Planning IDs

- Use `RMCP-*` ids for discussion and dependency references.
- When converting into executable tasks, assign real task-wave IDs and keep `rmcp_id: RMCP-*` in frontmatter.

## Global Acceptance Baseline (v1)

- AI-ingestible outputs: structured, consistent, provenance-forward
- Full content default for reading; truncation/excerpt only when explicitly requested and clearly signaled
- Request-scoped deduplication by default where aggregation occurs
- Providers are self-hosted endpoints configured by the user
- Mandatory SSRF/resource-bound/redacted-logging baseline

## Epics (Wave Mapping)

- RMCP-00 (Wave 0): Validate end-to-end MCP stdio execution with v1 providers
- RMCP-01 (Wave 1): Define v1 tool contracts, response schema, provider boundaries, and error taxonomy
- RMCP-02 (Wave 2): SearXNG provider v1 (normalized results + failure handling)
- RMCP-03 (Wave 3): Jina Reader provider v1 (full content default + explicit truncation/excerpt)
- RMCP-04 (Wave 4): Freeze v1 schemas and enforce with contract tests
- RMCP-05 (Wave 5): Optional SQLite cache (off by default)
- RMCP-06 (Wave 6): Packaging + docs + release

## Migration Note

Before minting executable tasks, run a quick gap check against existing code so tasks become verification/completion work rather than re-implementation.
