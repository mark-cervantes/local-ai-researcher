---
id: "14.02"
title: "Detect degraded read results"
type: feat
priority: high
complexity: M
difficulty: moderate
sprint: 6
depends_on: []
blocks: ["14.03", "14.04"]
parent: "14"
branch: "feat/task-14-research-quality-improvements"
assignee: dev
enriched: true
---

# Task 14.02: Detect Degraded Read Results

## Business Requirements

### Problem
Very short or obviously degraded extracts can currently appear as successful reads, which misleads users and pollutes downstream gather output. The baseline research tool must distinguish real extraction success from near-empty or low-value content.

### User Story
As a researcher, I want degraded read outcomes to be flagged clearly so that I can trust successful reads and quickly spot sources that need retrying or manual review.

### Acceptance Criteria
- [ ] Any `read` result with fewer than 20 extracted words is surfaced as degraded and not counted as a successful full-content extraction.
- [ ] `read` responses expose a visible quality signal that distinguishes normal extraction from degraded extraction.
- [ ] `gather` responses report degraded reads separately from successful reads in their returned result semantics.
- [ ] Reads that exceed the degraded threshold and contain normal article text continue to appear as successful reads.

### Business Rules
- Two-word or similarly near-empty extracts must never be treated as successful reads.
- Degraded reads must remain visible to the caller instead of disappearing silently.
- The quality signal must be explicit enough for QA to verify in both `read` and `gather` outputs.

### Out of Scope
- Changing the core reader provider.
- Improving extraction quality for JS-heavy pages beyond degraded-result detection.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Technical Guidance

### Architecture Notes

**Decisive axis:** Data shape extension — adding a quality signal to `ReadResult` without breaking the locked v1 schema contract.

**Pattern selection:**
- **Chosen:** Simple optional boolean `degraded?: boolean` on `ReadResult`
- **Rejected:** Richer `quality: { grade: 'good'|'degraded', reason?: string }` object — over-engineered for a fixed 20-word threshold with no extensibility requirement in scope
- **Tradeoff accepted:** Boolean is opaque; callers must know the threshold semantics. Acceptable because the 20-word threshold is locked in AC and not configurable.

**Boundary constraints:**
- `degraded` is computed from existing `wordCount` — no new network calls
- Field is optional for backward compatibility: existing callers that ignore it continue to work
- `successfulReads` in `GatherResult.summary` must exclude degraded reads (semantic change)

### Field Additions

**1. `ReadResult` in `src/domain/types.ts`** (line ~186):
```typescript
/** Quality signal: true if extracted content is too short for meaningful use (<20 words) */
degraded?: boolean;
```

**2. `GatherResult.summary` in `src/domain/types.ts`** (line ~255):
```typescript
/** Number of reads flagged as degraded (wordCount < 20) — not included in successfulReads */
degradedReads: number;
```

**Semantic change:** `successfulReads` now means "non-degraded successful reads". Previously it meant "reads that didn't throw". This is a breaking semantic change but acceptable because:
- The field name is unchanged (schema-compatible)
- The new semantics align with user expectation that "successful" means "usable content"
- AC1 explicitly requires degraded reads not be counted as successful

### Affected Areas

| File | Change |
|------|--------|
| `src/domain/types.ts` | Add `degraded?: boolean` to `ReadResult`; add `degradedReads: number` to `GatherResult.summary` |
| `src/providers/jinaReader.ts` | After computing `wordCount` (~line 367), set `degraded: wordCount < 20` |
| `src/tools/gather.ts` | In read counting loop (~line 221-228), compute `degradedReads` and adjust `successfulReads` to exclude degraded |
| `src/tools/read.ts` | No changes required — `degraded` is populated by provider, tool just passes through |
| `tests/unit/providers/jinaReader.test.ts` | Add test cases for degraded flag |
| `tests/unit/tools/gather.test.ts` | Add test cases for `degradedReads` count and `successfulReads` exclusion |
| `tests/unit/tools/read.test.ts` | Add test case verifying degraded is present in response |

### Implementation Order (Least-to-Most)

1. **Tests first (QA agent):**
   - `jinaReader.test.ts`: test that `wordCount < 20` produces `degraded: true`, `wordCount >= 20` produces `degraded: false` or absent
   - `read.test.ts`: test that `ReadResult` envelope contains `degraded` field
   - `gather.test.ts`: test that `summary.degradedReads` is correct, `summary.successfulReads` excludes degraded

2. **Domain types (coder):**
   - Add `degraded?: boolean` to `ReadResult`
   - Add `degradedReads: number` to `GatherResult.summary`

3. **Provider (coder):**
   - `jinaReader.ts`: add `degraded: wordCount < 20` to result object

4. **Gather tool (coder):**
   - Count degraded reads separately
   - Adjust `successfulReads` to exclude degraded

### Quality Gates

| Gate | Verification |
|------|--------------|
| AC1: <20 words flagged | Test: read result with 19 words has `degraded: true` |
| AC2: Visible quality signal | Test: read response envelope contains `result.degraded` field |
| AC3: Gather reports separately | Test: `GatherResult.summary.degradedReads` matches count of `reads.filter(r => r.degraded)` |
| AC4: Normal reads unaffected | Test: read result with 100 words has `degraded: false` or absent, counted in `successfulReads` |
| Backward compat | Test: existing code that ignores `degraded` continues to work |

### Test Cases (AC Mapping)

**AC1 — Degraded detection:**
```typescript
// jinaReader.test.ts
it('flags read as degraded when wordCount < 20', async () => {
  // Mock provider response with 15 words
  const result = await provider.read(url);
  expect(result.wordCount).toBe(15);
  expect(result.degraded).toBe(true);
});

it('does not flag read as degraded when wordCount >= 20', async () => {
  // Mock provider response with 50 words
  const result = await provider.read(url);
  expect(result.wordCount).toBe(50);
  expect(result.degraded).toBe(false);
});
```

**AC2 — Read exposes quality signal:**
```typescript
// read.test.ts
it('exposes degraded quality signal in read response', async () => {
  const response = await readHandler({ url: shortContentUrl });
  const envelope = JSON.parse(response.content[0].text);
  expect(envelope.result.degraded).toBe(true);
});
```

**AC3 — Gather reports separately:**
```typescript
// gather.test.ts
it('reports degraded reads separately in summary', async () => {
  // Mock: 3 reads, 1 degraded (15 words), 2 normal (50+ words each)
  const response = await gatherHandler({ query: 'test' });
  const envelope = JSON.parse(response.content[0].text);
  expect(envelope.result.summary.degradedReads).toBe(1);
  expect(envelope.result.summary.successfulReads).toBe(2);
  // Verify degraded read is still in context.reads for visibility
  expect(envelope.result.context.reads).toHaveLength(3);
});
```

**AC4 — Normal reads unaffected:**
```typescript
// gather.test.ts
it('counts normal reads as successful when wordCount >= 20', async () => {
  // Mock: 2 reads, both 50+ words
  const response = await gatherHandler({ query: 'test' });
  const envelope = JSON.parse(response.content[0].text);
  expect(envelope.result.summary.degradedReads).toBe(0);
  expect(envelope.result.summary.successfulReads).toBe(2);
});
```

### Gotchas

1. **wordCount=0 edge case:** Empty content (wordCount=0) is degraded. Ensure provider handles this gracefully.
2. **successfulReads semantic change:** Existing code that logs or displays `successfulReads` will now show a lower number when degraded reads exist. This is intentional per AC1.
3. **Cache consideration:** Cached `ReadResult` objects without `degraded` field will be served as-is. Consider cache invalidation or tolerate the field being absent (treat as `false`).

---

## Tests

All tests written by QA agent as part of BDD red phase. Status at commit: 4/5 failing (RED), 1/5 passing (read.test.ts is GREEN by design — it verifies pass-through semantics which don't require new production code).

| # | Test Name | File | AC | Status |
|---|-----------|------|----|--------|
| 1 | `flags read as degraded when wordCount < 20` | `src/providers/jinaReader.test.ts` | AC1 | RED |
| 2 | `does not flag read as degraded when wordCount >= 20` | `src/providers/jinaReader.test.ts` | AC1/AC4 | RED |
| 3 | `exposes degraded quality signal in read response` | `src/tools/read.test.ts` | AC2 | GREEN (pass-through; no new production code needed in read.ts) |
| 4 | `reports degraded reads separately in summary` | `src/tools/gather.test.ts` | AC3 | RED |
| 5 | `counts normal reads as successful when wordCount >= 20` | `src/tools/gather.test.ts` | AC4 | RED |
