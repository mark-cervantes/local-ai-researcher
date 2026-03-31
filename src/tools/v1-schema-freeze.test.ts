/**
 * v1 Schema Freeze Tests — task 10.01
 *
 * These tests validate the canonical fixture files against the locked v1
 * contract. They are the regression gate that prevents any field rename,
 * type change, or default behavior drift from sneaking into downstream work.
 *
 * The tests are intentionally strict: every required field is asserted
 * explicitly. A test failure here means the v1 contract has been broken.
 *
 * Key invariants enforced:
 * 1. schema_version === '1' on all envelopes
 * 2. ok: true envelopes have result, no error
 * 3. ok: false envelopes have error (code, message, retryable) AND meta
 * 4. meta is present on ALL envelopes (success and failure)
 * 5. Read success: content_mode === 'full' (full-content-by-default)
 * 6. Read truncated: content_truncated === true, truncation object present
 * 7. Read not truncated: content_truncated === false, truncation absent
 * 8. Gather: dedupStats, summary with all 5 fields, synthesis string
 * 9. Health: status in union, mcp.stdio.ready, mcp.servers[], resources
 * 10. No legacy excerpt-first fields on SearchResult
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type {
  ToolResponseEnvelope,
  SearchResult,
  ReadResult,
  GatherResult,
  HealthResult,
  ResponseMeta,
} from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';

// ---------------------------------------------------------------------------
// Fixture loader
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = join(__dirname, '..', '..', 'tests', 'fixtures');

function loadFixture<T>(name: string): ToolResponseEnvelope<T> {
  const raw = readFileSync(join(FIXTURES_DIR, `${name}.json`), 'utf-8');
  return JSON.parse(raw) as ToolResponseEnvelope<T>;
}

// ---------------------------------------------------------------------------
// Test-side type guard helpers (no production code added)
// ---------------------------------------------------------------------------

/** UUID v4 regex */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** ISO-8601 basic check */
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function assertValidMeta(meta: ResponseMeta, context: string): void {
  expect(meta, `${context}: meta must be defined`).toBeDefined();
  expect(typeof meta.request_id, `${context}: request_id must be string`).toBe('string');
  expect(meta.request_id, `${context}: request_id must match UUID v4`).toMatch(UUID_V4);
  expect(typeof meta.timestamp, `${context}: timestamp must be string`).toBe('string');
  expect(meta.timestamp, `${context}: timestamp must be ISO-8601`).toMatch(ISO_8601);
  expect(typeof meta.provider_id, `${context}: provider_id must be string`).toBe('string');
  expect(meta.provider_id.length, `${context}: provider_id must not be empty`).toBeGreaterThan(0);
  expect(typeof meta.provider_name, `${context}: provider_name must be string`).toBe('string');
  expect(meta.provider_name.length, `${context}: provider_name must not be empty`).toBeGreaterThan(0);
  expect(typeof meta.applied_limits, `${context}: applied_limits must be object`).toBe('object');
  expect(meta.applied_limits, `${context}: applied_limits must not be null`).not.toBeNull();
}

function assertSuccessEnvelope<T>(
  envelope: ToolResponseEnvelope<T>,
  context: string
): void {
  expect(envelope.schema_version, `${context}: schema_version must be '1'`).toBe(SCHEMA_VERSION);
  expect(envelope.ok, `${context}: ok must be true`).toBe(true);
  expect(envelope.result, `${context}: result must be present on ok:true`).toBeDefined();
  expect(envelope.error, `${context}: error must be absent on ok:true`).toBeUndefined();
  assertValidMeta(envelope.meta, context);
}

function assertFailureEnvelope(
  envelope: ToolResponseEnvelope<never>,
  context: string
): void {
  expect(envelope.schema_version, `${context}: schema_version must be '1'`).toBe(SCHEMA_VERSION);
  expect(envelope.ok, `${context}: ok must be false`).toBe(false);
  expect(envelope.result, `${context}: result must be absent on ok:false`).toBeUndefined();
  expect(envelope.error, `${context}: error must be present on ok:false`).toBeDefined();
  // Error fields
  expect(typeof envelope.error!.code, `${context}: error.code must be string`).toBe('string');
  expect(envelope.error!.code.length, `${context}: error.code must not be empty`).toBeGreaterThan(0);
  expect(typeof envelope.error!.message, `${context}: error.message must be string`).toBe('string');
  expect(typeof envelope.error!.retryable, `${context}: error.retryable must be boolean`).toBe('boolean');
  // meta MUST be present on failure envelopes for traceability
  assertValidMeta(envelope.meta, context);
}

// ---------------------------------------------------------------------------
// Search fixtures
// ---------------------------------------------------------------------------

describe('v1 schema freeze — search', () => {
  describe('search-success fixture', () => {
    const envelope = loadFixture<{ results: SearchResult[]; total: number }>('search-success');

    it('has schema_version "1"', () => {
      expect(envelope.schema_version).toBe('1');
    });

    it('is a valid success envelope (ok:true, result, no error, meta present)', () => {
      assertSuccessEnvelope(envelope, 'search-success');
    });

    it('result.results is a non-empty array', () => {
      expect(Array.isArray(envelope.result!.results)).toBe(true);
      expect(envelope.result!.results.length).toBeGreaterThan(0);
    });

    it('result.total matches results array length', () => {
      expect(envelope.result!.total).toBe(envelope.result!.results.length);
    });

    it('each SearchResult has required id field (non-empty string)', () => {
      for (const r of envelope.result!.results) {
        expect(typeof r.id).toBe('string');
        expect(r.id.length).toBeGreaterThan(0);
      }
    });

    it('each SearchResult has canonical url (https?://)', () => {
      for (const r of envelope.result!.results) {
        expect(typeof r.url).toBe('string');
        expect(r.url).toMatch(/^https?:\/\//);
      }
    });

    it('each SearchResult has title (string)', () => {
      for (const r of envelope.result!.results) {
        expect(typeof r.title).toBe('string');
      }
    });

    it('each SearchResult has excerpt (string)', () => {
      for (const r of envelope.result!.results) {
        expect(typeof r.excerpt).toBe('string');
      }
    });

    it('each SearchResult.source is web | local | custom', () => {
      const validSources = ['web', 'local', 'custom'];
      for (const r of envelope.result!.results) {
        expect(validSources).toContain(r.source);
      }
    });

    it('no legacy excerpt-first fields leaked (engines, categories, engine)', () => {
      for (const r of envelope.result!.results) {
        expect(r).not.toHaveProperty('engines');
        expect(r).not.toHaveProperty('categories');
        expect(r).not.toHaveProperty('engine');
      }
    });

    it('meta.provider_id is "searxng"', () => {
      expect(envelope.meta.provider_id).toBe('searxng');
    });

    it('meta.provider_name is "SearXNG"', () => {
      expect(envelope.meta.provider_name).toBe('SearXNG');
    });

    it('meta.applied_limits.max_results is a positive integer', () => {
      expect(typeof envelope.meta.applied_limits.max_results).toBe('number');
      expect(envelope.meta.applied_limits.max_results!).toBeGreaterThan(0);
    });

    it('meta.applied_limits.timeout_ms is a positive number', () => {
      expect(typeof envelope.meta.applied_limits.timeout_ms).toBe('number');
      expect(envelope.meta.applied_limits.timeout_ms!).toBeGreaterThan(0);
    });
  });

  describe('search-failure fixture', () => {
    const envelope = loadFixture<never>('search-failure');

    it('has schema_version "1"', () => {
      expect(envelope.schema_version).toBe('1');
    });

    it('is a valid failure envelope (ok:false, error present, meta present)', () => {
      assertFailureEnvelope(envelope, 'search-failure');
    });

    it('error.code is ERR_SEARXNG_UNAVAILABLE', () => {
      expect(envelope.error!.code).toBe('ERR_SEARXNG_UNAVAILABLE');
    });

    it('error.retryable is true (provider outages are retryable)', () => {
      expect(envelope.error!.retryable).toBe(true);
    });

    it('meta is present on failure for traceability', () => {
      assertValidMeta(envelope.meta, 'search-failure');
    });

    it('meta.provider_id is "searxng" even on failure', () => {
      expect(envelope.meta.provider_id).toBe('searxng');
    });
  });
});

// ---------------------------------------------------------------------------
// Read fixtures
// ---------------------------------------------------------------------------

describe('v1 schema freeze — read', () => {
  describe('read-success-full fixture (full-content default)', () => {
    const envelope = loadFixture<ReadResult>('read-success-full');

    it('has schema_version "1"', () => {
      expect(envelope.schema_version).toBe('1');
    });

    it('is a valid success envelope', () => {
      assertSuccessEnvelope(envelope, 'read-success-full');
    });

    it('content_mode is "full" — enforcing full-content-by-default', () => {
      // This is the key v1 invariant: read returns full content by default.
      // If this fails it means the fixture was authored with excerpt-first behavior.
      expect(envelope.result!.content_mode).toBe('full');
    });

    it('content_truncated is false', () => {
      expect(envelope.result!.content_truncated).toBe(false);
    });

    it('truncation is absent when content_truncated is false', () => {
      // Invariant: truncation object must NOT be present when content is not truncated
      expect(envelope.result!.truncation).toBeUndefined();
    });

    it('content field is populated (full content present)', () => {
      expect(typeof envelope.result!.content).toBe('string');
      expect(envelope.result!.content!.length).toBeGreaterThan(0);
    });

    it('url is present', () => {
      expect(typeof envelope.result!.url).toBe('string');
      expect(envelope.result!.url).toMatch(/^https?:\/\//);
    });

    it('excerpt is present', () => {
      expect(typeof envelope.result!.excerpt).toBe('string');
    });

    it('meta.provider_id is "jina-reader"', () => {
      expect(envelope.meta.provider_id).toBe('jina-reader');
    });

    it('meta.provider_name is "Jina Reader"', () => {
      expect(envelope.meta.provider_name).toBe('Jina Reader');
    });

    it('meta.applied_limits.timeout_ms is present', () => {
      expect(typeof envelope.meta.applied_limits.timeout_ms).toBe('number');
    });
  });

  describe('read-success-truncated fixture (full mode, provider limit hit)', () => {
    const envelope = loadFixture<ReadResult>('read-success-truncated');

    it('has schema_version "1"', () => {
      expect(envelope.schema_version).toBe('1');
    });

    it('is a valid success envelope', () => {
      assertSuccessEnvelope(envelope, 'read-success-truncated');
    });

    it('content_mode is "full" — requested full content even though truncated', () => {
      // Truncation occurred at provider level; the request was for full content.
      // content_mode must still reflect the requested mode, not the outcome.
      expect(envelope.result!.content_mode).toBe('full');
    });

    it('content_truncated is true', () => {
      expect(envelope.result!.content_truncated).toBe(true);
    });

    it('truncation object is present when content_truncated is true', () => {
      expect(envelope.result!.truncation).toBeDefined();
    });

    it('truncation.reason is a valid value', () => {
      const validReasons = ['max_bytes', 'explicit_excerpt', 'provider_limit'];
      expect(validReasons).toContain(envelope.result!.truncation!.reason);
    });

    it('truncation.applied_limit is a positive number', () => {
      expect(typeof envelope.result!.truncation!.applied_limit).toBe('number');
      expect(envelope.result!.truncation!.applied_limit).toBeGreaterThan(0);
    });

    it('no legacy hidden-truncation — truncation reason is explicit', () => {
      // The reason must never be absent or null; it must identify why truncation occurred.
      expect(envelope.result!.truncation!.reason).not.toBeNull();
      expect(envelope.result!.truncation!.reason).not.toBe('');
    });
  });

  describe('read-failure-ssrf fixture', () => {
    const envelope = loadFixture<never>('read-failure-ssrf');

    it('has schema_version "1"', () => {
      expect(envelope.schema_version).toBe('1');
    });

    it('is a valid failure envelope', () => {
      assertFailureEnvelope(envelope, 'read-failure-ssrf');
    });

    it('error.code is ERR_SSRF_BLOCKED', () => {
      expect(envelope.error!.code).toBe('ERR_SSRF_BLOCKED');
    });

    it('error.retryable is false (SSRF block is not retryable)', () => {
      expect(envelope.error!.retryable).toBe(false);
    });

    it('meta is present on SSRF failure for security audit traceability', () => {
      // Per task gotcha: "Error fixtures must preserve meta for traceability"
      assertValidMeta(envelope.meta, 'read-failure-ssrf');
    });

    it('meta.provider_id is "jina-reader" even on SSRF failure', () => {
      expect(envelope.meta.provider_id).toBe('jina-reader');
    });
  });
});

// ---------------------------------------------------------------------------
// Gather fixtures
// ---------------------------------------------------------------------------

describe('v1 schema freeze — gather', () => {
  describe('gather-success fixture', () => {
    const envelope = loadFixture<GatherResult>('gather-success');

    it('has schema_version "1"', () => {
      expect(envelope.schema_version).toBe('1');
    });

    it('is a valid success envelope', () => {
      assertSuccessEnvelope(envelope, 'gather-success');
    });

    it('result.id is a non-empty string', () => {
      expect(typeof envelope.result!.id).toBe('string');
      expect(envelope.result!.id.length).toBeGreaterThan(0);
    });

    it('result.prompt is the original query (non-empty string)', () => {
      expect(typeof envelope.result!.prompt).toBe('string');
      expect(envelope.result!.prompt.length).toBeGreaterThan(0);
    });

    it('result.context is defined', () => {
      expect(envelope.result!.context).toBeDefined();
    });

    it('context.sources is a non-empty array', () => {
      expect(Array.isArray(envelope.result!.context.sources)).toBe(true);
      expect(envelope.result!.context.sources.length).toBeGreaterThan(0);
    });

    it('each source has type in web|local|custom and a target string', () => {
      const validTypes = ['web', 'local', 'custom'];
      for (const s of envelope.result!.context.sources) {
        expect(validTypes).toContain(s.type);
        expect(typeof s.target).toBe('string');
        expect(s.target.length).toBeGreaterThan(0);
      }
    });

    it('context.results is an array of SearchResults', () => {
      expect(Array.isArray(envelope.result!.context.results)).toBe(true);
      for (const r of envelope.result!.context.results) {
        expect(typeof r.id).toBe('string');
        expect(typeof r.url).toBe('string');
        expect(typeof r.title).toBe('string');
        expect(typeof r.excerpt).toBe('string');
      }
    });

    it('context.reads is an array of ReadResults', () => {
      expect(Array.isArray(envelope.result!.context.reads)).toBe(true);
    });

    it('each read in context.reads has content_mode (full-content-by-default)', () => {
      // Gather reads must use full content by default
      for (const r of envelope.result!.context.reads) {
        expect(r.content_mode).toBe('full');
      }
    });

    it('context.dedupStats has total and deduped (both numbers)', () => {
      const { dedupStats } = envelope.result!.context;
      expect(typeof dedupStats.total).toBe('number');
      expect(typeof dedupStats.deduped).toBe('number');
    });

    it('dedupStats.deduped is ≥ 0 and ≤ total', () => {
      const { dedupStats } = envelope.result!.context;
      expect(dedupStats.deduped).toBeGreaterThanOrEqual(0);
      expect(dedupStats.deduped).toBeLessThanOrEqual(dedupStats.total);
    });

    it('synthesis is a non-empty string containing the prompt', () => {
      expect(typeof envelope.result!.synthesis).toBe('string');
      expect(envelope.result!.synthesis.length).toBeGreaterThan(0);
      expect(envelope.result!.synthesis).toContain(envelope.result!.prompt);
    });

    it('summary has all 5 required numeric fields', () => {
      const s = envelope.result!.summary;
      expect(typeof s.totalResults).toBe('number');
      expect(typeof s.attemptedReads).toBe('number');
      expect(typeof s.successfulReads).toBe('number');
      expect(typeof s.failedReads).toBe('number');
      expect(typeof s.totalDuration).toBe('number');
    });

    it('summary arithmetic is consistent (successfulReads + failedReads === attemptedReads)', () => {
      const s = envelope.result!.summary;
      expect(s.successfulReads + s.failedReads).toBe(s.attemptedReads);
    });

    it('meta.provider_id is "orchestrator"', () => {
      expect(envelope.meta.provider_id).toBe('orchestrator');
    });

    it('meta.provider_name is "Orchestrator"', () => {
      expect(envelope.meta.provider_name).toBe('Orchestrator');
    });
  });

  describe('gather-failure-partial fixture', () => {
    const envelope = loadFixture<never>('gather-failure-partial');

    it('has schema_version "1"', () => {
      expect(envelope.schema_version).toBe('1');
    });

    it('is a valid failure envelope', () => {
      assertFailureEnvelope(envelope, 'gather-failure-partial');
    });

    it('error.code is ERR_GATHER_NO_SOURCES', () => {
      expect(envelope.error!.code).toBe('ERR_GATHER_NO_SOURCES');
    });

    it('error.retryable is false (no sources = not retryable)', () => {
      expect(envelope.error!.retryable).toBe(false);
    });

    it('meta is present on gather failure', () => {
      assertValidMeta(envelope.meta, 'gather-failure-partial');
    });

    it('meta.provider_id is "orchestrator"', () => {
      expect(envelope.meta.provider_id).toBe('orchestrator');
    });
  });
});

// ---------------------------------------------------------------------------
// Health fixtures
// ---------------------------------------------------------------------------

describe('v1 schema freeze — health', () => {
  describe('health-success fixture (both providers ready)', () => {
    const envelope = loadFixture<HealthResult>('health-success');

    it('has schema_version "1"', () => {
      expect(envelope.schema_version).toBe('1');
    });

    it('is a valid success envelope', () => {
      assertSuccessEnvelope(envelope, 'health-success');
    });

    it('result.status is "healthy"', () => {
      expect(envelope.result!.status).toBe('healthy');
    });

    it('result.status is in the valid union (healthy|degraded|unhealthy)', () => {
      const validStatuses = ['healthy', 'degraded', 'unhealthy'];
      expect(validStatuses).toContain(envelope.result!.status);
    });

    it('mcp.stdio.ready is true', () => {
      expect(envelope.result!.mcp.stdio.ready).toBe(true);
    });

    it('mcp.stdio.version is a non-empty string', () => {
      expect(typeof envelope.result!.mcp.stdio.version).toBe('string');
      expect(envelope.result!.mcp.stdio.version.length).toBeGreaterThan(0);
    });

    it('mcp.servers is a non-empty array', () => {
      expect(Array.isArray(envelope.result!.mcp.servers)).toBe(true);
      expect(envelope.result!.mcp.servers.length).toBeGreaterThan(0);
    });

    it('each server entry has name and status', () => {
      for (const s of envelope.result!.mcp.servers) {
        expect(typeof s.name).toBe('string');
        expect(s.name.length).toBeGreaterThan(0);
        const validStatuses = ['connected', 'degraded', 'unavailable', 'error'];
        expect(validStatuses).toContain(s.status);
      }
    });

    it('all servers are "connected" when overall status is "healthy"', () => {
      const allConnected = envelope.result!.mcp.servers.every(s => s.status === 'connected');
      expect(allConnected).toBe(true);
    });

    it('resources has memoryMB (positive number)', () => {
      expect(typeof envelope.result!.resources.memoryMB).toBe('number');
      expect(envelope.result!.resources.memoryMB).toBeGreaterThan(0);
    });

    it('resources has cwd (non-empty string)', () => {
      expect(typeof envelope.result!.resources.cwd).toBe('string');
      expect(envelope.result!.resources.cwd.length).toBeGreaterThan(0);
    });

    it('result.timestamp is an ISO-8601 string', () => {
      expect(envelope.result!.timestamp).toMatch(ISO_8601);
    });

    it('meta.provider_id is "health"', () => {
      expect(envelope.meta.provider_id).toBe('health');
    });

    it('meta.provider_name is "Health Check"', () => {
      expect(envelope.meta.provider_name).toBe('Health Check');
    });
  });

  describe('health-degraded fixture (one provider down)', () => {
    const envelope = loadFixture<HealthResult>('health-degraded');

    it('has schema_version "1"', () => {
      expect(envelope.schema_version).toBe('1');
    });

    it('is a valid success envelope (degraded is still ok:true)', () => {
      assertSuccessEnvelope(envelope, 'health-degraded');
    });

    it('result.status is "degraded"', () => {
      expect(envelope.result!.status).toBe('degraded');
    });

    it('at least one server is not "connected"', () => {
      const hasUnhealthy = envelope.result!.mcp.servers.some(s => s.status !== 'connected');
      expect(hasUnhealthy).toBe(true);
    });

    it('at least one server is "connected" (mixed state = degraded, not unhealthy)', () => {
      const hasConnected = envelope.result!.mcp.servers.some(s => s.status === 'connected');
      expect(hasConnected).toBe(true);
    });

    it('unavailable server entry has error field', () => {
      const unavailable = envelope.result!.mcp.servers.find(s => s.status === 'unavailable');
      expect(unavailable).toBeDefined();
      expect(typeof unavailable!.error).toBe('string');
    });

    it('meta is present on degraded health', () => {
      assertValidMeta(envelope.meta, 'health-degraded');
    });
  });
});

// ---------------------------------------------------------------------------
// Search tool contract alignment tests (must fail until implementation fixes)
// ---------------------------------------------------------------------------

describe('v1 schema freeze — search tool contract alignment', () => {
  /**
   * These tests verify the search tool's Zod schema and description align
   * with the frozen v1 contract. Some will fail until the implementation
   * removes the excerpt-first default and replaces fullText with content_mode.
   */

  it('SearchInputSchema must not expose a "fullText" field (legacy excerpt-first API)', async () => {
    // The v1 freeze mandates content_mode: "full" | "excerpt" as the API.
    // A "fullText: boolean" field implies excerpt-first as the base behavior,
    // which violates the full-content-by-default contract.
    // This test imports SearchInputSchema and asserts no fullText field is defined.
    const { SearchInputSchema } = await import('./search.js');
    const parsed = SearchInputSchema.safeParse({ query: 'test' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      // The frozen schema must not have a fullText field
      expect(parsed.data).not.toHaveProperty('fullText');
    }
  });

  it('SearchInputSchema must expose "content_mode" field aligned with v1 types', async () => {
    // The frozen contract uses content_mode: "full" | "excerpt" (matching ContentMode type).
    // The implementation currently uses fullText: boolean.
    // This test fails until the schema is updated to use content_mode.
    const { SearchInputSchema } = await import('./search.js');
    const parsed = SearchInputSchema.safeParse({ query: 'test', content_mode: 'full' });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toHaveProperty('content_mode');
      expect((parsed.data as Record<string, unknown>).content_mode).toBe('full');
    }
  });

  it('SearchInputSchema default content_mode must be "full" (full-content-by-default)', async () => {
    // The frozen v1 default is full content. The current schema defaults fullText: false
    // which means excerpt-first by default — a contract violation.
    const { SearchInputSchema } = await import('./search.js');
    const parsed = SearchInputSchema.parse({ query: 'test' });
    // Must default to full content, not excerpt
    expect((parsed as Record<string, unknown>).content_mode).toBe('full');
  });

  it('search tool description must not say "excerpt-first" or "30-line excerpt" as default', async () => {
    // The tool description must reflect the v1 full-content-by-default contract.
    const { createSearchTool } = await import('./search.js');
    const mockProvider = {
      name: 'Mock',
      isHealthy: () => Promise.resolve(true),
      search: () => Promise.resolve([]),
    } as unknown as import('../providers/searxng.js').SearxngProvider;
    const mockLogger = {
      debug: () => {}, info: () => {}, warn: () => {}, error: () => {},
    } as unknown as import('../lib/logger.js').Logger;
    const tool = createSearchTool(mockProvider, mockLogger);
    expect(tool.description.toLowerCase()).not.toContain('excerpt-first');
    expect(tool.description.toLowerCase()).not.toContain('30-line excerpt');
  });
});

// ---------------------------------------------------------------------------
// Runtime type-guard existence tests (must fail until guards are implemented)
// ---------------------------------------------------------------------------

describe('v1 schema freeze — runtime type guards', () => {
  /**
   * The quality gate requires: "Each fixture has corresponding type guard
   * that validates at runtime." These tests verify that runtime type guard
   * functions exist and work correctly. They fail until the type guards
   * are implemented.
   */

  it('isToolResponseEnvelope type guard must exist in domain/types or a guards module', async () => {
    // The freeze requires a runtime guard to validate fixture shapes at boot.
    // This fails until a isToolResponseEnvelope() guard is exported.
    const typeMod = await import('../domain/types.js') as Record<string, unknown>;
    const guardFound = typeof typeMod['isToolResponseEnvelope'] === 'function';
    // If not in types.js, the coder must create src/domain/guards.ts exporting it.
    // The test fails here if neither location provides the guard.
    expect(guardFound).toBe(true);
  });

  it('isSearchResult type guard must exist and validate the search fixture result shape', async () => {
    const typeMod = await import('../domain/types.js') as Record<string, unknown>;
    const guardFn = typeof typeMod['isSearchResult'] === 'function'
      ? typeMod['isSearchResult'] as (v: unknown) => boolean
      : undefined;
    // Fail if guard does not exist
    expect(guardFn).toBeDefined();
    if (guardFn) {
      const validResult = {
        id: 'test-id',
        url: 'https://example.com',
        title: 'Test',
        excerpt: 'Excerpt',
        source: 'web',
      };
      expect(guardFn(validResult)).toBe(true);
      expect(guardFn({ id: 'missing-required-fields' })).toBe(false);
    }
  });

  it('isReadResult type guard must exist and validate the read fixture result shape', async () => {
    const typeMod = await import('../domain/types.js') as Record<string, unknown>;
    const guardFn = typeof typeMod['isReadResult'] === 'function'
      ? typeMod['isReadResult'] as (v: unknown) => boolean
      : undefined;
    expect(guardFn).toBeDefined();
    if (guardFn) {
      const validResult = {
        url: 'https://example.com',
        excerpt: 'excerpt',
        content: 'full content',
        content_mode: 'full',
        content_truncated: false,
      };
      expect(guardFn(validResult)).toBe(true);
      // Invalid: missing content_mode
      expect(guardFn({ url: 'https://example.com', excerpt: 'x', content_truncated: false })).toBe(false);
    }
  });

  it('isResponseMeta type guard must exist and validate all required meta fields', async () => {
    const typeMod = await import('../domain/types.js') as Record<string, unknown>;
    const guardFn = typeof typeMod['isResponseMeta'] === 'function'
      ? typeMod['isResponseMeta'] as (v: unknown) => boolean
      : undefined;
    expect(guardFn).toBeDefined();
    if (guardFn) {
      const validMeta = {
        request_id: 'd1cd86d8-0a3a-49ba-a5e1-a1925078baf1',
        timestamp: '2026-03-31T10:00:00.000Z',
        provider_id: 'searxng',
        provider_name: 'SearXNG',
        applied_limits: {},
      };
      expect(guardFn(validMeta)).toBe(true);
      // Invalid: missing provider_id
      expect(guardFn({ request_id: 'x', timestamp: 'y', provider_name: 'z', applied_limits: {} })).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Cross-fixture invariants
// ---------------------------------------------------------------------------

describe('v1 schema freeze — cross-fixture invariants', () => {
  const allFixtureNames = [
    'search-success',
    'search-failure',
    'read-success-full',
    'read-success-truncated',
    'read-failure-ssrf',
    'gather-success',
    'gather-failure-partial',
    'health-success',
    'health-degraded',
  ] as const;

  it('every fixture has schema_version === "1"', () => {
    for (const name of allFixtureNames) {
      const f = loadFixture<unknown>(name);
      expect(f.schema_version, `${name}: schema_version must be '1'`).toBe('1');
    }
  });

  it('every fixture has a meta object with all required fields', () => {
    for (const name of allFixtureNames) {
      const f = loadFixture<unknown>(name);
      assertValidMeta(f.meta, name);
    }
  });

  it('no ok:true fixture has an error field', () => {
    for (const name of allFixtureNames) {
      const f = loadFixture<unknown>(name);
      if (f.ok) {
        expect(f.error, `${name}: ok:true must not have error`).toBeUndefined();
      }
    }
  });

  it('no ok:false fixture has a result field', () => {
    for (const name of allFixtureNames) {
      const f = loadFixture<unknown>(name);
      if (!f.ok) {
        expect(f.result, `${name}: ok:false must not have result`).toBeUndefined();
      }
    }
  });

  it('all ok:false fixtures have error.code, error.message, error.retryable', () => {
    for (const name of allFixtureNames) {
      const f = loadFixture<never>(name);
      if (!f.ok) {
        expect(f.error, `${name}: error must be defined`).toBeDefined();
        expect(typeof f.error!.code, `${name}: error.code must be string`).toBe('string');
        expect(typeof f.error!.message, `${name}: error.message must be string`).toBe('string');
        expect(typeof f.error!.retryable, `${name}: error.retryable must be boolean`).toBe('boolean');
      }
    }
  });

  it('SCHEMA_VERSION constant is exactly "1"', () => {
    // Freeze the constant itself — if this changes, the world breaks
    expect(SCHEMA_VERSION).toBe('1');
  });
});
