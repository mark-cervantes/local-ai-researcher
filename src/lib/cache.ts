/**
 * SQLite-backed cache module — opt-in baseline for v1.
 *
 * Design:
 * - Uses node:sqlite (Node 22.5+) for native SQLite support
 * - In-memory mode via ':memory:' path for tests
 * - WAL mode for file-based SQLite
 * - TTL enforcement on read
 * - Zero overhead when disabled
 */

import { DatabaseSync } from 'node:sqlite';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Cache entry returned on hit.
 * Contains the cached value plus metadata.
 */
export interface CacheEntry<T = unknown> {
  /** The cached value */
  value: T;
  /** Always true for cache hits */
  cache_hit: true;
  /** ISO timestamp when entry was cached */
  cached_at: string;
  /** TTL in milliseconds */
  ttl_ms: number;
}

/**
 * Options for constructing a Cache instance.
 */
export interface CacheOptions {
  /** SQLite database path (use ':memory:' for in-memory) */
  path: string;
  /** Default TTL in seconds */
  ttl: number;
  /** Whether cache is enabled */
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// buildCacheKey helper
// ---------------------------------------------------------------------------

/**
 * Build a stable cache key from URL and content_mode.
 *
 * Critical: full vs excerpt are DIFFERENT cache entries for the same URL.
 * This is required by task-11.01 gotcha.
 *
 * @param url - The URL being cached
 * @param content_mode - 'full' or 'excerpt'
 * @returns A stable cache key string
 */
export function buildCacheKey(url: string, content_mode: 'full' | 'excerpt'): string {
  // Use a delimiter that won't appear in URLs or content_mode
  return `${content_mode}:${url}`;
}

// ---------------------------------------------------------------------------
// Cache class
// ---------------------------------------------------------------------------

/**
 * SQLite-backed cache with TTL support.
 *
 * When disabled, all operations are no-ops with zero overhead.
 */
export class Cache {
  private db: DatabaseSync | null = null;
  private enabled: boolean;
  private defaultTtlMs: number;

  constructor(options: CacheOptions) {
    this.enabled = options.enabled;
    this.defaultTtlMs = options.ttl * 1000; // Convert seconds to milliseconds

    if (this.enabled) {
      // Open database - :memory: for in-memory, otherwise file path
      this.db = new DatabaseSync(options.path);

      // Enable WAL mode for file-based databases (not for :memory:)
      if (options.path !== ':memory:') {
        this.db.exec('PRAGMA journal_mode = WAL');
      }

      // Create cache table if not exists
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS cache (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          cached_at INTEGER NOT NULL,
          ttl_ms INTEGER NOT NULL
        )
      `);
    }
  }

  /**
   * Get a cached value by key.
   * Returns null for misses, expired entries, or when cache is disabled.
   */
  async get<T = unknown>(key: string): Promise<CacheEntry<T> | null> {
    if (!this.enabled || !this.db) {
      return null;
    }

    const stmt = this.db.prepare('SELECT value, cached_at, ttl_ms FROM cache WHERE key = ?');
    const row = stmt.get(key) as { value: string; cached_at: number; ttl_ms: number } | undefined;

    if (!row) {
      return null;
    }

    // Check TTL expiration
    const now = Date.now();
    const expiresAt = row.cached_at + row.ttl_ms;

    if (now >= expiresAt) {
      // Entry has expired - delete it and return null
      const deleteStmt = this.db.prepare('DELETE FROM cache WHERE key = ?');
      deleteStmt.run(key);
      return null;
    }

    // Parse the cached value
    const value = JSON.parse(row.value) as T;

    return {
      value,
      cache_hit: true,
      cached_at: new Date(row.cached_at).toISOString(),
      ttl_ms: row.ttl_ms,
    };
  }

  /**
   * Set a cached value with optional TTL override.
   * When cache is disabled, this is a no-op.
   *
   * @param key - Cache key
   * @param value - Value to cache (must be JSON-serializable)
   * @param ttlSeconds - TTL in seconds (uses default if not provided)
   */
  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    if (!this.enabled || !this.db) {
      return;
    }

    const ttlMs = (ttlSeconds ?? this.defaultTtlMs / 1000) * 1000;
    const cachedAt = Date.now();
    const valueJson = JSON.stringify(value);

    // Use INSERT OR REPLACE for upsert behavior (last write wins)
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO cache (key, value, cached_at, ttl_ms)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(key, valueJson, cachedAt, ttlMs);
  }

  /**
   * Check if a key exists and is not expired.
   * Returns false when cache is disabled.
   */
  async has(key: string): Promise<boolean> {
    if (!this.enabled || !this.db) {
      return false;
    }

    const stmt = this.db.prepare('SELECT cached_at, ttl_ms FROM cache WHERE key = ?');
    const row = stmt.get(key) as { cached_at: number; ttl_ms: number } | undefined;

    if (!row) {
      return false;
    }

    // Check TTL expiration
    const now = Date.now();
    const expiresAt = row.cached_at + row.ttl_ms;

    if (now >= expiresAt) {
      // Entry has expired - delete it and return false
      const deleteStmt = this.db.prepare('DELETE FROM cache WHERE key = ?');
      deleteStmt.run(key);
      return false;
    }

    return true;
  }

  /**
   * Close the database connection.
   * Safe to call multiple times.
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
