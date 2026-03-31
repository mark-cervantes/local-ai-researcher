/**
 * Search tool — locked v1 implementation.
 *
 * Returns a normalized ToolResponseEnvelope wrapping SearchResult[].
 * All outputs are AI-first: schema_version, ok flag, typed error codes.
 */

import { randomUUID } from 'crypto';
import { z } from 'zod';
import type { SearchResult, ResponseMeta } from '../domain/types.js';
import { SCHEMA_VERSION } from '../domain/types.js';
import type { SearchProvider } from '../providers/interfaces.js';
import { ResearcherError } from '../lib/errors.js';
import { Logger } from '../lib/logger.js';
import type { ToolResponseEnvelope } from '../domain/types.js';
import { type Cache } from '../lib/cache.js';

// ---------------------------------------------------------------------------
// Input schema
// ---------------------------------------------------------------------------

/**
 * Search tool input — AI-facing contract (locked v1).
 */
export const SearchInputSchema = z.object({
  /** Search query string */
  query: z.string().min(1).max(500).describe('Search query'),

  /**
   * Max results to return (default: 5 per locked PRD).
   * Capped at 50.
   */
  limit: z.number().int().min(1).max(50).optional().default(5),

  /**
   * Content mode for search results (default: 'full').
   * 'full' returns full page text, 'excerpt' returns a preview.
   */
  content_mode: z.enum(['full', 'excerpt']).optional().default('full'),

  /** Search category (e.g., 'general', 'news', 'images') */
  category: z.string().optional(),

  /** Language code (e.g., 'en', 'de') */
  language: z.string().optional(),

  /** Time range filter (e.g., 'day', 'week', 'month') */
  timeRange: z.string().optional(),

  /**
   * Bypass cache for this request — forces fresh provider call.
   * Default: false. When true, cache lookup is skipped; cache is NOT updated.
   */
  bypass_cache: z.boolean().optional().default(false),
});

export type SearchInput = z.infer<typeof SearchInputSchema>;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create the search tool.
 */
export function createSearchTool(
  provider: SearchProvider,
  logger: Logger,
  options?: { timeoutMs?: number; cache?: Cache }
) {
  const timeoutMs = options?.timeoutMs ?? 10000; // Default 10s per locked PRD
  const cache = options?.cache ?? null;

  return {
    name: 'search',
    description:
      'Search the web using SearxNG. Returns result titles, canonical URLs, and content. ' +
      'Use content_mode: "full" for complete page text (default) or "excerpt" for a preview.',
    inputSchema: SearchInputSchema,

    /**
     * Handle a search request.
     */
    async handler(
      params: unknown
    ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
      const input = SearchInputSchema.parse(params);
      const requestId = randomUUID();
      const timestamp = new Date().toISOString();

      // Determine initial cache_status before any operation
      const cacheEnabled = cache !== null && cache.isEnabled();
      let cacheStatus: 'hit' | 'miss' | 'bypass' | 'disabled' = cacheEnabled
        ? (input.bypass_cache ? 'bypass' : 'miss')
        : 'disabled';

      const meta: ResponseMeta = {
        request_id: requestId,
        timestamp,
        provider_id: provider.id,
        provider_name: provider.name,
        applied_limits: {
          timeout_ms: timeoutMs,
          max_results: input.limit,
        },
        cache_status: cacheStatus,
      };

      logger.info('Search tool invoked', {
        component: 'search',
        query: input.query,
        limit: input.limit,
        content_mode: input.content_mode,
        bypass_cache: input.bypass_cache,
        request_id: requestId,
      });

      // Build cache key from query + relevant options
      const cacheKey = `search:${input.query}:${input.limit ?? 5}:${input.category ?? ''}:${input.language ?? ''}:${input.timeRange ?? ''}`;

      // Cache lookup when enabled and not bypassed
      if (cacheEnabled && !input.bypass_cache) {
        const cached = await cache.get<{ results: SearchResult[]; total: number }>(cacheKey);
        if (cached) {
          cacheStatus = 'hit';
          meta.cache_status = 'hit';
          logger.debug('Search cache hit', { component: 'search', query: input.query, request_id: requestId });

          const envelope: ToolResponseEnvelope<{ results: SearchResult[]; total: number }> = {
            schema_version: SCHEMA_VERSION,
            ok: true,
            meta,
            result: cached.value,
          };
          return { content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }] };
        }
        // cache miss — cacheStatus stays 'miss'
        logger.debug('Search cache miss', { component: 'search', query: input.query, request_id: requestId });
      }

      try {
        const results: SearchResult[] = await provider.search(input.query, {
          limit: input.limit,
          category: input.category,
          language: input.language,
          timeRange: input.timeRange,
        });

        logger.info('Search tool completed', {
          component: 'search',
          query: input.query,
          resultCount: results.length,
          cache_status: cacheStatus,
          request_id: requestId,
        });

        const payload = { results, total: results.length };

        // Store in cache on miss (not on bypass — bypass does not update cache)
        if (cacheEnabled && !input.bypass_cache) {
          await cache.set(cacheKey, payload);
        }

        const envelope: ToolResponseEnvelope<{ results: SearchResult[]; total: number }> = {
          schema_version: SCHEMA_VERSION,
          ok: true,
          meta,
          result: payload,
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
        };
      } catch (error) {
        logger.error('Search tool failed', {
          component: 'search',
          query: input.query,
          error: error instanceof Error ? error.message : 'Unknown error',
          cache_status: cacheStatus,
          request_id: requestId,
        });

        const envelope: ToolResponseEnvelope<never> = {
          schema_version: SCHEMA_VERSION,
          ok: false,
          meta,
          error: {
            code: error instanceof ResearcherError
              ? error.code
              : 'ERR_SEARXNG_UNAVAILABLE',
            message: error instanceof Error ? error.message : 'Unknown error',
            retryable: error instanceof ResearcherError ? error.retryable : false,
            details: error instanceof ResearcherError ? error.details : undefined,
          },
        };

        return {
          content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
          isError: true,
        };
      }
    },
  };
}
