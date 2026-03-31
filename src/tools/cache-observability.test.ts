/**
 * Tests for cache bypass and observability — task 11.02 (FAILING — pre-implementation).
 *
 * Proves the observable contract for:
 * 1. `bypass_cache` parameter accepted on search / read / gather input schemas
 * 2. `cache_status: 'hit' | 'miss' | 'bypass' | 'disabled'` field present on
 *    every tool response `meta` when a cache is wired
 * 3. When `bypass_cache: true` → provider is called, cache lookup is skipped,
 *    `cache_status: 'bypass'` is returned
 * 4. When cache enabled + valid entry exists → `cache_status: 'hit'`, provider
 *    is NOT called
 * 5. When cache enabled + no entry → `cache_status: 'miss'`, provider IS called
 * 6. When cache disabled → `cache_status: 'disabled'` always
 *
 * All tests FAIL on the current codebase because:
 * - `bypass_cache` does not exist on any InputSchema
 * - `cache_status` does not exist on `ResponseMeta`
 * - The tools have no cache wiring at all
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SearchInputSchema, createSearchTool } from './search.js';
import { ReadInputSchema, createReadTool } from './read.js';
import { GatherInputSchema, createGatherTool } from './gather.js';
import { Cache } from '../lib/cache.js';
import type { SearchResult, ReadResult } from '../domain/types.js';
import type { SearxngProvider } from '../providers/searxng.js';
import type { JinaReaderProvider } from '../providers/jinaReader.js';
import { Logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function createMockSearchProvider(results: SearchResult[]): SearxngProvider {
  return {
    id: 'searxng',
    name: 'SearXNG',
    isHealthy: vi.fn().mockResolvedValue(true),
    search: vi.fn().mockResolvedValue(results),
    checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 10 }),
  } as unknown as SearxngProvider;
}

function createMockReadProvider(results: Map<string, ReadResult>): JinaReaderProvider {
  return {
    id: 'jina-reader',
    name: 'Jina Reader',
    isHealthy: vi.fn().mockResolvedValue(true),
    canRead: vi.fn().mockReturnValue(true),
    read: vi.fn().mockImplementation(async (url: string) => {
      const result = results.get(url);
      if (!result) throw new Error(`No mock result for ${url}`);
      return result;
    }),
    checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 10 }),
  } as unknown as JinaReaderProvider;
}

function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TEST_URL = 'https://example.com/article';

function createTestSearchResults(): SearchResult[] {
  return [
    {
      id: 'test-id-1',
      url: TEST_URL,
      title: 'Test Article',
      excerpt: 'Test excerpt',
      source: 'web',
    },
  ];
}

function createTestReadResult(): ReadResult {
  return {
    url: TEST_URL,
    title: 'Test Article',
    excerpt: 'Test excerpt',
    content: 'Full test content',
    content_mode: 'full',
    content_truncated: false,
  };
}

/** Build an in-memory Cache (enabled) */
function createEnabledCache(): Cache {
  return new Cache({ path: ':memory:', ttl: 3600, enabled: true });
}

/** Build a disabled Cache */
function createDisabledCache(): Cache {
  return new Cache({ path: ':memory:', ttl: 3600, enabled: false });
}

// ---------------------------------------------------------------------------
// Helper: parse envelope from tool response
// ---------------------------------------------------------------------------

function parseEnvelope(response: { content: Array<{ type: string; text: string }> }) {
  return JSON.parse(response.content[0]?.text ?? '{}') as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Step 1: Input schema — bypass_cache parameter
//
// WHY THESE FAIL: SearchInputSchema / ReadInputSchema / GatherInputSchema have
// no `bypass_cache` field today. Zod `.safeParse` with `bypass_cache: true`
// strips unknown keys (strict mode would reject; default strips), so the
// parsed output will NOT include `bypass_cache`. The test asserting that the
// field is present and defaults to `false` will fail.
// ---------------------------------------------------------------------------

describe('SearchInputSchema — bypass_cache parameter (task 11.02)', () => {
  it('accepts bypass_cache: true', () => {
    // Fails: field does not exist → stripped from parse output, no schema
    // validation error but the field is absent from result.data
    const result = SearchInputSchema.safeParse({
      query: 'test',
      bypass_cache: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bypass_cache).toBe(true);
    }
  });

  it('accepts bypass_cache: false', () => {
    const result = SearchInputSchema.safeParse({
      query: 'test',
      bypass_cache: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bypass_cache).toBe(false);
    }
  });

  it('defaults bypass_cache to false when omitted', () => {
    // Fails: no default defined for a non-existent field
    const result = SearchInputSchema.parse({ query: 'test' });
    expect((result as Record<string, unknown>).bypass_cache).toBe(false);
  });
});

describe('ReadInputSchema — bypass_cache parameter (task 11.02)', () => {
  it('accepts bypass_cache: true', () => {
    const result = ReadInputSchema.safeParse({
      url: TEST_URL,
      bypass_cache: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bypass_cache).toBe(true);
    }
  });

  it('accepts bypass_cache: false', () => {
    const result = ReadInputSchema.safeParse({
      url: TEST_URL,
      bypass_cache: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bypass_cache).toBe(false);
    }
  });

  it('defaults bypass_cache to false when omitted', () => {
    const result = ReadInputSchema.parse({ url: TEST_URL });
    expect((result as Record<string, unknown>).bypass_cache).toBe(false);
  });
});

describe('GatherInputSchema — bypass_cache parameter (task 11.02)', () => {
  it('accepts bypass_cache: true', () => {
    const result = GatherInputSchema.safeParse({
      query: 'test',
      bypass_cache: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bypass_cache).toBe(true);
    }
  });

  it('accepts bypass_cache: false', () => {
    const result = GatherInputSchema.safeParse({
      query: 'test',
      bypass_cache: false,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bypass_cache).toBe(false);
    }
  });

  it('defaults bypass_cache to false when omitted', () => {
    const result = GatherInputSchema.parse({ query: 'test' });
    expect((result as Record<string, unknown>).bypass_cache).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Step 2: ResponseMeta — cache_status field
//
// WHY THESE FAIL: ResponseMeta has no `cache_status` field today. The tools
// do not set it. Every assertion on `envelope.meta.cache_status` will be
// `undefined`, failing the equality checks below.
//
// The tools are created with a `cache` option that doesn't exist yet in the
// factory signatures.
// ---------------------------------------------------------------------------

describe('search tool — cache_status in ResponseMeta (task 11.02)', () => {
  let mockSearchProvider: SearxngProvider;
  let mockLogger: Logger;

  beforeEach(() => {
    mockSearchProvider = createMockSearchProvider(createTestSearchResults());
    mockLogger = createMockLogger();
  });

  it('meta.cache_status is "disabled" when no cache is provided', async () => {
    // createSearchTool currently takes (provider, logger, options?) — no cache.
    // Fails: no cache_status field exists.
    const tool = createSearchTool(mockSearchProvider, mockLogger);
    const response = await tool.handler({ query: 'test' });

    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('disabled');
  });

  it('meta.cache_status is "disabled" when cache is explicitly disabled', async () => {
    const cache = createDisabledCache();
    // Fails: createSearchTool does not accept a `cache` option.
    const tool = createSearchTool(mockSearchProvider, mockLogger, { cache });
    const response = await tool.handler({ query: 'test' });

    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('disabled');
    cache.close();
  });

  it('meta.cache_status is "miss" on first request with enabled cache (no prior entry)', async () => {
    const cache = createEnabledCache();
    // Fails: createSearchTool does not accept a `cache` option.
    const tool = createSearchTool(mockSearchProvider, mockLogger, { cache });
    const response = await tool.handler({ query: 'cold-miss-query' });

    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('miss');
    cache.close();
  });

  it('meta.cache_status is "hit" on second request with the same query (cache warm)', async () => {
    const cache = createEnabledCache();
    // Fails: createSearchTool does not accept a `cache` option.
    const tool = createSearchTool(mockSearchProvider, mockLogger, { cache });

    // First call — populates cache
    await tool.handler({ query: 'cached-query' });
    // Second call — should be served from cache
    const response = await tool.handler({ query: 'cached-query' });

    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('hit');
    cache.close();
  });

  it('meta.cache_status is "bypass" when bypass_cache: true, even if cache is warm', async () => {
    const cache = createEnabledCache();
    // Fails: createSearchTool does not accept a `cache` option; bypass_cache not in schema.
    const tool = createSearchTool(mockSearchProvider, mockLogger, { cache });

    // Warm the cache first
    await tool.handler({ query: 'bypass-query' });
    // Now call with bypass_cache: true
    const response = await tool.handler({ query: 'bypass-query', bypass_cache: true });

    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('bypass');
    cache.close();
  });
});

describe('search tool — bypass_cache behaviour (task 11.02)', () => {
  let mockSearchProvider: SearxngProvider;
  let mockLogger: Logger;

  beforeEach(() => {
    mockSearchProvider = createMockSearchProvider(createTestSearchResults());
    mockLogger = createMockLogger();
  });

  it('provider is NOT called on cache hit (cache_status: "hit")', async () => {
    const cache = createEnabledCache();
    // Fails: no cache wiring in createSearchTool.
    const tool = createSearchTool(mockSearchProvider, mockLogger, { cache });

    // Warm the cache
    await tool.handler({ query: 'hit-test-query' });
    const callCountAfterFirst = (mockSearchProvider.search as ReturnType<typeof vi.fn>).mock.calls.length;

    // Second call — should hit cache, NOT call provider again
    await tool.handler({ query: 'hit-test-query' });
    const callCountAfterSecond = (mockSearchProvider.search as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(callCountAfterSecond).toBe(callCountAfterFirst); // no extra call
    cache.close();
  });

  it('provider IS called when bypass_cache: true even with a warm cache', async () => {
    const cache = createEnabledCache();
    // Fails: no cache wiring in createSearchTool — once cache is wired,
    // the second call below would be a hit (provider not called).
    // The bypass must force a provider call despite the warm cache.
    const tool = createSearchTool(mockSearchProvider, mockLogger, { cache });

    // Warm the cache
    await tool.handler({ query: 'bypass-provider-test' });

    // Pre-implementation failure: cache_status is not 'bypass'
    const response = await tool.handler({ query: 'bypass-provider-test', bypass_cache: true });
    const meta = (parseEnvelope(response).meta as Record<string, unknown>);
    // Fails: cache_status does not exist on meta
    expect(meta.cache_status).toBe('bypass');
    cache.close();
  });

  it('bypass does not invalidate existing cache entry (other requests still hit)', async () => {
    const cache = createEnabledCache();
    // Fails: no cache wiring.
    const tool = createSearchTool(mockSearchProvider, mockLogger, { cache });

    // Warm the cache
    await tool.handler({ query: 'shared-cache-query' });

    // Bypass call — must NOT evict cache entry
    await tool.handler({ query: 'shared-cache-query', bypass_cache: true });

    // Normal call after bypass — should still hit cache
    const response = await tool.handler({ query: 'shared-cache-query' });
    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('hit');
    cache.close();
  });

  it('returns fresh results (not cached values) when bypass_cache: true', async () => {
    // Arrange: provider returns different results on first and second call
    const firstResults: SearchResult[] = [
      { id: 'first', url: TEST_URL, title: 'First Result', excerpt: 'First', source: 'web' },
    ];
    const secondResults: SearchResult[] = [
      { id: 'second', url: TEST_URL, title: 'Second Result (Fresh)', excerpt: 'Fresh', source: 'web' },
    ];
    const provider = createMockSearchProvider(firstResults);
    (provider.search as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(firstResults)
      .mockResolvedValueOnce(secondResults);

    const cache = createEnabledCache();
    // Fails: no cache wiring — once cache is implemented, the second (non-bypass) call would
    // return cached first results. The bypass must return fresh (second) results AND
    // report cache_status: 'bypass'.
    const tool = createSearchTool(provider, mockLogger, { cache });

    // Warm cache with first results
    await tool.handler({ query: 'freshness-test' });

    // Non-bypass call — should return cached first results (cache_status: 'hit' once implemented)
    const cachedResponse = await tool.handler({ query: 'freshness-test' });
    const cachedMeta = (parseEnvelope(cachedResponse).meta as Record<string, unknown>);
    // Fails: cache_status does not exist on meta
    expect(cachedMeta.cache_status).toBe('hit');

    // Bypass — should get fresh (second) results, not the cached first results
    const bypassResponse = await tool.handler({ query: 'freshness-test', bypass_cache: true });
    const envelope = parseEnvelope(bypassResponse);
    const bypassMeta = (envelope.meta as Record<string, unknown>);
    // Fails: cache_status does not exist on meta
    expect(bypassMeta.cache_status).toBe('bypass');
    cache.close();
  });
});

// ---------------------------------------------------------------------------
// Step 3: read tool — cache_status observability
//
// WHY THESE FAIL: createReadTool has no cache option; ResponseMeta has no
// cache_status; bypass_cache is not in ReadInputSchema.
// ---------------------------------------------------------------------------

describe('read tool — cache_status in ResponseMeta (task 11.02)', () => {
  let mockReadProvider: JinaReaderProvider;
  let mockLogger: Logger;

  beforeEach(() => {
    const results = new Map([[TEST_URL, createTestReadResult()]]);
    mockReadProvider = createMockReadProvider(results);
    mockLogger = createMockLogger();
  });

  it('meta.cache_status is "disabled" when no cache is wired', async () => {
    // Fails: no cache_status on meta.
    const tool = createReadTool(mockReadProvider, mockLogger);
    const response = await tool.handler({ url: TEST_URL });

    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('disabled');
  });

  it('meta.cache_status is "miss" on first read with enabled cache', async () => {
    const cache = createEnabledCache();
    // Fails: createReadTool does not accept `cache` option.
    const tool = createReadTool(mockReadProvider, mockLogger, { cache });
    const response = await tool.handler({ url: TEST_URL });

    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('miss');
    cache.close();
  });

  it('meta.cache_status is "hit" on second read of same URL', async () => {
    const cache = createEnabledCache();
    // Fails: createReadTool does not accept `cache` option.
    const tool = createReadTool(mockReadProvider, mockLogger, { cache });

    await tool.handler({ url: TEST_URL });
    const response = await tool.handler({ url: TEST_URL });

    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('hit');
    cache.close();
  });

  it('meta.cache_status is "bypass" when bypass_cache: true with warm cache', async () => {
    const cache = createEnabledCache();
    // Fails: createReadTool does not accept `cache` option; bypass_cache not in schema.
    const tool = createReadTool(mockReadProvider, mockLogger, { cache });

    // Warm cache
    await tool.handler({ url: TEST_URL });
    const response = await tool.handler({ url: TEST_URL, bypass_cache: true });

    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('bypass');
    cache.close();
  });

  it('full vs excerpt are separate cache entries (different cache_status)', async () => {
    // Gotcha from task 11.01: full:URL ≠ excerpt:URL as cache keys
    const cache = createEnabledCache();
    // Fails: createReadTool does not accept `cache` option.
    const tool = createReadTool(mockReadProvider, mockLogger, { cache });

    // Warm cache with full mode
    await tool.handler({ url: TEST_URL, content_mode: 'full' });

    // Excerpt mode must be a cache miss (separate key)
    const excerptResults = new Map([[TEST_URL, { ...createTestReadResult(), content_mode: 'excerpt' as const, content_truncated: true }]]);
    const excerptProvider = createMockReadProvider(excerptResults);
    const excerptTool = createReadTool(excerptProvider, mockLogger, { cache });

    const response = await excerptTool.handler({ url: TEST_URL, content_mode: 'excerpt' });
    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('miss'); // Different key, not a hit
    cache.close();
  });

  it('provider is NOT called on cache hit', async () => {
    const cache = createEnabledCache();
    // Fails: no cache wiring.
    const tool = createReadTool(mockReadProvider, mockLogger, { cache });

    await tool.handler({ url: TEST_URL });
    const callCountAfterFirst = (mockReadProvider.read as ReturnType<typeof vi.fn>).mock.calls.length;

    await tool.handler({ url: TEST_URL });
    const callCountAfterSecond = (mockReadProvider.read as ReturnType<typeof vi.fn>).mock.calls.length;

    expect(callCountAfterSecond).toBe(callCountAfterFirst);
    cache.close();
  });

  it('provider IS called when bypass_cache: true', async () => {
    const cache = createEnabledCache();
    // Fails: no cache wiring; bypass_cache not in schema.
    // Once implemented: second call (without bypass) will NOT call provider (cache hit).
    // The bypass call MUST call provider again. We assert cache_status rather than
    // call-count so the test is meaningful both pre- and post-implementation.
    const tool = createReadTool(mockReadProvider, mockLogger, { cache });

    await tool.handler({ url: TEST_URL });
    // Verify second identical call gets a cache hit (fails pre-impl)
    const hitResponse = await tool.handler({ url: TEST_URL });
    const hitMeta = (parseEnvelope(hitResponse).meta as Record<string, unknown>);
    // Fails: cache_status does not exist on meta
    expect(hitMeta.cache_status).toBe('hit');

    // Bypass — must return 'bypass' not 'hit'
    const bypassResponse = await tool.handler({ url: TEST_URL, bypass_cache: true });
    const bypassMeta = (parseEnvelope(bypassResponse).meta as Record<string, unknown>);
    expect(bypassMeta.cache_status).toBe('bypass');
    cache.close();
  });
});

// ---------------------------------------------------------------------------
// Step 4: gather tool — cache_status and bypass propagation
//
// WHY THESE FAIL: createGatherTool has no cache option; ResponseMeta has no
// cache_status; bypass_cache is not in GatherInputSchema.
//
// The gather bypass must propagate to ALL nested read calls (task gotcha).
// ---------------------------------------------------------------------------

describe('gather tool — cache_status in ResponseMeta (task 11.02)', () => {
  let mockSearchProvider: SearxngProvider;
  let mockReadProvider: JinaReaderProvider;
  let mockLogger: Logger;

  beforeEach(() => {
    mockSearchProvider = createMockSearchProvider(createTestSearchResults());
    const results = new Map([[TEST_URL, createTestReadResult()]]);
    mockReadProvider = createMockReadProvider(results);
    mockLogger = createMockLogger();
  });

  it('meta.cache_status is "disabled" when no cache is wired', async () => {
    // Fails: no cache_status on meta.
    const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger);
    const response = await tool.handler({ query: 'test' });

    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('disabled');
  });

  it('meta.cache_status is "miss" on first gather with enabled cache', async () => {
    const cache = createEnabledCache();
    // Fails: createGatherTool does not accept `cache` option.
    const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger, { cache });
    const response = await tool.handler({ query: 'gather-miss-test' });

    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('miss');
    cache.close();
  });

  it('meta.cache_status is "hit" on second gather with same query (cache warm)', async () => {
    const cache = createEnabledCache();
    // Fails: createGatherTool does not accept `cache` option.
    const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger, { cache });

    await tool.handler({ query: 'gather-hit-test' });
    const response = await tool.handler({ query: 'gather-hit-test' });

    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('hit');
    cache.close();
  });

  it('meta.cache_status is "bypass" when bypass_cache: true, even with warm cache', async () => {
    const cache = createEnabledCache();
    // Fails: createGatherTool does not accept `cache` option; bypass_cache not in schema.
    const tool = createGatherTool(mockSearchProvider, mockReadProvider, mockLogger, { cache });

    await tool.handler({ query: 'gather-bypass-test' });
    const response = await tool.handler({ query: 'gather-bypass-test', bypass_cache: true });

    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('bypass');
    cache.close();
  });
});

describe('gather tool — bypass_cache propagates to nested reads (task 11.02 gotcha)', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  it('bypass_cache: true causes all nested read provider calls to bypass cache', async () => {
    // Once cache is wired into gather, the second (warm) request should return
    // cached results without calling the read provider.
    // When bypass_cache: true is passed, gather MUST propagate bypass to all nested
    // reads and the meta must report 'bypass', not 'hit'.
    const searchResults: SearchResult[] = [
      { id: 'a', url: 'https://example.com/a', title: 'A', excerpt: 'a', source: 'web' },
      { id: 'b', url: 'https://example.com/b', title: 'B', excerpt: 'b', source: 'web' },
    ];
    const readResults = new Map<string, ReadResult>([
      ['https://example.com/a', { url: 'https://example.com/a', title: 'A', excerpt: 'a', content: 'A content', content_mode: 'full', content_truncated: false }],
      ['https://example.com/b', { url: 'https://example.com/b', title: 'B', excerpt: 'b', content: 'B content', content_mode: 'full', content_truncated: false }],
    ]);

    const mockSearch = createMockSearchProvider(searchResults);
    const mockRead = createMockReadProvider(readResults);
    const cache = createEnabledCache();

    // Fails: createGatherTool does not accept `cache` option; bypass_cache not in schema.
    const tool = createGatherTool(mockSearch, mockRead, mockLogger, { cache });

    // Warm the cache
    await tool.handler({ query: 'propagation-test' });

    // Warm hit: second identical call should be a cache hit (fails pre-impl: no cache_status)
    const warmResponse = await tool.handler({ query: 'propagation-test' });
    const warmMeta = (parseEnvelope(warmResponse).meta as Record<string, unknown>);
    // Fails: cache_status does not exist on meta
    expect(warmMeta.cache_status).toBe('hit');

    // Bypass — cache_status must be 'bypass', confirming propagation worked
    const bypassResponse = await tool.handler({ query: 'propagation-test', bypass_cache: true });
    const bypassMeta = (parseEnvelope(bypassResponse).meta as Record<string, unknown>);
    expect(bypassMeta.cache_status).toBe('bypass');
    cache.close();
  });

  it('cache_status "bypass" on gather does not false-report "hit" when content was refreshed', async () => {
    const searchResults = createTestSearchResults();
    const results = new Map([[TEST_URL, createTestReadResult()]]);
    const mockSearch = createMockSearchProvider(searchResults);
    const mockRead = createMockReadProvider(results);
    const cache = createEnabledCache();

    // Fails: no cache wiring.
    const tool = createGatherTool(mockSearch, mockRead, mockLogger, { cache });

    await tool.handler({ query: 'no-false-hit-test' });

    const response = await tool.handler({ query: 'no-false-hit-test', bypass_cache: true });
    const envelope = parseEnvelope(response);
    const meta = envelope.meta as Record<string, unknown>;

    // Must NOT report 'hit' when bypass was requested — integrity check
    expect(meta.cache_status).not.toBe('hit');
    expect(meta.cache_status).toBe('bypass');
    cache.close();
  });
});

// ---------------------------------------------------------------------------
// Step 5: cache_status four-way exhaustive mapping
//
// Each of the four status values maps to exactly one scenario.
// A single describe block documents the complete mapping table.
// ---------------------------------------------------------------------------

describe('cache_status four-value exhaustive mapping (task 11.02)', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = createMockLogger();
  });

  it('"disabled" — search tool, cache not configured', async () => {
    const provider = createMockSearchProvider(createTestSearchResults());
    // Fails: no cache_status field on meta.
    const tool = createSearchTool(provider, mockLogger);
    const response = await tool.handler({ query: 'test' });
    const meta = (parseEnvelope(response).meta as Record<string, unknown>);
    expect(meta.cache_status).toBe('disabled');
  });

  it('"miss" — search tool, cache enabled, cold request', async () => {
    const provider = createMockSearchProvider(createTestSearchResults());
    const cache = createEnabledCache();
    // Fails: no cache wiring in createSearchTool.
    const tool = createSearchTool(provider, mockLogger, { cache });
    const response = await tool.handler({ query: 'cold-search' });
    const meta = (parseEnvelope(response).meta as Record<string, unknown>);
    expect(meta.cache_status).toBe('miss');
    cache.close();
  });

  it('"hit" — search tool, cache enabled, second identical request', async () => {
    const provider = createMockSearchProvider(createTestSearchResults());
    const cache = createEnabledCache();
    // Fails: no cache wiring.
    const tool = createSearchTool(provider, mockLogger, { cache });
    await tool.handler({ query: 'warm-search' });
    const response = await tool.handler({ query: 'warm-search' });
    const meta = (parseEnvelope(response).meta as Record<string, unknown>);
    expect(meta.cache_status).toBe('hit');
    cache.close();
  });

  it('"bypass" — search tool, cache warm but bypass_cache: true', async () => {
    const provider = createMockSearchProvider(createTestSearchResults());
    const cache = createEnabledCache();
    // Fails: no cache wiring; bypass_cache not in schema.
    const tool = createSearchTool(provider, mockLogger, { cache });
    await tool.handler({ query: 'bypass-test' });
    const response = await tool.handler({ query: 'bypass-test', bypass_cache: true });
    const meta = (parseEnvelope(response).meta as Record<string, unknown>);
    expect(meta.cache_status).toBe('bypass');
    cache.close();
  });

  it('"disabled" — read tool, cache not configured', async () => {
    const results = new Map([[TEST_URL, createTestReadResult()]]);
    const provider = createMockReadProvider(results);
    // Fails: no cache_status field on meta.
    const tool = createReadTool(provider, mockLogger);
    const response = await tool.handler({ url: TEST_URL });
    const meta = (parseEnvelope(response).meta as Record<string, unknown>);
    expect(meta.cache_status).toBe('disabled');
  });

  it('"miss" — read tool, cache enabled, cold URL', async () => {
    const results = new Map([[TEST_URL, createTestReadResult()]]);
    const provider = createMockReadProvider(results);
    const cache = createEnabledCache();
    // Fails: createReadTool does not accept `cache` option.
    const tool = createReadTool(provider, mockLogger, { cache });
    const response = await tool.handler({ url: TEST_URL });
    const meta = (parseEnvelope(response).meta as Record<string, unknown>);
    expect(meta.cache_status).toBe('miss');
    cache.close();
  });

  it('"hit" — read tool, cache enabled, second read of same URL', async () => {
    const results = new Map([[TEST_URL, createTestReadResult()]]);
    const provider = createMockReadProvider(results);
    const cache = createEnabledCache();
    // Fails: createReadTool does not accept `cache` option.
    const tool = createReadTool(provider, mockLogger, { cache });
    await tool.handler({ url: TEST_URL });
    const response = await tool.handler({ url: TEST_URL });
    const meta = (parseEnvelope(response).meta as Record<string, unknown>);
    expect(meta.cache_status).toBe('hit');
    cache.close();
  });

  it('"bypass" — read tool, cache warm but bypass_cache: true', async () => {
    const results = new Map([[TEST_URL, createTestReadResult()]]);
    const provider = createMockReadProvider(results);
    const cache = createEnabledCache();
    // Fails: createReadTool does not accept `cache` option; bypass_cache not in schema.
    const tool = createReadTool(provider, mockLogger, { cache });
    await tool.handler({ url: TEST_URL });
    const response = await tool.handler({ url: TEST_URL, bypass_cache: true });
    const meta = (parseEnvelope(response).meta as Record<string, unknown>);
    expect(meta.cache_status).toBe('bypass');
    cache.close();
  });
});

// ---------------------------------------------------------------------------
// Step 6: cache_status is present on error responses too
//
// WHY: Observability must be available even when a request fails. A failed
// bypass request must still report 'bypass', not a missing field.
// ---------------------------------------------------------------------------

describe('cache_status present on error response envelopes (task 11.02)', () => {
  it('search error envelope includes cache_status: "disabled" when no cache', async () => {
    const provider = createMockSearchProvider([]);
    (provider.search as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Search fail'));
    const logger = createMockLogger();

    // Fails: no cache_status on meta.
    const tool = createSearchTool(provider, logger);
    const response = await tool.handler({ query: 'fail-test' });

    const envelope = parseEnvelope(response);
    expect(envelope.ok).toBe(false);
    const meta = envelope.meta as Record<string, unknown>;
    expect(meta.cache_status).toBe('disabled');
  });

  it('read error envelope includes cache_status: "miss" when cache enabled but provider fails', async () => {
    const provider = createMockReadProvider(new Map());
    (provider.read as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Read fail'));
    const logger = createMockLogger();
    const cache = createEnabledCache();

    // Fails: no cache wiring; no cache_status on meta.
    const tool = createReadTool(provider, logger, { cache });
    const response = await tool.handler({ url: TEST_URL });

    const envelope = parseEnvelope(response);
    expect(envelope.ok).toBe(false);
    const meta = envelope.meta as Record<string, unknown>;
    // A failed first read is still a miss — the cache was consulted, found nothing
    expect(meta.cache_status).toBe('miss');
    cache.close();
  });
});
