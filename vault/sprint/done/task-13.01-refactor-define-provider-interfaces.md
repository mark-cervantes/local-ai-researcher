---
id: "13.01"
title: "Define provider interfaces and align concrete providers"
type: refactor
priority: high
complexity: M
difficulty: moderate
sprint: 4
depends_on: []
blocks: ["13.02"]
branch: "refactor/task-13-provider-interfaces"
assignee: dev
enriched: true
---

# Task 13.01: Define Provider Interfaces And Align Concrete Providers

## Business Requirements

### Problem
The provider layer is currently typed against concrete implementations, which makes the integration boundary harder to evolve even when behavior is already stable. The product needs an explicit provider contract so future provider substitutions can happen without reopening tool behavior or the MCP surface.

### User Story
As the maintainers of the research server, I want stable search and reader provider interfaces so that provider integrations can be typed through a shared contract without changing delivered behavior.

### Acceptance Criteria
- [ ] A shared provider contract exists for search and reader capabilities, including normalized provider health and provider identity fields for both lanes.
- [ ] The existing SearXNG provider satisfies the search provider contract without changing search results, health behavior, or runtime defaults.
- [ ] The existing Jina Reader provider satisfies the reader provider contract without changing read results, health behavior, or runtime defaults.
- [ ] TypeScript compilation succeeds after the interface contract is introduced.
- [ ] The existing automated test suite passes unchanged after the provider contract is introduced.

### Business Rules
- This task is a type-layer refactor only and must not introduce fallback chains, alternate providers, new configuration, or MCP contract changes.
- Provider identity must be available through the shared contract rather than through tool-local hardcoded values.
- Existing provider behavior remains the source of truth; this task formalizes the contract but does not redesign it.

### Out of Scope
- Adding a second search provider or reader provider.
- Changing provider request logic, error handling semantics, or health semantics.
- Changing operator configuration or environment requirements.

---

## Architecture Notes

**Axis**: Type boundary — introducing explicit provider contracts without behavioral change.

**Pattern**: Interface extraction with structural typing. TypeScript's structural type system means the existing provider classes may already satisfy the interface shape structurally; the `implements` keyword makes the contract explicit and enforces it at compile time.

**Rationale**: The provider layer currently couples consumers to concrete implementations. An explicit interface contract decouples the "what" (capabilities) from the "who" (implementation), enabling future provider substitution without reopening tool logic. This is a pure type-layer refactor — zero runtime behavior changes.

**Constraints this creates**:
- All future providers must implement the same interface contract
- `ProviderHealth.status` union is now locked; adding new states requires interface revision
- Provider-local option types (`SearxngSearchOptions`, `JinaReaderOptions`) remain for internal use, but the interface uses domain types (`SearchOptions`, `ReadOptions`) — this is intentional: the interface defines the public contract, implementations can narrow internally

**Key type compatibility notes**:
1. **SearxngProvider.checkHealth()** currently returns `{ status: 'connected' | 'unavailable' | 'error'; ... }` (no 'degraded'). TypeScript permits this: narrower return unions are assignable to wider interface unions (return type covariance).
2. **JinaReaderProvider.checkHealth()** already includes 'degraded' in its status union — structurally identical to `ProviderHealth`.
3. Both providers use local option types internally; the interface uses `SearchOptions`/`ReadOptions` from domain/types.ts. These domain types are structural supersets, so the interface is permissive — implementations may ignore extraneous fields.

---

## Affected Areas

**New file**:
- `src/providers/interfaces.ts` — defines `ProviderHealth`, `SearchProvider`, `ReaderProvider`

**Modified files**:
- `src/providers/searxng.ts`:
  - Add `import { SearchProvider, ProviderHealth } from './interfaces.js'`
  - Add `implements SearchProvider` to class declaration
  - Add `get id(): string { return 'searxng'; }`
  - Annotate `checkHealth()` return type as `Promise<ProviderHealth>` (current inline type is structurally compatible)

- `src/providers/jinaReader.ts`:
  - Add `import { ReaderProvider, ProviderHealth } from './interfaces.js'`
  - Add `implements ReaderProvider` to class declaration
  - Add `get id(): string { return 'jina-reader'; }`
  - Annotate `checkHealth()` return type as `Promise<ProviderHealth>` (current inline type already matches)

**Imports to add to interfaces.ts**:
- `import type { SearchOptions, ReadOptions, SearchResult, ReadResult } from '../domain/types.js'`

---

## Quality Gates

1. **TypeScript compilation succeeds**: `npx tsc --noEmit` exits 0 after interface introduction
2. **All 463 tests pass**: `npm test` exits 0 with no test file modifications
3. **No runtime behavior change**: `checkHealth()` semantics unchanged — 'degraded' was already implemented by JinaReaderProvider; SearxngProvider intentionally omits it (no slow-response detection logic)
4. **Interface satisfaction verified**: TypeScript compiler confirms both classes satisfy their respective interfaces when `implements` is added

---

## Gotchas

1. **Getter vs method**: `id` and `name` are readonly getters (`get id(): string`), not fields. Ensure consistent accessor syntax — `get id() { return '...'; }` not `id = '...'`. The interface declares `readonly id: string` which permits either, but existing `name` uses getter syntax.

2. **Import path suffix**: This project uses ESM with `.js` extension in import paths (`from './interfaces.js'`), even though source files are `.ts`. TypeScript compiler requires this for ESM compatibility.

3. **Options type narrowing**: The interface uses domain `SearchOptions`/`ReadOptions` which include fields providers may not use (e.g., `sources` in SearchOptions). This is acceptable — structural typing permits consumers to pass the wider type; implementations simply ignore irrelevant fields. Do NOT change provider-local option types to domain types; keep them for internal documentation of what each provider actually consumes.

---

## Changes
- `src/providers/interfaces.ts` — new
- `src/providers/interfaces.test.ts` — new
- `src/providers/searxng.ts` — modified (implements SearchProvider, get id())
- `src/providers/jinaReader.ts` — modified (implements ReaderProvider, get id())
