/**
 * ChainedSearchProvider — multi-tier fallback chain with per-call probing.
 *
 * On every search() call:
 *   1. Iterate providers in order (primary, fallback_1, fallback_2, ...)
 *   2. For each provider, call checkHealth()
 *   3. If status is 'connected' or 'degraded' → use this provider
 *   4. If status is 'unavailable' or 'error' → skip to next provider, log warn
 *   5. If all providers fail → return last provider's error
 *
 * id / name dynamically expose whichever provider handled the last call so
 * meta.provider_id in tool responses stays accurate.
 *
 * checkHealth() returns the first healthy provider's health, or the last
 * provider's health if all are down.
 *
 * Completely inert when not instantiated — the constructor is only called
 * when fallbacks are configured (wired in index.ts).
 */

import type { SearchOptions, SearchResult } from '../domain/types.js';
import type { SearchProvider, ProviderHealth } from './interfaces.js';
import { Logger } from '../lib/logger.js';

export class ChainedSearchProvider implements SearchProvider {
  private readonly providers: SearchProvider[];
  private readonly logger: Logger;
  private activeProvider: SearchProvider;

  constructor(providers: SearchProvider[], logger: Logger) {
    if (providers.length === 0) {
      throw new Error('ChainedSearchProvider requires at least one provider');
    }
    this.providers = providers;
    this.logger = logger;
    // Default to first provider for synchronous id/name access
    this.activeProvider = providers[0]!;
  }

  /**
   * The active provider id reflects whichever handled the last call.
   * Falls back to first provider before any calls are made.
   */
  get id(): string {
    return this.activeProvider.id;
  }

  get name(): string {
    return this.activeProvider.name;
  }

  /**
   * Perform a search with per-call provider probing.
   *
   * Iterates providers in order, checking health of each. Uses the first
   * provider with status 'connected' or 'degraded'. Logs skipped providers
   * as warnings. Does not mutate any shared state beyond activeProvider.
   */
  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    let lastHealth: ProviderHealth | null = null;

    for (const provider of this.providers) {
      const health = await provider.checkHealth();
      lastHealth = health;

      if (health.status === 'connected' || health.status === 'degraded') {
        // Found a healthy provider — use it
        this.activeProvider = provider;

        this.logger.debug('ChainedSearchProvider: using provider', {
          component: 'ChainedSearchProvider',
          providerId: provider.id,
          providerName: provider.name,
          healthStatus: health.status,
          latency_ms: health.latency_ms,
        });

        return provider.search(query, options);
      }

      // Provider is unavailable or error — log and try next
      this.logger.warn('ChainedSearchProvider: provider unavailable, trying next in chain', {
        component: 'ChainedSearchProvider',
        providerId: provider.id,
        providerName: provider.name,
        healthStatus: health.status,
        reason: health.error,
        remainingProviders: this.providers.length - this.providers.indexOf(provider) - 1,
      });
    }

    // All providers failed — use last provider and let it throw its error
    const lastProvider = this.providers[this.providers.length - 1]!;
    this.activeProvider = lastProvider;

    this.logger.error('ChainedSearchProvider: all providers failed', {
      component: 'ChainedSearchProvider',
      lastProviderId: lastProvider.id,
      lastHealthStatus: lastHealth?.status,
      lastError: lastHealth?.error,
    });

    // Delegate to last provider — it will throw its own error
    return lastProvider.search(query, options);
  }

  /**
   * Returns the first healthy provider's health, or the last provider's
   * health if all are down. Useful for the health tool to report actual state.
   */
  async checkHealth(): Promise<ProviderHealth> {
    let lastHealth: ProviderHealth | null = null;

    for (const provider of this.providers) {
      const health = await provider.checkHealth();
      lastHealth = health;

      if (health.status === 'connected' || health.status === 'degraded') {
        this.activeProvider = provider;
        return health;
      }
    }

    // All providers down — return last health
    const lastProvider = this.providers[this.providers.length - 1]!;
    this.activeProvider = lastProvider;
    return lastHealth!;
  }
}
