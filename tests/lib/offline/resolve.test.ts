import { describe, it, expect, vi, afterEach } from 'vitest';
import { OfflineResolver, type ResolverDeps } from '$lib/offline/resolve';
import { audioBlob, waitFor } from './helpers';

afterEach(() => {
  vi.unstubAllGlobals();
});

function harness(over: Partial<ResolverDeps> = {}) {
  const store = new Map<string, Blob>();
  const created: string[] = [];
  const revoked: string[] = [];
  let counter = 0;

  const deps: ResolverDeps = {
    listCachedIds: vi.fn(async () => [...store.keys()]),
    getBlob: vi.fn(async (id: string) => store.get(id) ?? null),
    streamUrl: (id: string) => `stream://${id}`,
    createObjectUrl: vi.fn((_blob: Blob) => {
      counter += 1;
      const url = `blob:mock/${counter}`;
      created.push(url);
      return url;
    }),
    revokeObjectUrl: vi.fn((url: string) => {
      revoked.push(url);
    }),
    ...over,
  };

  return { resolver: new OfflineResolver(deps), store, created, revoked, deps };
}

describe('prime()', () => {
  it('seeds the readiness set from the cache keys', async () => {
    const { resolver, store, deps } = harness();
    store.set('t1', audioBlob([1]));
    store.set('t2', audioBlob([2]));

    expect(resolver.cachedCount).toBe(0);
    await resolver.prime();

    expect(resolver.cachedCount).toBe(2);
    expect(resolver.isCached('t1')).toBe(true);
    expect(resolver.isCached('t2')).toBe(true);
    expect(resolver.isCached('nope')).toBe(false);
    expect(deps.listCachedIds).toHaveBeenCalledTimes(1);
  });

  it('only reads the cache once, even across repeated or concurrent calls', async () => {
    const { resolver, deps } = harness();
    await Promise.all([resolver.prime(), resolver.prime(), resolver.prime()]);
    await resolver.prime();
    expect(deps.listCachedIds).toHaveBeenCalledTimes(1);
  });

  it('marks itself primed even when the cache is unavailable', async () => {
    const { resolver, deps } = harness({
      listCachedIds: vi.fn(async () => {
        throw new Error('IndexedDB unavailable');
      }),
    });
    await expect(resolver.prime()).resolves.toBeUndefined();
    expect(resolver.cachedCount).toBe(0);
    // A later call must not retry the broken cache.
    await resolver.prime();
    expect(deps.listCachedIds).toHaveBeenCalledTimes(1);
  });

  it('does not report a track as cached before priming', () => {
    const { resolver } = harness();
    expect(resolver.isCached('t1')).toBe(false);
  });
});

describe('markCached() / markRemoved()', () => {
  it('markCached adds a track to the readiness set', () => {
    const { resolver } = harness();
    resolver.markCached('t1');
    expect(resolver.isCached('t1')).toBe(true);
    expect(resolver.cachedCount).toBe(1);
  });

  it('markRemoved forgets the track and revokes its live object URL', async () => {
    const { resolver, store, created, revoked } = harness();
    store.set('t1', audioBlob([1]));
    resolver.markCached('t1');
    await resolver.resolve('t1');
    expect(created).toEqual(['blob:mock/1']);

    resolver.markRemoved('t1');
    expect(resolver.isCached('t1')).toBe(false);
    expect(revoked).toEqual(['blob:mock/1']);
  });

  it('markRemoved is a no-op for a track with no object URL', () => {
    const { resolver, revoked } = harness();
    resolver.markRemoved('never');
    expect(revoked).toEqual([]);
  });
});

describe('resolve()', () => {
  it('streams a track that is not cached, without touching blobs', async () => {
    const { resolver, deps } = harness();
    const result = await resolver.resolve('t1');
    expect(result).toEqual({ url: 'stream://t1', source: 'stream' });
    expect(deps.getBlob).not.toHaveBeenCalled();
  });

  it('serves a cached track from a blob URL', async () => {
    const { resolver, store, created } = harness();
    store.set('t1', audioBlob([1, 2, 3]));
    resolver.markCached('t1');

    const result = await resolver.resolve('t1');
    expect(result).toEqual({ url: 'blob:mock/1', source: 'cache' });
    expect(created).toEqual(['blob:mock/1']);
  });

  it('reuses one object URL for repeated resolves of the same track', async () => {
    const { resolver, store, deps, created } = harness();
    store.set('t1', audioBlob([1]));
    resolver.markCached('t1');

    expect((await resolver.resolve('t1')).url).toBe('blob:mock/1');
    expect((await resolver.resolve('t1')).url).toBe('blob:mock/1');
    expect(deps.getBlob).toHaveBeenCalledTimes(1);
    expect(created).toHaveLength(1);
  });

  it('falls back to streaming (and forgets the track) when the blob was evicted', async () => {
    const { resolver, store, deps } = harness();
    resolver.markCached('t1'); // metadata says cached, but the blob is gone
    expect(resolver.isCached('t1')).toBe(true);

    const result = await resolver.resolve('t1');
    expect(result).toEqual({ url: 'stream://t1', source: 'stream' });
    expect(resolver.isCached('t1')).toBe(false);
    // The dead id is not retried on the next resolve.
    await resolver.resolve('t1');
    expect(deps.getBlob).toHaveBeenCalledTimes(1);
  });

  it('streams when the blob lookup throws', async () => {
    // Regression: resolve() awaited getBlob() unguarded, so a transient IndexedDB
    // failure rejected the whole resolve and killed playback instead of falling
    // back to streaming, which is how prime() already treats cache errors.
    const { resolver } = harness({
      getBlob: vi.fn(async () => {
        throw new Error('idb exploded');
      }),
    });
    resolver.markCached('t1');
    expect(await resolver.resolve('t1')).toEqual({ url: 'stream://t1', source: 'stream' });
  });
});

describe('object-URL cap and revocation', () => {
  it('never holds more than maxObjectUrls live URLs, revoking the oldest', async () => {
    const { resolver, store, created, revoked } = harness({ maxObjectUrls: 2 });
    for (const id of ['t1', 't2', 't3']) store.set(id, audioBlob([1]));
    await resolver.prime();

    await resolver.resolve('t1');
    await resolver.resolve('t2');
    expect(revoked).toEqual([]);

    await resolver.resolve('t3');
    // t1 was the oldest and is the one revoked.
    expect(revoked).toEqual(['blob:mock/1']);
    expect(created).toHaveLength(3);
    expect(created.length - revoked.length).toBe(2);
  });

  it('treats a re-resolve as a use, so the refreshed URL survives eviction', async () => {
    const { resolver, store, revoked } = harness({ maxObjectUrls: 2 });
    for (const id of ['t1', 't2', 't3']) store.set(id, audioBlob([1]));
    await resolver.prime();

    await resolver.resolve('t1');
    await resolver.resolve('t2');
    await resolver.resolve('t1'); // t1 is now most-recently used
    await resolver.resolve('t3');

    // t2 is now the oldest, not t1.
    expect(revoked).toEqual(['blob:mock/2']);
  });

  it('uses a smaller default cap on mobile user agents', async () => {
    vi.spyOn(globalThis.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (Linux; Android 13)',
    );
    const { resolver, store, revoked } = harness();
    for (let i = 1; i <= 7; i += 1) store.set(`t${i}`, audioBlob([1]));
    await resolver.prime();

    for (let i = 1; i <= 7; i += 1) await resolver.resolve(`t${i}`);
    // Mobile cap is 6, so exactly one URL (the first) was pushed out.
    expect(revoked).toEqual(['blob:mock/1']);
  });

  it('uses a larger default cap on desktop user agents', async () => {
    vi.spyOn(globalThis.navigator, 'userAgent', 'get').mockReturnValue(
      'Mozilla/5.0 (X11; Linux x86_64) Firefox/128',
    );
    const { resolver, store, created, revoked } = harness();
    for (let i = 1; i <= 12; i += 1) store.set(`t${i}`, audioBlob([1]));
    await resolver.prime();

    for (let i = 1; i <= 12; i += 1) await resolver.resolve(`t${i}`);
    expect(created).toHaveLength(12);
    expect(revoked).toEqual([]);
  });
});

describe('releaseAll() / reset()', () => {
  it('releaseAll revokes every live URL', async () => {
    const { resolver, store, created, revoked } = harness();
    store.set('t1', audioBlob([1]));
    store.set('t2', audioBlob([2]));
    resolver.markCached('t1');
    resolver.markCached('t2');
    await resolver.resolve('t1');
    await resolver.resolve('t2');

    resolver.releaseAll();
    expect(revoked.sort()).toEqual([...created].sort());
    // A subsequent resolve creates a fresh URL (the map was emptied).
    await resolver.resolve('t1');
    expect(created).toHaveLength(3);
  });

  it('reset clears readiness, URLs and re-runs prime', async () => {
    const { resolver, store, deps, revoked } = harness();
    store.set('t1', audioBlob([1]));
    await resolver.prime();
    await resolver.resolve('t1');
    expect(resolver.cachedCount).toBe(1);

    resolver.reset();
    expect(resolver.cachedCount).toBe(0);
    expect(resolver.isCached('t1')).toBe(false);
    expect(revoked).toEqual(['blob:mock/1']);

    await resolver.prime();
    expect(deps.listCachedIds).toHaveBeenCalledTimes(2);
    expect(resolver.isCached('t1')).toBe(true);
  });
});

describe('prime + resolve integration', () => {
  it('serves a primed cached track without any manual markCached', async () => {
    const { resolver, store } = harness();
    store.set('t1', audioBlob([1]));
    await resolver.prime();
    expect((await resolver.resolve('t1')).source).toBe('cache');
    // Sanity: a non-cached track still streams.
    expect((await resolver.resolve('t2')).source).toBe('stream');
  });

  it('resolve() does not wait for prime() to finish', async () => {
    const { resolver, deps } = harness();
    const [, url] = await Promise.all([resolver.prime(), resolver.resolve('t1')]);
    await waitFor(() => vi.mocked(deps.listCachedIds).mock.calls.length === 1);
    // Nothing was primed yet, so the track streams immediately.
    expect(url.source).toBe('stream');
  });
});
