/**
 * Tests for health tool — locked v1 contract.
 *
 * Tests verify:
 * 1. Envelope shape (schema_version, ok, meta, result/error)
 * 2. ResponseMeta fields on success and failure
 * 3. Provider readiness in health result
 * 4. Contract coverage (task 10.02): provider-specific readiness+latency, reader lane,
 *    overall status derivation, failure paths against frozen fixtures
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHealthTool, HealthInputSchema } from './health.js';
import type { HealthResult, ProviderHealthEntry } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { SearxngProvider } from '../providers/searxng.js';
import type { JinaReaderProvider } from '../providers/jinaReader.js';
import { Logger } from '../lib/logger.js';

// ---------------------------------------------------------------------------
// Fixture helpers (task 10.02 — contract against frozen v1 schema)
// ---------------------------------------------------------------------------

const __fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures');

function loadHealthFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(__fixturesDir, `${name}.json`), 'utf-8')) as T;
}

// ---------------------------------------------------------------------------
// Mock Factories
// ---------------------------------------------------------------------------

function createMockSearxngProvider(healthy: boolean = true): SearxngProvider {
  return {
    name: 'MockSearxNG',
    isHealthy: vi.fn().mockResolvedValue(healthy),
    checkHealth: vi.fn().mockResolvedValue(
      healthy
        ? { status: 'connected', latency_ms: 42 }
        : { status: 'unavailable', latency_ms: 5001, error: 'Health check returned unhealthy' }
    ),
  } as unknown as SearxngProvider;
}

function createMockJinaReaderProvider(healthy: boolean = true): JinaReaderProvider {
  return {
    name: 'MockJinaReader',
    isHealthy: vi.fn().mockResolvedValue(healthy),
    checkHealth: vi.fn().mockResolvedValue(
      healthy
        ? { status: 'connected', latency_ms: 38 }
        : { status: 'unavailable', latency_ms: 5001, error: 'Health check returned unhealthy' }
    ),
    canRead: vi.fn().mockReturnValue(true),
    read: vi.fn(),
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
// Tests
// ---------------------------------------------------------------------------

describe('HealthInputSchema', () => {
  it('validates empty input (no required fields)', () => {
    const result = HealthInputSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('defaults provider to "all"', () => {
    const result = HealthInputSchema.parse({});
    expect(result.provider).toBe('all');
  });

  it('accepts provider: "searxng"', () => {
    const result = HealthInputSchema.safeParse({ provider: 'searxng' });
    expect(result.success).toBe(true);
  });

  it('accepts provider: "jinaReader"', () => {
    const result = HealthInputSchema.safeParse({ provider: 'jinaReader' });
    expect(result.success).toBe(true);
  });

  it('accepts provider: "all"', () => {
    const result = HealthInputSchema.safeParse({ provider: 'all' });
    expect(result.success).toBe(true);
  });

  it('rejects invalid provider values', () => {
    const result = HealthInputSchema.safeParse({ provider: 'invalid' });
    expect(result.success).toBe(false);
  });
});

describe('createHealthTool', () => {
  let mockSearxngProvider: SearxngProvider;
  let mockJinaReaderProvider: JinaReaderProvider;
  let mockLogger: Logger;

  beforeEach(() => {
    mockSearxngProvider = createMockSearxngProvider(true);
    mockJinaReaderProvider = createMockJinaReaderProvider(true);
    mockLogger = createMockLogger();
  });

  describe('envelope shape', () => {
    it('returns valid envelope with ok: true on success', async () => {
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({});

      expect(response.isError).toBeUndefined();
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.schema_version).toBe(SCHEMA_VERSION);
      expect(envelope.ok).toBe(true);
      expect(envelope.result).toBeDefined();
    });

    it('includes HealthResult with required fields', async () => {
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({});

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const result: HealthResult = envelope.result;

      expect(result.status).toBeDefined();
      expect(result.mcp).toBeDefined();
      expect(result.mcp.stdio).toBeDefined();
      expect(result.mcp.servers).toBeDefined();
      expect(result.resources).toBeDefined();
      expect(result.timestamp).toBeDefined();
    });

    it('returns healthy when all providers are connected', async () => {
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({});

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.result.status).toBe('healthy');
    });

    it('returns degraded when some providers are unhealthy', async () => {
      mockSearxngProvider = createMockSearxngProvider(false);
      
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({});

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.result.status).toBe('degraded');
    });

    it('returns unhealthy when all providers are down', async () => {
      mockSearxngProvider = createMockSearxngProvider(false);
      mockJinaReaderProvider = createMockJinaReaderProvider(false);
      
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({});

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.result.status).toBe('unhealthy');
    });

    it('handles null providers gracefully', async () => {
      const tool = createHealthTool(null, null, mockLogger);
      const response = await tool.handler({});

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.ok).toBe(true);
      expect(envelope.result.status).toBe('unhealthy');
    });
  });

  describe('ResponseMeta contract (task 07.02)', () => {
    it('includes meta object on success', async () => {
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({});

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta).toBeDefined();
    });

    it('includes meta object on failure', async () => {
      // Force an error by having checkHealth throw (defensive fallback path)
      (mockSearxngProvider.checkHealth as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error('Health check failed')
      );
      
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({});

      // Tool should still succeed (it catches provider errors)
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta).toBeDefined();
    });

    it('meta has required request_id (UUID v4)', async () => {
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({});

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.request_id).toBeDefined();
      expect(typeof envelope.meta.request_id).toBe('string');
      // UUID v4 format: 8-4-4-4-12 hex chars
      expect(envelope.meta.request_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('meta has ISO-8601 timestamp', async () => {
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const beforeTime = new Date();
      const response = await tool.handler({});
      const afterTime = new Date();

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.timestamp).toBeDefined();
      
      const timestamp = new Date(envelope.meta.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime() - 1000);
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime() + 1000);
    });

    it('meta has provider_id for health tool', async () => {
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({});

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.provider_id).toBe('health');
    });

    it('meta has provider_name for health tool', async () => {
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({});

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.provider_name).toBe('Health Check');
    });

    it('meta has applied_limits object', async () => {
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({});

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.meta.applied_limits).toBeDefined();
      expect(typeof envelope.meta.applied_limits).toBe('object');
    });

    it('generates unique request_id for each call', async () => {
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response1 = await tool.handler({});
      const response2 = await tool.handler({});

      const envelope1 = JSON.parse(response1.content[0]?.text ?? '{}');
      const envelope2 = JSON.parse(response2.content[0]?.text ?? '{}');

      expect(envelope1.meta.request_id).not.toBe(envelope2.meta.request_id);
    });
  });

  describe('provider filtering', () => {
    it('checks only SearxNG when provider: "searxng"', async () => {
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({ provider: 'searxng' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const serverNames = envelope.result.mcp.servers.map((s: ProviderHealthEntry) => s.name);
      
      expect(serverNames).toContain('MockSearxNG');
      expect(serverNames).not.toContain('MockJinaReader');
    });

    it('checks only Jina Reader when provider: "jinaReader"', async () => {
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({ provider: 'jinaReader' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const serverNames = envelope.result.mcp.servers.map((s: ProviderHealthEntry) => s.name);
      
      expect(serverNames).not.toContain('MockSearxNG');
      expect(serverNames).toContain('MockJinaReader');
    });

    it('checks all providers by default', async () => {
      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({ provider: 'all' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const serverNames = envelope.result.mcp.servers.map((s: ProviderHealthEntry) => s.name);
      
      expect(serverNames).toContain('MockSearxNG');
      expect(serverNames).toContain('MockJinaReader');
    });
  });

  describe('search lane checkHealth integration (task 08.02)', () => {
    it('reports connected with latency when checkHealth returns connected', async () => {
      (mockSearxngProvider.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'connected',
        latency_ms: 123,
      });

      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({ provider: 'searxng' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const searxngEntry: ProviderHealthEntry = envelope.result.mcp.servers.find(
        (s: ProviderHealthEntry) => s.name === 'MockSearxNG'
      );

      expect(searxngEntry).toBeDefined();
      expect(searxngEntry!.status).toBe('connected');
      expect(searxngEntry!.latency_ms).toBe(123);
      expect(searxngEntry!.error).toBeUndefined();
    });

    it('reports unavailable with error when checkHealth returns unavailable', async () => {
      (mockSearxngProvider.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'unavailable',
        latency_ms: 5001,
        error: 'Connection refused',
      });

      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({ provider: 'searxng' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const searxngEntry: ProviderHealthEntry = envelope.result.mcp.servers.find(
        (s: ProviderHealthEntry) => s.name === 'MockSearxNG'
      );

      expect(searxngEntry).toBeDefined();
      expect(searxngEntry!.status).toBe('unavailable');
      expect(searxngEntry!.latency_ms).toBe(5001);
      expect(searxngEntry!.error).toBe('Connection refused');
    });

    it('reports error with ERR_SSRF_BLOCKED when checkHealth returns SSRF error', async () => {
      (mockSearxngProvider.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'error',
        latency_ms: 1,
        error: 'SSRF blocked: private network',
        error_code: 'ERR_SSRF_BLOCKED',
      });

      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({ provider: 'searxng' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const searxngEntry: ProviderHealthEntry = envelope.result.mcp.servers.find(
        (s: ProviderHealthEntry) => s.name === 'MockSearxNG'
      );

      expect(searxngEntry).toBeDefined();
      expect(searxngEntry!.status).toBe('error');
      expect(searxngEntry!.error_code).toBe('ERR_SSRF_BLOCKED');
    });

    it('health tool overall status reflects search lane unavailability', async () => {
      (mockSearxngProvider.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'unavailable',
        latency_ms: 5001,
        error: 'Timed out',
      });

      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({ provider: 'all' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      // SearxNG unavailable + JinaReader connected = degraded overall
      expect(envelope.result.status).toBe('degraded');
    });
  });
});

// ---------------------------------------------------------------------------
// Task 10.02: Contract coverage against frozen v1 schema
// ---------------------------------------------------------------------------

describe('health v1 contract coverage (task 10.02)', () => {
  // ---------------------------------------------------------------------------
  // Frozen fixture: overall status + provider-specific readiness
  // ---------------------------------------------------------------------------

  describe('frozen fixture: health-success (both providers ready)', () => {
    it('frozen health-success fixture has status "healthy"', () => {
      const fixture = loadHealthFixture<{ result: HealthResult }>('health-success');
      expect(fixture.result.status).toBe('healthy');
    });

    it('frozen health-success fixture has mcp.servers array with 2 entries', () => {
      const fixture = loadHealthFixture<{ result: HealthResult }>('health-success');
      expect(Array.isArray(fixture.result.mcp.servers)).toBe(true);
      expect(fixture.result.mcp.servers.length).toBe(2);
    });

    it('frozen health-success fixture search provider (SearxNG) has status "connected"', () => {
      const fixture = loadHealthFixture<{ result: HealthResult }>('health-success');
      const searxng = fixture.result.mcp.servers.find(s => s.name === 'SearxNG');
      expect(searxng).toBeDefined();
      expect(searxng!.status).toBe('connected');
    });

    it('frozen health-success fixture search provider (SearxNG) has latency_ms', () => {
      const fixture = loadHealthFixture<{ result: HealthResult }>('health-success');
      const searxng = fixture.result.mcp.servers.find(s => s.name === 'SearxNG');
      expect(typeof searxng!.latency_ms).toBe('number');
      expect(searxng!.latency_ms).toBeGreaterThan(0);
    });

    it('frozen health-success fixture reader provider (Jina Reader) has status "connected"', () => {
      const fixture = loadHealthFixture<{ result: HealthResult }>('health-success');
      const jina = fixture.result.mcp.servers.find(s => s.name === 'Jina Reader');
      expect(jina).toBeDefined();
      expect(jina!.status).toBe('connected');
    });

    it('frozen health-success fixture reader provider (Jina Reader) has latency_ms', () => {
      // The reader lane must include latency measurements in the frozen contract.
      const fixture = loadHealthFixture<{ result: HealthResult }>('health-success');
      const jina = fixture.result.mcp.servers.find(s => s.name === 'Jina Reader');
      expect(typeof jina!.latency_ms).toBe('number');
      expect(jina!.latency_ms).toBeGreaterThan(0);
    });

    it('frozen health-success fixture has no error fields on connected providers', () => {
      const fixture = loadHealthFixture<{ result: HealthResult }>('health-success');
      for (const server of fixture.result.mcp.servers) {
        if (server.status === 'connected') {
          expect(server.error).toBeUndefined();
          expect(server.error_code).toBeUndefined();
        }
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Frozen fixture: degraded state
  // ---------------------------------------------------------------------------

  describe('frozen fixture: health-degraded (one provider down)', () => {
    it('frozen health-degraded fixture has status "degraded"', () => {
      const fixture = loadHealthFixture<{ result: HealthResult }>('health-degraded');
      expect(fixture.result.status).toBe('degraded');
    });

    it('frozen health-degraded fixture has ok: true (degraded is still a success envelope)', () => {
      const fixture = loadHealthFixture<{ ok: boolean }>('health-degraded');
      expect(fixture.ok).toBe(true);
    });

    it('frozen health-degraded fixture unavailable provider (SearxNG) has error field', () => {
      const fixture = loadHealthFixture<{ result: HealthResult }>('health-degraded');
      const searxng = fixture.result.mcp.servers.find(s => s.name === 'SearxNG');
      expect(searxng).toBeDefined();
      expect(searxng!.status).toBe('unavailable');
      expect(typeof searxng!.error).toBe('string');
    });

    it('frozen health-degraded fixture unavailable provider has latency_ms (timeout evidence)', () => {
      // Even unavailable providers have a latency_ms representing the timeout duration.
      const fixture = loadHealthFixture<{ result: HealthResult }>('health-degraded');
      const searxng = fixture.result.mcp.servers.find(s => s.name === 'SearxNG');
      expect(typeof searxng!.latency_ms).toBe('number');
    });

    it('frozen health-degraded fixture still-connected provider (Jina Reader) has status "connected"', () => {
      const fixture = loadHealthFixture<{ result: HealthResult }>('health-degraded');
      const jina = fixture.result.mcp.servers.find(s => s.name === 'Jina Reader');
      expect(jina).toBeDefined();
      expect(jina!.status).toBe('connected');
    });

    it('frozen health-degraded fixture has meta with provider_id "health"', () => {
      const fixture = loadHealthFixture<{ meta?: { provider_id: string } }>('health-degraded');
      expect(fixture.meta?.provider_id).toBe('health');
    });
  });

  // ---------------------------------------------------------------------------
  // Runtime: Jina Reader lane checkHealth coverage
  // ---------------------------------------------------------------------------

  describe('reader lane (Jina Reader) checkHealth — frozen v1 contract', () => {
    let mockSearxngProvider: SearxngProvider;
    let mockJinaReaderProvider: JinaReaderProvider;
    let mockLogger: Logger;

    beforeEach(() => {
      mockSearxngProvider = {
        name: 'SearxNG',
        isHealthy: vi.fn().mockResolvedValue(true),
        checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 42 }),
      } as unknown as SearxngProvider;
      mockJinaReaderProvider = {
        name: 'Jina Reader',
        isHealthy: vi.fn().mockResolvedValue(true),
        checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 38 }),
        canRead: vi.fn().mockReturnValue(true),
        read: vi.fn(),
      } as unknown as JinaReaderProvider;
      mockLogger = {
        debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      } as unknown as Logger;
    });

    it('reader lane reports connected with latency when checkHealth returns connected', async () => {
      (mockJinaReaderProvider.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'connected',
        latency_ms: 77,
      });

      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({ provider: 'jinaReader' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const jinaEntry: ProviderHealthEntry = envelope.result.mcp.servers.find(
        (s: ProviderHealthEntry) => s.name === 'Jina Reader'
      );

      expect(jinaEntry).toBeDefined();
      expect(jinaEntry!.status).toBe('connected');
      expect(jinaEntry!.latency_ms).toBe(77);
      expect(jinaEntry!.error).toBeUndefined();
    });

    it('reader lane reports unavailable with error when checkHealth returns unavailable', async () => {
      (mockJinaReaderProvider.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'unavailable',
        latency_ms: 5001,
        error: 'Reader service timed out',
      });

      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({ provider: 'jinaReader' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const jinaEntry: ProviderHealthEntry = envelope.result.mcp.servers.find(
        (s: ProviderHealthEntry) => s.name === 'Jina Reader'
      );

      expect(jinaEntry).toBeDefined();
      expect(jinaEntry!.status).toBe('unavailable');
      expect(jinaEntry!.latency_ms).toBe(5001);
      expect(jinaEntry!.error).toBe('Reader service timed out');
    });

    it('reader lane latency is reflected in health response even when unavailable', async () => {
      (mockJinaReaderProvider.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'unavailable',
        latency_ms: 15000,
        error: 'Connection refused',
      });

      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({ provider: 'jinaReader' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      const jinaEntry: ProviderHealthEntry = envelope.result.mcp.servers.find(
        (s: ProviderHealthEntry) => s.name === 'Jina Reader'
      );

      expect(typeof jinaEntry!.latency_ms).toBe('number');
      expect(jinaEntry!.latency_ms).toBe(15000);
    });

    it('reader lane unavailability causes degraded overall status when search is connected', async () => {
      (mockJinaReaderProvider.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'unavailable',
        latency_ms: 5001,
        error: 'Timed out',
      });

      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({ provider: 'all' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      // Jina Reader unavailable + SearxNG connected = degraded overall
      expect(envelope.result.status).toBe('degraded');
    });

    it('both providers unavailable results in unhealthy overall status', async () => {
      (mockSearxngProvider.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'unavailable', latency_ms: 5001, error: 'Down',
      });
      (mockJinaReaderProvider.checkHealth as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        status: 'unavailable', latency_ms: 5001, error: 'Down',
      });

      const tool = createHealthTool(mockSearxngProvider, mockJinaReaderProvider, mockLogger);
      const response = await tool.handler({ provider: 'all' });

      const envelope = JSON.parse(response.content[0]?.text ?? '{}');
      expect(envelope.result.status).toBe('unhealthy');
    });
  });

  // ---------------------------------------------------------------------------
  // Overall status derivation — frozen v1 contract
  // ---------------------------------------------------------------------------

  describe('overall status derivation — frozen v1 contract', () => {
    let mockLogger: Logger;

    beforeEach(() => {
      mockLogger = {
        debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(),
      } as unknown as Logger;
    });

    it('status is "healthy" when both providers return "connected"', async () => {
      const searxng = {
        name: 'SearxNG',
        isHealthy: vi.fn().mockResolvedValue(true),
        checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 42 }),
      } as unknown as SearxngProvider;
      const jina = {
        name: 'Jina Reader',
        isHealthy: vi.fn().mockResolvedValue(true),
        checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 38 }),
        canRead: vi.fn(), read: vi.fn(),
      } as unknown as JinaReaderProvider;

      const tool = createHealthTool(searxng, jina, mockLogger);
      const response = await tool.handler({ provider: 'all' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');

      expect(envelope.result.status).toBe('healthy');
    });

    it('status is "degraded" when exactly one provider is connected', async () => {
      const searxng = {
        name: 'SearxNG',
        isHealthy: vi.fn().mockResolvedValue(false),
        checkHealth: vi.fn().mockResolvedValue({ status: 'unavailable', latency_ms: 5001, error: 'Down' }),
      } as unknown as SearxngProvider;
      const jina = {
        name: 'Jina Reader',
        isHealthy: vi.fn().mockResolvedValue(true),
        checkHealth: vi.fn().mockResolvedValue({ status: 'connected', latency_ms: 38 }),
        canRead: vi.fn(), read: vi.fn(),
      } as unknown as JinaReaderProvider;

      const tool = createHealthTool(searxng, jina, mockLogger);
      const response = await tool.handler({ provider: 'all' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');

      expect(envelope.result.status).toBe('degraded');
    });

    it('status is "unhealthy" when no providers are connected', async () => {
      const searxng = {
        name: 'SearxNG',
        isHealthy: vi.fn().mockResolvedValue(false),
        checkHealth: vi.fn().mockResolvedValue({ status: 'unavailable', latency_ms: 5001, error: 'Down' }),
      } as unknown as SearxngProvider;
      const jina = {
        name: 'Jina Reader',
        isHealthy: vi.fn().mockResolvedValue(false),
        checkHealth: vi.fn().mockResolvedValue({ status: 'unavailable', latency_ms: 5001, error: 'Down' }),
        canRead: vi.fn(), read: vi.fn(),
      } as unknown as JinaReaderProvider;

      const tool = createHealthTool(searxng, jina, mockLogger);
      const response = await tool.handler({ provider: 'all' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');

      expect(envelope.result.status).toBe('unhealthy');
    });

    it('status is "unhealthy" when no providers are configured (null both)', async () => {
      const tool = createHealthTool(null, null, mockLogger);
      const response = await tool.handler({ provider: 'all' });
      const envelope = JSON.parse(response.content[0]?.text ?? '{}');

      expect(envelope.result.status).toBe('unhealthy');
    });
  });
});
