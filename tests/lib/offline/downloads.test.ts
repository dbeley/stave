import { describe, it, expect, vi, afterEach } from 'vitest';
import { DownloadManager, type DownloadManagerDeps } from '$lib/offline/downloads.svelte';
import { IdbBlobStore, type BlobStore } from '$lib/offline/blobStore';
import type { Album, Track } from '$lib/domain/types';
import {
  audioBlob,
  blobBytes,
  closeOpenedDbs,
  controllableFetch,
  freshDb,
  GatedBlobStore,
  waitFor,
  waitUntil,
} from './helpers';

function track(id: string, over: Partial<Track> = {}): Track {
  return { id, title: `Track ${id}`, durationSec: 180, starred: false, ...over };
}

function album(id: string, tracks?: Track[], over: Partial<Album> = {}): Album {
  return {
    id,
    name: `Album ${id}`,
    artistName: 'Artist',
    songCount: tracks?.length ?? 1,
    durationSec: 0,
    starred: false,
    ...(tracks ? { tracks } : {}),
    ...over,
  };
}

function makeManager(over: Partial<DownloadManagerDeps> = {}) {
  const db = over.db ?? freshDb();
  const innerBlobs: BlobStore = over.blobs ?? new IdbBlobStore(db);
  const blobs = new GatedBlobStore(innerBlobs);
  const fetch = controllableFetch();
  const manager = new DownloadManager({
    loadAlbum: async (id) => album(id, [track(`${id}-t1`)]),
    ...over,
    db,
    blobs,
    fetchAudio: over.fetchAudio ?? fetch.fetchAudio,
  });
  return { manager, db, blobs, innerBlobs, fetch };
}

type Harness = ReturnType<typeof makeManager>;

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Drive a download to a terminal state, resolving fetches as they appear. */
async function runToCompletion(h: Harness, albumId: string) {
  const deadline = Date.now() + 4000;
  for (;;) {
    const entry = h.manager.entry(albumId);
    if (!entry || entry.status === 'cached' || entry.status === 'failed') {
      await tick();
      const settled = h.manager.entry(albumId);
      if (!settled || settled.status === 'cached' || settled.status === 'failed') return settled;
    }
    if (h.fetch.pending.length > 0) h.fetch.resolveNext();
    if (Date.now() > deadline) throw new Error('download did not settle');
    await tick();
  }
}

afterEach(() => {
  closeOpenedDbs();
});

describe('enqueue()', () => {
  it('queues an album and downloads every track', async () => {
    const h = makeManager();
    expect(h.manager.entries).toEqual([]);

    h.manager.enqueue(album('a1', [track('t1'), track('t2')]));
    const queued = h.manager.entry('a1');
    expect(queued?.status).toBe('queued');
    expect(queued?.total).toBe(2);
    expect(queued?.done).toBe(0);

    const done = await runToCompletion(h, 'a1');

    expect(done?.status).toBe('cached');
    expect(done?.done).toBe(2);
    expect(done?.total).toBe(2);
    expect(done?.bytes).toBe(6);
    expect(done?.error).toBeUndefined();
    expect(h.manager.isCached('a1')).toBe(true);
    expect(h.manager.cachedBytes).toBe(6);
  });

  it('writes the audio blob and the track metadata row', async () => {
    const h = makeManager();
    h.manager.enqueue(album('a1', [track('t1')]));
    await runToCompletion(h, 'a1');

    expect(await blobBytes((await h.db.getBlob('t1'))!)).toEqual([1, 2, 3]);
    expect(await h.db.getTrack('t1')).toMatchObject({
      id: 't1',
      albumId: 'a1',
      albumName: 'Album a1',
      artistName: 'Artist',
      title: 'Track t1',
      durationSec: 180,
      storedBytes: 3,
      contentType: 'audio/mpeg',
    });

    const meta = await h.db.getAlbumMeta('a1');
    expect(meta?.trackIds).toEqual(['t1']);
    expect(meta?.bytes).toBe(3);
    expect(meta?.albumName).toBe('Album a1');
  });

  it('copies optional track fields into the metadata row', async () => {
    const h = makeManager({
      fetchAudio: vi.fn(async () => audioBlob([1, 2, 3, 4], 'audio/flac')),
    });
    const detailed = track('t1', { trackNumber: 3, discNumber: 2, suffix: 'flac', sizeBytes: 500 });
    h.manager.enqueue(album('a1', [detailed]));
    await runToCompletion(h, 'a1');

    expect(await h.db.getTrack('t1')).toMatchObject({
      trackNumber: 3,
      discNumber: 2,
      suffix: 'flac',
      sizeBytes: 500,
      storedBytes: 4,
      contentType: 'audio/flac',
    });
  });

  it('is a no-op while the same album is queued or downloading', async () => {
    const h = makeManager({ concurrency: 1 });
    h.manager.enqueue(album('a1', [track('t1')]));
    h.manager.enqueue(album('a1', [track('t1')]));
    await runToCompletion(h, 'a1');
    expect(h.fetch.calls).toBe(1);
  });

  it('is a no-op for an already-cached album', async () => {
    const h = makeManager();
    h.manager.enqueue(album('a1', [track('t1')]));
    await runToCompletion(h, 'a1');

    h.manager.enqueue(album('a1', [track('t1')]));
    expect(h.manager.entry('a1')?.status).toBe('cached');
    expect(h.fetch.calls).toBe(1);
  });

  it('uses songCount as the total until the track list is loaded', async () => {
    const h = makeManager({
      loadAlbum: vi.fn(async (id) => album(id, [track('t1'), track('t2')])),
    });
    h.manager.enqueue(album('a1', undefined, { songCount: 2 }));
    expect(h.manager.entry('a1')?.total).toBe(2);
    await runToCompletion(h, 'a1');
    expect(h.manager.entry('a1')?.total).toBe(2);
  });

  it('reports progress as tracks land', async () => {
    const h = makeManager({ concurrency: 1 });
    h.manager.enqueue(album('a1', [track('t1'), track('t2')]));
    await waitFor(() => h.fetch.pending.length === 1);
    expect(h.manager.entry('a1')?.done).toBe(0);

    h.fetch.resolveNext();
    await waitFor(() => h.fetch.pending.length === 1);
    expect(h.manager.entry('a1')?.done).toBe(1);
    expect(h.manager.entry('a1')?.status).toBe('downloading');

    await runToCompletion(h, 'a1');
    expect(h.manager.entry('a1')?.status).toBe('cached');
  });
});

describe('already-cached tracks', () => {
  it('skips a track whose blob and metadata already exist', async () => {
    const h = makeManager();
    await h.db.putTrack({
      id: 't1',
      albumId: 'a1',
      title: 'Track t1',
      durationSec: 180,
      cachedAt: 0,
      storedBytes: 3,
    });
    await h.innerBlobs.put('t1', audioBlob([1, 2, 3]));

    h.manager.enqueue(album('a1', [track('t1'), track('t2')]));
    const done = await runToCompletion(h, 'a1');

    expect(h.fetch.calls).toBe(1); // only t2 was transferred
    expect(done?.status).toBe('cached');
    expect(done?.done).toBe(2);
    expect((await h.db.getAlbumMeta('a1'))?.trackIds).toEqual(['t1', 't2']);
  });

  it.fails('counts bytes of already-cached tracks in the album total', async () => {
    // BUG (src/lib/offline/downloads.svelte.ts:258-261): the isTrackReady()
    // fast path records the track in `trackIds` but never adds its size to
    // `bytes`, so a resumed/re-downloaded album under-reports the bytes it
    // actually holds (t1 = 3 already stored, t2 = 3 fetched).
    const h = makeManager();
    await h.db.putTrack({
      id: 't1',
      albumId: 'a1',
      title: 'Track t1',
      durationSec: 180,
      cachedAt: 0,
      storedBytes: 3,
    });
    await h.innerBlobs.put('t1', audioBlob([1, 2, 3]));

    h.manager.enqueue(album('a1', [track('t1'), track('t2')]));
    const done = await runToCompletion(h, 'a1');
    expect(done?.bytes).toBe(6);
    expect((await h.db.getAlbumMeta('a1'))?.bytes).toBe(6);
  });

  it('re-downloads a track whose metadata exists but whose blob is gone', async () => {
    const h = makeManager();
    await h.db.putTrack({
      id: 't1',
      albumId: 'a1',
      title: 'Track t1',
      durationSec: 180,
      cachedAt: 0,
    });

    h.manager.enqueue(album('a1', [track('t1')]));
    await runToCompletion(h, 'a1');
    expect(h.fetch.calls).toBe(1);
    expect(await h.db.getBlob('t1')).not.toBeNull();
  });
});

describe('failure handling', () => {
  it('marks the album failed when fetching audio throws', async () => {
    const h = makeManager({
      fetchAudio: vi.fn(async () => {
        throw new Error('network down');
      }),
    });
    h.manager.enqueue(album('a1', [track('t1')]));
    const done = await runToCompletion(h, 'a1');

    expect(done?.status).toBe('failed');
    expect(done?.error).toBe('network down');
    expect(await h.db.listAllTrackIds()).toEqual([]);
    expect(await h.db.getAlbumMeta('a1')).toBeNull();
  });

  it('marks the album failed when storing the blob throws', async () => {
    const failing: BlobStore = {
      put: vi.fn(async () => {
        throw new Error('quota exceeded');
      }),
      get: vi.fn(async () => null),
      delete: vi.fn(async () => {}),
      keys: vi.fn(async () => []),
    };
    const h = makeManager({ blobs: failing });
    h.manager.enqueue(album('a1', [track('t1')]));
    const done = await runToCompletion(h, 'a1');

    expect(done?.status).toBe('failed');
    expect(done?.error).toBe('quota exceeded');
    expect(await h.db.listAllTrackIds()).toEqual([]);
  });

  it('marks the album failed when loadAlbum throws', async () => {
    const h = makeManager({
      loadAlbum: vi.fn(async () => {
        throw new Error('album gone');
      }),
    });
    h.manager.enqueue(album('a1', undefined, { songCount: 3 }));
    const done = await runToCompletion(h, 'a1');
    expect(done?.status).toBe('failed');
    expect(done?.error).toBe('album gone');
  });

  it('marks the album failed when it has no tracks', async () => {
    const h = makeManager({ loadAlbum: vi.fn(async (id) => album(id, [])) });
    h.manager.enqueue(album('a1', undefined, { songCount: 0 }));
    const done = await runToCompletion(h, 'a1');
    expect(done?.status).toBe('failed');
    expect(done?.error).toBe('album has no tracks');
  });

  it('keeps failed entries on the books for an explicit retry', async () => {
    const h = makeManager({
      fetchAudio: vi.fn(async () => {
        throw new Error('boom');
      }),
    });
    h.manager.enqueue(album('a1', [track('t1')]));
    await runToCompletion(h, 'a1');
    expect(h.manager.entry('a1')?.status).toBe('failed');
    expect(h.manager.isCached('a1')).toBe(false);
    expect(h.manager.cachedBytes).toBe(0);
  });
});

describe('retry()', () => {
  it('re-runs a failed album and clears the error/progress', async () => {
    let attempt = 0;
    const fetchAudio = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new Error('flaky');
      return audioBlob([1, 2, 3]);
    });
    const h = makeManager({ fetchAudio });
    h.manager.enqueue(album('a1', [track('t1')]));
    await runToCompletion(h, 'a1');
    expect(h.manager.entry('a1')?.status).toBe('failed');

    h.manager.retry('a1');
    expect(h.manager.entry('a1')?.status).toBe('queued');
    expect(h.manager.entry('a1')?.error).toBeUndefined();
    expect(h.manager.entry('a1')?.done).toBe(0);

    const done = await runToCompletion(h, 'a1');
    expect(done?.status).toBe('cached');
    expect(fetchAudio).toHaveBeenCalledTimes(2);
  });

  it('is a no-op for a cached album or one already downloading', async () => {
    const h = makeManager({ concurrency: 1 });
    h.manager.enqueue(album('a1', [track('t1')]));
    await waitFor(() => h.fetch.pending.length === 1);
    h.manager.retry('a1'); // still downloading: ignored
    expect(h.manager.entry('a1')?.status).toBe('downloading');
    await runToCompletion(h, 'a1');

    h.manager.retry('a1'); // cached: ignored
    expect(h.manager.entry('a1')?.status).toBe('cached');
    expect(h.fetch.calls).toBe(1);
  });

  it('is a no-op for an unknown album', () => {
    const h = makeManager();
    h.manager.retry('ghost');
    expect(h.manager.entry('ghost')).toBeUndefined();
  });
});

describe('cancellation', () => {
  it('cancelling mid-fetch leaves no track, blob or album metadata behind', async () => {
    const h = makeManager();
    h.manager.enqueue(album('a1', [track('t1'), track('t2')]));
    await waitFor(() => h.fetch.pending.length === 1);

    await h.manager.cancel('a1');
    // "forget it": the entry is gone, not left failed.
    expect(h.manager.entry('a1')).toBeUndefined();

    // Let the in-flight fetch finish; the stale write must be dropped.
    h.fetch.resolveNext();
    await tick();
    await tick();

    expect(await h.db.listAllTrackIds()).toEqual([]);
    expect(await h.db.listBlobKeys()).toEqual([]);
    expect(await h.db.listAlbumMeta()).toEqual([]);
  });

  it('rolls back a blob written after the cancel (no partial entry)', async () => {
    const h = makeManager();
    const release = h.blobs.blockPuts();

    h.manager.enqueue(album('a1', [track('t1')]));
    await waitFor(() => h.fetch.pending.length === 1);
    h.fetch.resolveNext();
    // Park the download right after fetch, before the blob is committed.
    await waitFor(() => h.blobs.pendingPuts === 1);

    await h.manager.cancel('a1');
    expect(h.manager.entry('a1')).toBeUndefined();

    release();
    await waitFor(() => h.blobs.completedPuts === 1);
    // The download notices it is stale and deletes the blob it just wrote.
    await waitUntil(async () => (await h.blobs.keys()).length === 0);

    expect(await h.db.listAllTrackIds()).toEqual([]);
    expect(await h.db.getAlbumMeta('a1')).toBeNull();
    expect((await h.blobs.keys()).length).toBe(0);
  });

  it('cancel() removes data that had already been cached', async () => {
    const onTrackRemoved = vi.fn();
    const h = makeManager({ onTrackRemoved });
    h.manager.enqueue(album('a1', [track('t1'), track('t2')]));
    await runToCompletion(h, 'a1');
    expect(await h.db.listAllTrackIds()).not.toEqual([]);

    await h.manager.cancel('a1');

    expect(await h.db.listAllTrackIds()).toEqual([]);
    expect(await h.db.listBlobKeys()).toEqual([]);
    expect(await h.db.listAlbumMeta()).toEqual([]);
    expect(h.manager.entry('a1')).toBeUndefined();
    expect(onTrackRemoved.mock.calls.map((c) => c[0]).sort()).toEqual(['t1', 't2']);
  });
});

describe('remove()', () => {
  it('deletes the album data and notices each removed track', async () => {
    const onTrackRemoved = vi.fn();
    const h = makeManager({ onTrackRemoved });
    h.manager.enqueue(album('a1', [track('t1'), track('t2')]));
    await runToCompletion(h, 'a1');

    await h.manager.remove('a1');

    expect(await h.db.listTrackIdsByAlbum('a1')).toEqual([]);
    expect(await h.db.listBlobKeys()).toEqual([]);
    expect(await h.db.getAlbumMeta('a1')).toBeNull();
    expect(h.manager.entry('a1')).toBeUndefined();
    expect(onTrackRemoved).toHaveBeenCalledTimes(2);
  });

  it('is safe for an album that is not cached', async () => {
    const h = makeManager();
    await expect(h.manager.remove('ghost')).resolves.toBeUndefined();
    expect(h.manager.entry('ghost')).toBeUndefined();
  });
});

describe('clearAll()', () => {
  it('wipes every cached album and its bytes', async () => {
    const onTrackRemoved = vi.fn();
    const h = makeManager({ onTrackRemoved });
    h.manager.enqueue(album('a1', [track('t1')]));
    h.manager.enqueue(album('a2', [track('t2')]));
    await runToCompletion(h, 'a1');
    await runToCompletion(h, 'a2');
    expect(h.manager.cachedBytes).toBe(6);

    await h.manager.clearAll();

    expect(h.manager.entries).toEqual([]);
    expect(h.manager.cachedBytes).toBe(0);
    expect(await h.db.listAllTrackIds()).toEqual([]);
    expect(await h.db.listBlobKeys()).toEqual([]);
    expect(await h.db.listAlbumMeta()).toEqual([]);
    expect(onTrackRemoved).toHaveBeenCalledTimes(2);
  });

  it('cancels an in-flight download without writing anything', async () => {
    const h = makeManager();
    h.manager.enqueue(album('a1', [track('t1')]));
    await waitFor(() => h.fetch.pending.length === 1);

    await h.manager.clearAll();
    h.fetch.resolveNext();
    await tick();
    await tick();

    expect(h.manager.entries).toEqual([]);
    expect(await h.db.listAllTrackIds()).toEqual([]);
    expect(await h.db.listBlobKeys()).toEqual([]);
  });
});

describe('hydrate()', () => {
  it('restores cached albums from stored metadata', async () => {
    const h = makeManager();
    await h.db.putAlbumMeta({
      albumId: 'a1',
      albumName: 'Album a1',
      trackIds: ['t1', 't2'],
      bytes: 42,
      cachedAt: 1000,
    });

    await h.manager.hydrate();

    expect(h.manager.entry('a1')).toMatchObject({
      albumId: 'a1',
      albumName: 'Album a1',
      status: 'cached',
      total: 2,
      done: 2,
      bytes: 42,
      updatedAt: 1000,
    });
    expect(h.manager.isCached('a1')).toBe(true);
    expect(h.manager.cachedBytes).toBe(42);
  });

  it('does not trigger any download for the restored entries', async () => {
    const h = makeManager();
    await h.db.putAlbumMeta({
      albumId: 'a1',
      albumName: 'Album a1',
      trackIds: ['t1'],
      bytes: 3,
      cachedAt: 0,
    });
    await h.manager.hydrate();
    await tick();
    expect(h.fetch.calls).toBe(0);
  });

  it('keeps existing entries and does not throw when the cache read fails', async () => {
    const h = makeManager();
    h.manager.enqueue(album('a1', [track('t1')]));
    await runToCompletion(h, 'a1');

    vi.spyOn(h.db, 'listAlbumMeta').mockRejectedValue(new Error('idb unavailable'));
    await expect(h.manager.hydrate()).resolves.toBeUndefined();
    expect(h.manager.entry('a1')?.status).toBe('cached');
  });
});

describe('concurrency', () => {
  it('runs no more than `concurrency` transfers at once', async () => {
    const h = makeManager({ concurrency: 1 });
    h.manager.enqueue(album('a1', [track('a1-t1')]));
    h.manager.enqueue(album('a2', [track('a2-t1')]));

    await waitFor(() => h.fetch.pending.length === 1);
    expect(h.fetch.maxInFlight).toBe(1);
    expect(h.fetch.pending[0]!.track.id).toBe('a1-t1');

    h.fetch.resolveNext();
    await waitFor(() => h.fetch.pending.length === 1);
    expect(h.fetch.pending[0]!.track.id).toBe('a2-t1');
    expect(h.fetch.maxInFlight).toBe(1);

    h.fetch.resolveNext();
    await waitFor(() => h.manager.isCached('a1') && h.manager.isCached('a2'));
  });

  it('runs up to `concurrency` transfers in parallel', async () => {
    const h = makeManager({ concurrency: 2 });
    h.manager.enqueue(album('a1', [track('a1-t1')]));
    h.manager.enqueue(album('a2', [track('a2-t1')]));

    await waitFor(() => h.fetch.pending.length === 2);
    expect(h.fetch.maxInFlight).toBe(2);
    expect(h.fetch.pending.map((p) => p.track.id).sort()).toEqual(['a1-t1', 'a2-t1']);

    h.fetch.resolveNext();
    h.fetch.resolveNext();
    await waitFor(() => h.manager.isCached('a1') && h.manager.isCached('a2'));
  });

  it('treats a concurrency below 1 as 1', async () => {
    const h = makeManager({ concurrency: 0 });
    h.manager.enqueue(album('a1', [track('a1-t1')]));
    h.manager.enqueue(album('a2', [track('a2-t1')]));
    await waitFor(() => h.fetch.pending.length === 1);
    expect(h.fetch.maxInFlight).toBe(1);
    h.fetch.resolveNext();
    await waitFor(() => h.fetch.pending.length === 1);
    h.fetch.resolveNext();
    await waitFor(() => h.manager.isCached('a1') && h.manager.isCached('a2'));
  });
});

describe('callbacks and cache accounting', () => {
  it('notices every cached track with its metadata', async () => {
    const onTrackCached = vi.fn();
    const h = makeManager({ onTrackCached });
    h.manager.enqueue(album('a1', [track('t1')]));
    await runToCompletion(h, 'a1');

    expect(onTrackCached).toHaveBeenCalledTimes(1);
    const [notedTrack, notedMeta] = onTrackCached.mock.calls[0]!;
    expect((notedTrack as Track).id).toBe('t1');
    expect(notedMeta).toMatchObject({ id: 't1', albumId: 'a1', storedBytes: 3 });
  });

  it('cachedBytes counts only fully cached albums', async () => {
    const h = makeManager({
      fetchAudio: vi.fn(async (t: Track) => {
        if (t.id === 'bad') throw new Error('nope');
        return audioBlob([1, 2, 3]);
      }),
    });
    h.manager.enqueue(album('good', [track('ok')]));
    h.manager.enqueue(album('bad', [track('bad')]));
    await runToCompletion(h, 'good');
    await runToCompletion(h, 'bad');

    expect(h.manager.entry('good')?.status).toBe('cached');
    expect(h.manager.entry('bad')?.status).toBe('failed');
    expect(h.manager.cachedBytes).toBe(3);
  });

  it('exposes entries through both entry() and entries', async () => {
    const h = makeManager();
    h.manager.enqueue(album('a1', [track('t1')]));
    h.manager.enqueue(album('a2', [track('t2')]));
    expect(h.manager.entries.map((e) => e.albumId).sort()).toEqual(['a1', 'a2']);
    expect(h.manager.entry('a1')?.albumId).toBe('a1');
    expect(h.manager.entry('missing')).toBeUndefined();
  });
});
