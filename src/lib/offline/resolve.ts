/**
 * Turns a track into a playable URL: local blob when it is cached, stream URL
 * otherwise.
 *
 * Two mobile lessons are baked in:
 *   - readiness is mirrored in an in-memory Set, so the UI can ask
 *     "is this cached?" synchronously on every render without touching IDB;
 *   - live blob URLs hold their whole file in memory, so the map is capped and
 *     the previous track's URL is revoked on switch.
 */

export interface ResolvedTrackUrl {
  url: string;
  source: 'cache' | 'stream';
}

export interface ResolverDeps {
  /** Cache keys of stored audio; usually wraps the offline DB. */
  listCachedIds: () => Promise<string[]>;
  getBlob: (id: string) => Promise<Blob | null>;
  streamUrl: (trackId: string) => string;
  createObjectUrl?: (blob: Blob) => string;
  revokeObjectUrl?: (url: string) => void;
  /** Keep this many blob URLs alive; the oldest is revoked beyond it. */
  maxObjectUrls?: number;
}

export class OfflineResolver {
  private readonly cachedIds = new Set<string>();
  private readonly objectUrls = new Map<string, string>();
  private primed = false;
  private priming: Promise<void> | null = null;
  private readonly maxObjectUrls: number;

  constructor(private readonly deps: ResolverDeps) {
    this.maxObjectUrls = deps.maxObjectUrls ?? (isMobileLike() ? 6 : 12);
  }

  /** Seed the in-memory readiness set from the cache (cheap: keys only). */
  async prime(): Promise<void> {
    if (this.primed) return;
    if (this.priming) return this.priming;
    this.priming = (async () => {
      try {
        const ids = await this.deps.listCachedIds();
        for (const id of ids) this.cachedIds.add(id);
      } catch {
        /* offline cache unavailable — everything streams */
      } finally {
        this.primed = true;
        this.priming = null;
      }
    })();
    return this.priming;
  }

  /** Synchronous readiness check for the UI. */
  isCached(trackId: string): boolean {
    return this.cachedIds.has(trackId);
  }

  get cachedCount(): number {
    return this.cachedIds.size;
  }

  /** Called by the download manager once a track is written. */
  markCached(trackId: string): void {
    this.cachedIds.add(trackId);
  }

  markRemoved(trackId: string): void {
    this.cachedIds.delete(trackId);
    this.releaseObjectUrl(trackId);
  }

  async resolve(trackId: string): Promise<ResolvedTrackUrl> {
    if (!this.cachedIds.has(trackId)) {
      return { url: this.deps.streamUrl(trackId), source: 'stream' };
    }

    const existing = this.objectUrls.get(trackId);
    if (existing) {
      // Refresh LRU position.
      this.objectUrls.delete(trackId);
      this.objectUrls.set(trackId, existing);
      return { url: existing, source: 'cache' };
    }

    let blob: Blob | null;
    try {
      blob = await this.deps.getBlob(trackId);
    } catch {
      // A transient IndexedDB failure must not kill playback. Fall back to
      // streaming, as prime() already does for cache errors, but keep the id: the
      // entry is probably still there, so a later resolve can use it.
      return { url: this.deps.streamUrl(trackId), source: 'stream' };
    }
    if (!blob) {
      // Metadata lied (evicted by the browser): fall back to streaming.
      this.cachedIds.delete(trackId);
      return { url: this.deps.streamUrl(trackId), source: 'stream' };
    }

    const url = (this.deps.createObjectUrl ?? defaultCreateObjectUrl)(blob);
    this.objectUrls.set(trackId, url);
    this.trimObjectUrls();
    return { url, source: 'cache' };
  }

  /** Revoke every blob URL (used on sign-out and teardown). */
  releaseAll(): void {
    for (const [id, url] of [...this.objectUrls.entries()]) {
      (this.deps.revokeObjectUrl ?? defaultRevokeObjectUrl)(url);
      this.objectUrls.delete(id);
    }
  }

  reset(): void {
    this.releaseAll();
    this.cachedIds.clear();
    this.primed = false;
  }

  private releaseObjectUrl(trackId: string): void {
    const url = this.objectUrls.get(trackId);
    if (!url) return;
    (this.deps.revokeObjectUrl ?? defaultRevokeObjectUrl)(url);
    this.objectUrls.delete(trackId);
  }

  private trimObjectUrls(): void {
    while (this.objectUrls.size > this.maxObjectUrls) {
      const oldest = this.objectUrls.keys().next();
      if (oldest.done) break;
      this.releaseObjectUrl(oldest.value);
    }
  }
}

function defaultCreateObjectUrl(blob: Blob): string {
  return URL.createObjectURL(blob);
}

function defaultRevokeObjectUrl(url: string): void {
  URL.revokeObjectURL(url);
}

function isMobileLike(): boolean {
  const ua = globalThis.navigator?.userAgent ?? '';
  return /android|iphone|ipad|mobile/i.test(ua);
}
