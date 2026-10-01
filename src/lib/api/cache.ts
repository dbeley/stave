/**
 * A tiny TTL cache for metadata requests.
 *
 * List responses (a whole album list, an artist index) are expensive to rebuild
 * and change rarely, so pages can re-mount without hammering the server. Writes
 * (star/unstar/playlist edits) invalidate by key prefix.
 */

export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface ResponseCacheOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export class ResponseCache {
  private readonly entries = new Map<string, CacheEntry<unknown>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: ResponseCacheOptions = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.maxEntries = options.maxEntries ?? 200;
    this.now = options.now ?? (() => Date.now());
  }

  get<T>(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // Refresh LRU position.
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs = this.ttlMs): void {
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
  }

  /** Drop every entry whose key starts with one of the given prefixes. */
  invalidate(...prefixes: string[]): void {
    if (prefixes.length === 0) {
      this.entries.clear();
      return;
    }
    for (const key of [...this.entries.keys()]) {
      if (prefixes.some((prefix) => key.startsWith(prefix))) {
        this.entries.delete(key);
      }
    }
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
