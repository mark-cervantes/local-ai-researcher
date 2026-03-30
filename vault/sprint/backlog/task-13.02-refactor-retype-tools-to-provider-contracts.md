---
id: "13.02"
title: "Retype tool factories to provider contracts"
type: refactor
priority: high
complexity: M
difficulty: routine
sprint: 4
depends_on: ["13.01"]
blocks: []
branch: "refactor/task-13-provider-interfaces"
assignee: dev
enriched: true
---

# Task 13.02: Retype Tool Factories To Provider Contracts

## Business Requirements

### Problem
The tool layer and server wire-up still depend on concrete provider classes, which keeps the new provider contract from becoming the actual integration boundary. The interface refactor is only complete when gather, search, read, and health consume the shared contracts and continue returning the same externally visible behavior.

### User Story
As a maintainer, I want the tool factories and server composition typed against provider interfaces so that provider-backed tools stay behaviorally stable while depending only on the approved contracts.

### Acceptance Criteria
- [ ] The gather, search, read, and health tool factories accept the approved search and reader provider contracts instead of concrete provider classes.
- [ ] Provider provenance in tool responses is sourced from provider identity on the shared contract rather than tool-local hardcoded strings.
- [ ] Server composition continues to wire the same provider implementations into the same tools with no behavior change in the exposed MCP operations.
- [ ] TypeScript compilation succeeds after the tool and server typing changes land.
- [ ] The existing automated test suite passes unchanged after the tool and wire-up refactor lands.

### Business Rules
- This task must preserve the existing MCP contract, request flow, response shape, and runtime behavior.
- The refactor must not add provider selection logic, fallback behavior, or new operator-facing settings.
- Provider identity in tool metadata must come from the injected provider contract for every affected tool response.

### Out of Scope
- New tool capabilities or metadata fields.
- Any behavior change to gather, search, read, or health.
- Any change to release packaging, cache work, or future provider expansion scope.

---

## Architecture Notes

**Axis**: Type boundary propagation — extending interface contracts from providers to tool consumers.

**Pattern**: Interface-based dependency injection. Tool factories receive provider interfaces rather than concrete implementations, completing the decoupling started in 13.01. The factory parameters become contracts, not implementations.

**Rationale**: Task 13.01 introduced provider interfaces but tools still imported and typed against concrete classes. This task propagates the interface contract through the composition layer. The MCP surface, response shapes, and runtime behavior remain identical — only the type system sees the change.

**Constraints this creates**:
- Tool factories can no longer access concrete-class-specific properties or methods outside the interface surface
- `provider_id` and `provider_name` in response metadata must now read from the interface (`provider.id`, `provider.name`) rather than hardcoded strings
- Health tool's nullable provider parameters (`SearchProvider | null`, `ReaderProvider | null`) must remain nullable to support partial configuration

**Key compatibility notes**:
1. **Structural typing**: TypeScript permits passing concrete class instances where interfaces are expected when the class structurally satisfies the interface. Since 13.01 adds `implements` clauses, this is guaranteed at compile time.
2. **Health tool already uses instance properties**: `health.ts` lines 88, 97, 114, 123 access `provider.name` from the instance — already compatible with interface typing.
3. **Gather tool uses orchestrator identity**: `gather.ts` line 99 `provider_id: 'orchestrator'` is the gather tool's own identity (it orchestrates multiple providers), NOT a provider identity — do NOT change this.

---

## Affected Areas

**Modified files**:

- `src/tools/gather.ts`:
  - Change import: `import type { SearxngProvider }` → `import type { SearchProvider, ReaderProvider } from '../providers/interfaces.js'`
  - Remove concrete class imports (lines 22-23)
  - Factory signature: `createGatherTool(search: SearchProvider, reader: ReaderProvider, logger: Logger)`

- `src/tools/search.ts`:
  - Change import: `import { SearxngProvider }` → `import type { SearchProvider } from '../providers/interfaces.js'`
  - Factory signature: `createSearchTool(provider: SearchProvider, logger: Logger, options?: { timeoutMs?: number })`
  - Line 86: `provider_id: 'searxng'` → `provider_id: provider.id`
  - Line 87: `provider_name: 'SearXNG'` → `provider_name: provider.name`

- `src/tools/read.ts`:
  - Change import: `import { JinaReaderProvider }` → `import type { ReaderProvider } from '../providers/interfaces.js'`
  - Factory signature: `createReadTool(provider: ReaderProvider, logger: Logger, options?: { timeoutMs?: number })`
  - Line 82: `provider_id: 'jina-reader'` → `provider_id: provider.id`
  - Line 83: `provider_name: 'Jina Reader'` → `provider_name: provider.name`
  - Line 97 `provider.canRead(input.url)` — requires `canRead(url: string): boolean` on `ReaderProvider` interface

- `src/tools/health.ts`:
  - Change imports: `import type { SearxngProvider }` and `import type { JinaReaderProvider }` → `import type { SearchProvider, ReaderProvider } from '../providers/interfaces.js'`
  - Factory signature: `createHealthTool(search: SearchProvider | null, reader: ReaderProvider | null, logger: Logger)`
  - Lines 88, 97, 104, 114, 123, 130: already use `provider.name` — no changes needed

- `src/index.ts`:
  - Add import: `import type { SearchProvider, ReaderProvider } from './providers/interfaces.js'` (for type annotations if needed, though inference from concrete instances works)
  - Lines 83-86: wire-up unchanged (concrete instances passed where interfaces expected — structural typing permits this)

**Dependency on 13.01**:
- `src/providers/interfaces.ts` must exist with `SearchProvider`, `ReaderProvider`, `ProviderHealth` exports
- `ReaderProvider` interface MUST include `canRead(url: string): boolean` method (used by read.ts line 97)

---

## Quality Gates

1. **TypeScript compilation succeeds**: `npx tsc --noEmit` exits 0 after all type changes
2. **All 463 tests pass**: `npm test` exits 0 with no test file modifications
3. **No runtime behavior change**: MCP responses have identical `provider_id` values ('searxng', 'jina-reader') — now sourced from `provider.id` instead of hardcoded
4. **Interface-only access**: After refactor, no tool file accesses concrete-class-specific members not on the interface

---

## Gotchas

1. **`canRead` must be on ReaderProvider interface**: `read.ts` line 97 calls `provider.canRead(input.url)`. If 13.01's interface definition omits this method, compilation will fail. Verify `ReaderProvider` includes `canRead(url: string): boolean`.

2. **Gather tool identity is NOT a provider**: `gather.ts` line 99 uses `provider_id: 'orchestrator'` — this is the gather tool's own identity, not a search/reader provider identity. Do NOT change to `search.id` or `reader.id`. Gather orchestrates multiple providers; its responses carry its own orchestrator identity.

3. **Health tool nullable parameters**: `createHealthTool` accepts `SearchProvider | null` and `ReaderProvider | null`. The null case is valid (provider not configured) — preserve nullable types in the interface-typed signature.

4. **ESM import path suffix**: Use `.js` extension in import paths even for `.ts` source files: `from '../providers/interfaces.js'`. This is required for ESM compatibility in this project.

5. **Type-only imports preferred**: Since runtime behavior doesn't change, use `import type { ... }` for interface imports. This ensures interfaces are erased at compile time and don't affect bundle size.
