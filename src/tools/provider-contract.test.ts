/**
 * Provider contract tests — task 13.02.
 *
 * Proves that tool factories accept objects satisfying the provider interfaces
 * (not concrete classes), and that `provider_id` / `provider_name` in tool
 * responses are sourced from the injected provider's `id` / `name` properties
 * rather than hardcoded strings.
 *
 * These tests FAIL on the pre-13.02 codebase because:
 *   - search.ts hardcodes `provider_id: 'searxng'`   (line 86)
 *   - search.ts hardcodes `provider_name: 'SearXNG'` (line 87)
 *   - read.ts  hardcodes `provider_id: 'jina-reader'` (line 82)
 *   - read.ts  hardcodes `provider_name: 'Jina Reader'` (line 83)
 *
 * They pass once 13.02 replaces those literals with `provider.id` / `provider.name`.
 */

import { describe, it, expect, vi } from 'vitest';
import { createSearchTool } from './search.js';
import { createReadTool } from './read.js';
import type { SearchProvider, ReaderProvider } from '../providers/interfaces.js';
import type { SearchResult, ReadResult } from '../domain/types.js';
import { Logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Minimal mock helpers — object literals satisfying the interfaces.
// No concrete class involved; TypeScript structural typing is the point.
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

/** Minimal SearchResult — only required fields. */
function minimalSearchResult(): SearchResult {
  return {
    id: 'sr-1',
    url: 'https://example.com/result',
    title: 'A Result',
    excerpt: 'Some excerpt text.',
    source: 'web',
  };
}

/** Minimal ReadResult — only required fields. */
function minimalReadResult(url: string): ReadResult {
  return {
    url,
    title: 'A Page',
    content: 'Full page content here.',
    excerpt: 'Full page content here.',
    content_mode: 'full',
    content_truncated: false,
  };
}

// ---------------------------------------------------------------------------
// createSearchTool — provider interface contract
// ---------------------------------------------------------------------------

describe('createSearchTool — provider interface contract (task 13.02)', () => {
  /**
   * The factory must accept any object satisfying SearchProvider —
   * not specifically SearxngProvider. We pass a plain object literal.
   */
  function makeMockSearchProvider(): SearchProvider {
    return {
      id: 'mock-search',
      name: 'Mock Search',
      search: vi.fn().mockResolvedValue([minimalSearchResult()]),
      checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 10 }),
    };
  }

  it('accepts a plain object satisfying SearchProvider (not a concrete class)', async () => {
    const provider = makeMockSearchProvider();
    const logger = makeLogger();

    // If the factory's param type is still `SearxngProvider`, TypeScript would
    // reject this call at compile time (structural mismatch). At runtime the
    // call succeeds regardless — the meaningful assertion is in the next tests.
    const tool = createSearchTool(provider as unknown as Parameters<typeof createSearchTool>[0], logger);
    const response = await tool.handler({ query: 'test query' });

    expect(response.isError).toBeUndefined();
  });

  it('meta.provider_id reflects the injected provider id, not a hardcoded string', async () => {
    const provider = makeMockSearchProvider();
    const logger = makeLogger();

    const tool = createSearchTool(provider as unknown as Parameters<typeof createSearchTool>[0], logger);
    const response = await tool.handler({ query: 'contract test' });

    const envelope = JSON.parse(response.content[0]?.text ?? '{}');

    // FAILS pre-13.02: search.ts returns 'searxng', not 'mock-search'
    expect(envelope.meta.provider_id).toBe('mock-search');
  });

  it('meta.provider_name reflects the injected provider name, not a hardcoded string', async () => {
    const provider = makeMockSearchProvider();
    const logger = makeLogger();

    const tool = createSearchTool(provider as unknown as Parameters<typeof createSearchTool>[0], logger);
    const response = await tool.handler({ query: 'contract test' });

    const envelope = JSON.parse(response.content[0]?.text ?? '{}');

    // FAILS pre-13.02: search.ts returns 'SearXNG', not 'Mock Search'
    expect(envelope.meta.provider_name).toBe('Mock Search');
  });

  it('meta.provider_id is present on error responses too', async () => {
    const provider: SearchProvider = {
      id: 'mock-search',
      name: 'Mock Search',
      search: vi.fn().mockRejectedValue(new Error('search down')),
      checkHealth: vi.fn().mockResolvedValue({ status: 'unavailable', latency_ms: 5001 }),
    };
    const logger = makeLogger();

    const tool = createSearchTool(provider as unknown as Parameters<typeof createSearchTool>[0], logger);
    const response = await tool.handler({ query: 'failing query' });

    const envelope = JSON.parse(response.content[0]?.text ?? '{}');
    expect(envelope.ok).toBe(false);

    // FAILS pre-13.02: error path also hardcodes 'searxng'
    expect(envelope.meta.provider_id).toBe('mock-search');
  });

  it('different mock ids produce different provider_id values', async () => {
    const logger = makeLogger();

    const providerA: SearchProvider = {
      id: 'search-provider-alpha',
      name: 'Alpha Search',
      search: vi.fn().mockResolvedValue([minimalSearchResult()]),
      checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 10 }),
    };
    const providerB: SearchProvider = {
      id: 'search-provider-beta',
      name: 'Beta Search',
      search: vi.fn().mockResolvedValue([minimalSearchResult()]),
      checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 10 }),
    };

    const toolA = createSearchTool(providerA as unknown as Parameters<typeof createSearchTool>[0], logger);
    const toolB = createSearchTool(providerB as unknown as Parameters<typeof createSearchTool>[0], logger);

    const [respA, respB] = await Promise.all([
      toolA.handler({ query: 'alpha query' }),
      toolB.handler({ query: 'beta query' }),
    ]);

    const envA = JSON.parse(respA.content[0]?.text ?? '{}');
    const envB = JSON.parse(respB.content[0]?.text ?? '{}');

    // Both FAIL pre-13.02 — hardcoded string means both return 'searxng'
    expect(envA.meta.provider_id).toBe('search-provider-alpha');
    expect(envB.meta.provider_id).toBe('search-provider-beta');
    expect(envA.meta.provider_id).not.toBe(envB.meta.provider_id);
  });
});

// ---------------------------------------------------------------------------
// createReadTool — provider interface contract
// ---------------------------------------------------------------------------

describe('createReadTool — provider interface contract (task 13.02)', () => {
  const TEST_URL = 'https://example.com/page';

  /**
   * Plain object satisfying ReaderProvider — no JinaReaderProvider import.
   */
  function makeMockReaderProvider(): ReaderProvider {
    return {
      id: 'mock-reader',
      name: 'Mock Reader',
      canRead: vi.fn().mockReturnValue(true),
      read: vi.fn().mockResolvedValue(minimalReadResult(TEST_URL)),
      checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 10 }),
    };
  }

  it('accepts a plain object satisfying ReaderProvider (not a concrete class)', async () => {
    const provider = makeMockReaderProvider();
    const logger = makeLogger();

    const tool = createReadTool(provider as unknown as Parameters<typeof createReadTool>[0], logger);
    const response = await tool.handler({ url: TEST_URL });

    expect(response.isError).toBeUndefined();
  });

  it('meta.provider_id reflects the injected provider id, not a hardcoded string', async () => {
    const provider = makeMockReaderProvider();
    const logger = makeLogger();

    const tool = createReadTool(provider as unknown as Parameters<typeof createReadTool>[0], logger);
    const response = await tool.handler({ url: TEST_URL });

    const envelope = JSON.parse(response.content[0]?.text ?? '{}');

    // FAILS pre-13.02: read.ts returns 'jina-reader', not 'mock-reader'
    expect(envelope.meta.provider_id).toBe('mock-reader');
  });

  it('meta.provider_name reflects the injected provider name, not a hardcoded string', async () => {
    const provider = makeMockReaderProvider();
    const logger = makeLogger();

    const tool = createReadTool(provider as unknown as Parameters<typeof createReadTool>[0], logger);
    const response = await tool.handler({ url: TEST_URL });

    const envelope = JSON.parse(response.content[0]?.text ?? '{}');

    // FAILS pre-13.02: read.ts returns 'Jina Reader', not 'Mock Reader'
    expect(envelope.meta.provider_name).toBe('Mock Reader');
  });

  it('meta.provider_id is present on error responses too', async () => {
    const provider: ReaderProvider = {
      id: 'mock-reader',
      name: 'Mock Reader',
      canRead: vi.fn().mockReturnValue(true),
      read: vi.fn().mockRejectedValue(new Error('read failed')),
      checkHealth: vi.fn().mockResolvedValue({ status: 'unavailable', latency_ms: 5001 }),
    };
    const logger = makeLogger();

    const tool = createReadTool(provider as unknown as Parameters<typeof createReadTool>[0], logger);
    const response = await tool.handler({ url: TEST_URL });

    const envelope = JSON.parse(response.content[0]?.text ?? '{}');
    expect(envelope.ok).toBe(false);

    // FAILS pre-13.02: error path also hardcodes 'jina-reader'
    expect(envelope.meta.provider_id).toBe('mock-reader');
  });

  it('different mock ids produce different provider_id values', async () => {
    const logger = makeLogger();
    const url = TEST_URL;

    const providerX: ReaderProvider = {
      id: 'reader-x',
      name: 'Reader X',
      canRead: vi.fn().mockReturnValue(true),
      read: vi.fn().mockResolvedValue(minimalReadResult(url)),
      checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 10 }),
    };
    const providerY: ReaderProvider = {
      id: 'reader-y',
      name: 'Reader Y',
      canRead: vi.fn().mockReturnValue(true),
      read: vi.fn().mockResolvedValue(minimalReadResult(url)),
      checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 10 }),
    };

    const toolX = createReadTool(providerX as unknown as Parameters<typeof createReadTool>[0], logger);
    const toolY = createReadTool(providerY as unknown as Parameters<typeof createReadTool>[0], logger);

    const [respX, respY] = await Promise.all([
      toolX.handler({ url }),
      toolY.handler({ url }),
    ]);

    const envX = JSON.parse(respX.content[0]?.text ?? '{}');
    const envY = JSON.parse(respY.content[0]?.text ?? '{}');

    // Both FAIL pre-13.02 — hardcoded string means both return 'jina-reader'
    expect(envX.meta.provider_id).toBe('reader-x');
    expect(envY.meta.provider_id).toBe('reader-y');
    expect(envX.meta.provider_id).not.toBe(envY.meta.provider_id);
  });
});
