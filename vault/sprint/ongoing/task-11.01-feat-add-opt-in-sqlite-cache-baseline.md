---
id: "11.01"
title: "Add opt-in SQLite cache baseline"
type: feat
priority: medium
complexity: M
difficulty: complex
sprint: 5
depends_on: ["10.01"]
blocks: ["11.02"]
parent: "11"
branch: "feat/task-11-optional-sqlite-cache"
assignee: dev
enriched: true
rmcp_id: "RMCP-05-A"
---

# Task 11.01: Add Opt-In SQLite Cache Baseline

## Business Requirements

### Problem
The approved v1 direction now includes optional SQLite cache support, but the legacy sprint artifacts did not describe it cleanly. The release plan needs a cache baseline that is additive and disabled by default.

### User Story
As an operator, I want to enable SQLite caching only when I choose to so that the default server remains simple while an opt-in performance path is still available.

### Acceptance Criteria
- [ ] The product supports a SQLite-backed cache mode that can be enabled by explicit operator configuration.
- [ ] Cache behavior is disabled by default for a fresh v1 setup.
- [ ] When cache is disabled, tool behavior matches the frozen uncached v1 contract.
- [ ] Cache-enabled behavior preserves the same response shape and provenance fields expected by the frozen schema.

### Business Rules
- SQLite cache is optional v1 scope.
- Default startup must remain uncached.
- Cache enablement must be operator-controlled rather than automatic.

### Out of Scope
- Distributed caching.
- Background crawling or persistent indexing.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Architecture Notes

**Axis: State lifecycle** — Cache adds optional persistence layer without changing the default uncached behavior.

**Pattern: Feature-flagged-cache-layer** — Cache is implemented as a wrapper around provider calls, enabled only by explicit configuration.

**Rationale:** Optional cache provides performance benefit without adding complexity to the default path. Disabled-by-default ensures clean baseline.

**Constraints this creates:**
- Cache implementation must not affect uncached behavior (zero overhead when disabled)
- Cache key scheme must be stable (URL + content_mode + relevant params)
- Cache responses must include `cache_hit` metadata

## Affected Areas

- `src/lib/cache.ts` — new module: SQLite-backed cache with get/set/invalidate operations
- `src/config.ts` — add `cache.enabled` (default: false), `cache.path`, `cache.ttl`
- `src/providers/searxng.ts` — optional cache wrapper for search results
- `src/providers/jinaReader.ts` — optional cache wrapper for read results (key must include content_mode)
- `src/tools/gather.ts` — optional cache integration for aggregate results
- `src/domain/types.ts` — add `cache_hit` and `cache_key` to response metadata

## Quality Gates

- Fresh startup with default config: cache is disabled, no SQLite file created
- Cache disabled: tool behavior identical to pre-cache implementation (verify with existing tests)
- Cache enabled: repeated identical request returns cached response with `cache_hit: true`
- Cache key includes: URL, content_mode, any params affecting response shape
- Cache TTL enforced: expired entries return fresh results
- SQLite file location configurable via `cache.path`

## Gotchas

- Cache key must include `content_mode` — full vs excerpt are different cache entries
- `gather` cache key is complex (query + options); consider caching constituent reads separately
- SQLite concurrent access: use WAL mode or appropriate locking for Node.js single-threaded model
- Cache should not store error responses (or store with short TTL)
