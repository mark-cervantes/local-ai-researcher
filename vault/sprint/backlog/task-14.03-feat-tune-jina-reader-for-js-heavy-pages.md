---
id: "14.03"
title: "Tune Jina Reader for JS-heavy pages"
type: feat
priority: medium
complexity: M
difficulty: moderate
sprint: 7
depends_on: ["14.02"]
blocks: ["14.04"]
parent: "14"
branch: "feat/task-14-research-quality-improvements"
assignee: dev
enriched: true
---

# Task 14.03: Tune Jina Reader For JS-Heavy Pages

## Business Requirements

### Problem
JS-heavy pages are more likely to produce degraded or incomplete extracts even when the underlying content is available. Improving extraction behavior with supported reader options is a low-to-medium effort way to increase baseline research quality without changing providers.

### User Story
As a researcher, I want local-researcher to extract useful content from JS-heavy pages more reliably so that modern web pages are not disproportionately unusable in my research flow.

### Acceptance Criteria
- [ ] The approved reader request options for slower or JS-heavy pages can be applied without changing the public provider choice.
- [ ] For the JS-heavy extraction fixture used by QA, a successful `read` returns more than 100 extracted words and is not marked degraded.
- [ ] Existing non-JS-heavy `read` behavior remains backward compatible for callers that do not use the new tuning behavior.
- [ ] Extraction failures on JS-heavy pages remain visible with explicit failure or degraded semantics rather than silent success.

### Business Rules
- Jina Reader remains the only approved read provider for this work.
- Supported provider options may improve extraction, but they must not require paid services or cloud provider replacement.
- Tuning behavior must preserve explicit visibility into degraded or failed reads.

### Out of Scope
- Replacing Jina Reader.
- New gather synthesis logic beyond what depends on improved read quality.

---
<!-- TECHNICAL GUIDANCE - written by Tech Lead below this line -->
<!-- Do not modify Business Requirements when enriching -->

## Technical Guidance

### Architecture Notes

**Axis**: Provider-internal request tuning — Jina Reader HTTP header injection for JS-heavy extraction.

**Pattern chosen**: Add an optional `jsOptions` sub-object to `JinaReaderOptions` (provider-local type in `jinaReader.ts`) that maps to Jina request headers. The public `ReaderProvider` interface stays unchanged (`read(url, options: ReadOptions)`). Callers using `ReadOptions` directly are unaffected; only callers that construct a `JinaReaderProvider` directly and pass `JinaReaderOptions` gain access to JS tuning. This is the fewest-new-abstractions approach.

**Rejected alternatives**:
- Adding `jsOptions` to domain `ReadOptions` — violates the provider-agnostic contract. `ReadOptions` is a domain type; Jina-specific headers must not leak into it.
- Adding `headers?: Record<string, string>` to `ReadOptions` — same violation, and gives callers uncontrolled header injection surface.
- Adding `headers?: Record<string, string>` directly to `JinaReaderOptions` — valid, but an untyped bag is harder to validate, document, or unit-test. Typed sub-object is slightly more work but gives explicit field documentation and allows targeted assertions in tests.

**Header → field mapping** (all optional, no field is required):
| `JinaJsOptions` field | Jina header | Effect |
|---|---|---|
| `timeout?: number` | `X-Timeout: N` | Wait up to N seconds for page load before extraction |
| `waitForSelector?: string` | `X-Wait-For-Selector: css` | Delay extraction until CSS selector is present in DOM |
| `returnFormat?: 'markdown'\|'text'\|'html'` | `X-Return-Format: value` | Override output format (default: markdown via JSON wrapper) |
| `withLinksSummary?: boolean` | `X-With-Links-Summary: true` | Append links section to output |

**Invariants**:
- When `jsOptions` is absent or empty, no extra headers are sent — zero behavioral change for existing callers.
- `X-Timeout` in `jsOptions` is distinct from `this.config.timeout` (HTTP client network timeout). Both may be set simultaneously: `config.timeout` governs the HTTP layer; `X-Timeout` is a hint to Jina's extraction pipeline. Do not conflate them.
- `waitForSelector` must be passed exactly as provided — no escaping or validation beyond non-empty string check.
- `returnFormat: 'html'` is legal but unusual — the `extractJinaPayload()` normalizer expects `content` to be a string regardless of format. No format-specific parsing is needed; HTML is treated as raw string content like markdown.
- `degraded` field (from 14.02) must still be computed from the returned `wordCount` — JS tuning increases likelihood of `degraded: false`, but the check remains unconditional.

### Affected Files

| File | Change |
|---|---|
| `src/providers/jinaReader.ts` | Add `JinaJsOptions` interface; extend `JinaReaderOptions` with `jsOptions?: JinaJsOptions`; merge JS headers into `headers` object inside `read()` |
| `src/providers/jinaReader.test.ts` | Add test cases covering JS option header injection, no-regression for baseline path, and degraded flag behavior with JS options |

No domain types (`src/domain/types.ts`) and no provider interface (`src/providers/interfaces.ts`) are modified.

### Implementation Approach

**Step 1 — Define `JinaJsOptions` in `jinaReader.ts`** (above the existing `JinaReaderOptions`):

```
interface JinaJsOptions {
  timeout?: number;           // Maps to X-Timeout header (seconds)
  waitForSelector?: string;   // Maps to X-Wait-For-Selector header
  returnFormat?: 'markdown' | 'text' | 'html';  // Maps to X-Return-Format header
  withLinksSummary?: boolean; // Maps to X-With-Links-Summary header
}
```

**Step 2 — Extend `JinaReaderOptions`** (add one optional field):

```
export interface JinaReaderOptions {
  content_mode?: ContentMode;
  targetWords?: number;
  language?: string;
  jsOptions?: JinaJsOptions;  // ← add this field only
}
```

**Step 3 — Merge JS headers in `read()`** (after the existing `headers` block, lines 284-289):

```
// Build base headers
const headers: Record<string, string> = { 'Accept': 'application/json' };
if (this.config.apiKey) {
  headers['Authorization'] = `Bearer ${this.config.apiKey}`;
}

// Merge JS-tuning headers if provided (no-op when jsOptions is absent)
if (options.jsOptions) {
  const js = options.jsOptions;
  if (js.timeout !== undefined) {
    headers['X-Timeout'] = String(js.timeout);
  }
  if (js.waitForSelector) {
    headers['X-Wait-For-Selector'] = js.waitForSelector;
  }
  if (js.returnFormat) {
    headers['X-Return-Format'] = js.returnFormat;
  }
  if (js.withLinksSummary === true) {
    headers['X-With-Links-Summary'] = 'true';
  }
}
```

**Step 4 — Log JS options when present** (extend the existing debug log at line 291-296):

```
this.logger.debug('Jina Reader request', {
  component: 'JinaReaderProvider',
  url,
  readerUrl: fullUrl,
  content_mode: contentMode,
  jsOptions: options.jsOptions ?? null,  // ← add this field only
});
```

### Test Approach (BDD ACs → Test Cases)

**AC1**: JS options are applied without changing public provider choice
- Test: Call `read(url, { jsOptions: { timeout: 30 } })` → assert HTTP call includes `X-Timeout: '30'` header
- Test: Call `read(url, { jsOptions: { waitForSelector: '.main-content' } })` → assert HTTP call includes `X-Wait-For-Selector: '.main-content'` header
- Test: Call `read(url, { jsOptions: { returnFormat: 'text', withLinksSummary: true } })` → assert both `X-Return-Format` and `X-With-Links-Summary` headers are present
- Mock: `mockHttpClient.get` — inspect the `headers` argument on the call

**AC2**: JS-heavy fixture returns >100 words and `degraded: false`
- This is an integration-level AC; unit tests can only validate that headers are sent correctly. The fixture behavior must be verified by QA with a live `r.jina.ai` request.
- Unit test: Mock response returning 110-word content → verify `result.wordCount > 100` and `result.degraded === false`

**AC3**: Backward compatibility — existing callers are unaffected
- Test: Call `read(url)` with no options → assert no `X-Timeout`, `X-Wait-For-Selector`, `X-Return-Format`, or `X-With-Links-Summary` headers are present in the HTTP call
- Test: Call `read(url, { content_mode: 'excerpt' })` → same — no JS headers; excerpt behavior unchanged
- Assert: All existing `jinaReader.test.ts` tests continue to pass (no regression)

**AC4**: Extraction failures remain visible with explicit failure or degraded semantics
- Test: `jsOptions` present but Jina returns 5-word content → verify `result.degraded === true` (wordCount < 20 check is unconditional)
- Test: `jsOptions` present but HTTP throws → verify `ReaderUnavailableError` or `ReaderTimeoutError` is still thrown (JS headers do not suppress errors)

**Test cases to add** (`src/providers/jinaReader.test.ts`):

```
describe('JS-heavy page tuning (jsOptions)', () => {
  it('sends X-Timeout header when jsOptions.timeout is set')
  it('sends X-Wait-For-Selector header when jsOptions.waitForSelector is set')
  it('sends X-Return-Format and X-With-Links-Summary headers when both are set')
  it('sends no JS tuning headers when jsOptions is absent')
  it('sends no JS tuning headers when jsOptions is empty object')
  it('marks result degraded when jsOptions are set but response is still sparse')
  it('propagates ReaderUnavailableError when HTTP fails with jsOptions present')
});
```

### Quality Gates

- [ ] All new JS-tuning test cases pass
- [ ] All existing `jinaReader.test.ts` tests pass (zero regression)
- [ ] `src/domain/types.ts` and `src/providers/interfaces.ts` are unmodified (diff confirms no domain type changes)
- [ ] `result.degraded` remains `true` when `wordCount < 20`, regardless of `jsOptions` presence
- [ ] `jsOptions` absent → zero extra headers in HTTP call (verified by test assertion)
- [ ] TypeScript compilation passes with `tsc --noEmit` (no new type errors)

### Gotchas

1. **`X-Timeout` is Jina's extraction wait, not the HTTP timeout.** `this.config.timeout` governs the HTTP client socket timeout. `X-Timeout: 30` tells Jina to wait up to 30 seconds for the page's JS to execute before extracting. If `X-Timeout` > `this.config.timeout` (ms-vs-seconds: `X-Timeout: 30` ≈ 30 000 ms), the HTTP client will cut the connection before Jina finishes. Either document a safe range (e.g., `jsOptions.timeout` ≤ `config.timeout / 1000 - 2`) or warn in a code comment.

2. **`returnFormat` changes response shape assumptions.** The `extractJinaPayload()` normalizer at line 71 expects a JSON body (`Accept: application/json`). If `returnFormat: 'html'` is combined with a self-hosted Jina instance that does not support the JSON wrapper, the response body may be raw HTML, not JSON, causing `extractJinaPayload` to throw `ReaderInvalidResponseError`. This is an edge case but worth a code comment.

3. **`withLinksSummary: true` increases content length.** The links section appended by Jina can add hundreds of words to `wordCount`. Tests asserting specific word counts must account for this.

4. **`waitForSelector` with a typo-ed selector will silently wait until timeout.** There is no validation Jina can do on the selector before sending the HTTP request. Log the selector value at debug level (already covered in Step 4) so callers can diagnose slow reads.

5. **`JinaJsOptions` is not exported.** The interface is an implementation detail of the Jina provider. Keep it unexported (`interface`, not `export interface`) unless a test file explicitly needs to import it. Tests should construct the literal object inline.

---

## Tests

**Test file:** `src/providers/jinaReader.test.ts`
**Describe block:** `JS-heavy page tuning (jsOptions)`
**Committed:** `b791586 test(14.03): add failing BDD tests for JS-heavy Jina Reader tuning`

| # | Test name | Status | Reason |
|---|-----------|--------|--------|
| 1 | `sends X-Timeout header when jsOptions.timeout is set` | 🔴 RED | `jsOptions` field does not exist on `JinaReaderOptions` yet; production code sends no `X-Timeout` header |
| 2 | `sends X-Wait-For-Selector header when jsOptions.waitForSelector is set` | 🔴 RED | Same — `JinaJsOptions` and header-merge block not yet implemented |
| 3 | `sends X-With-Links-Summary header when jsOptions.withLinksSummary is true` | 🔴 RED | Same — `X-With-Links-Summary` header never sent today |
| 4 | `sends X-Return-Format header when jsOptions.returnFormat is set` | 🔴 RED | Same — `X-Return-Format` header never sent today |
| 5 | `does not send JS tuning headers when jsOptions is absent` | 🟢 GREEN | Negative assertion — none of the four JS headers are present in the current code path, which is already the correct baseline behavior |
| 6 | `still marks read as degraded when JS-heavy response has < 20 words despite jsOptions` | 🟢 GREEN | Degraded flag logic exists from 14.02; `as any` cast lets `jsOptions` be passed without a type error, and the mock returns 5-word content |
| 7 | `propagates errors correctly when jsOptions is present` | 🟢 GREEN | Error propagation path is unchanged; `as any` cast passes through and the existing re-throw logic fires |
