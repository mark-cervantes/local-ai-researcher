# Researcher MCP - SRS (v1)

This is the canonical SRS summary for v1.

Source: Derived from `docs/RESEARCHER_MCP_SRS.md` (non-canonical).

## Normative Defaults

- `content_mode`: `full` (excerpting/truncation must be explicit)
- Dedup: request-scoped, enabled by default
- Cache: optional SQLite support exists; disabled by default; bypassable per request

## Tool Set (Minimum)

- `search` (SearXNG)
- `read` (jina-ai/reader)
- `gather` (search + reads + dedup)
- `health` (server + provider health)

## Contract Requirements (Highlights)

- Every tool response includes `meta` with:
  - `request_id`
  - timestamps
  - provider identifiers
  - applied limits (timeouts/max bytes/concurrency)
- `read` output must include:
  - `content_mode`
  - `content_truncated` boolean
  - applied truncation reason/limit when truncated
- `gather` output must include:
  - request-level dedup stats
  - AI-ingestible text payload + structured payload

## Security + Privacy (Mandatory)

- SSRF protection on every outbound request
- Redirect handling cannot bypass SSRF checks
- Bounded resources: timeouts, concurrency limits, max response sizes
- Redacted logging by default; no secrets and no full extracted content in logs
