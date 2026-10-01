import { describe, it, expect, afterEach } from 'vitest';
import {
  DB_NAME,
  DB_VERSION,
  IndexedDbOfflineDatabase,
  STORE_BLOBS,
  STORE_TRACKS,
  type OfflineAlbumMeta,
  type OfflineTrackMeta,
} from '$lib/offline/db';
import { audioBlob, blobBytes, closeOpenedDbs, freshDb } from './helpers';

function trackMeta(over: Partial<OfflineTrackMeta> = {}): OfflineTrackMeta {
  return {
    id: 't1',
    albumId: 'a1',
    albumName: 'Album One',
    artistName: 'Artist',
    title: 'Track One',
    durationSec: 180,
    cachedAt: 1_000,
    ...over,
  };
}

function albumMeta(over: Partial<OfflineAlbumMeta> = {}): OfflineAlbumMeta {
  return {
    albumId: 'a1',
    albumName: 'Album One',
    artistName: 'Artist',
    coverArtId: 'cover-1',
    trackIds: ['t1', 't2'],
    bytes: 1234,
    cachedAt: 2_000,
    ...over,
  };
}

afterEach(() => {
  closeOpenedDbs();
});

describe('constants', () => {
  it('exposes the expected database name, version and store names', () => {
    expect(DB_NAME).toBe('stave-offline');
    expect(DB_VERSION).toBe(1);
    expect(STORE_TRACKS).toBe('tracks');
    expect(STORE_BLOBS).toBe('blobs');
  });
});

describe('track metadata', () => {
  it('round-trips a track meta row', async () => {
    const db = freshDb();
    const meta = trackMeta({ trackNumber: 3, discNumber: 1, suffix: 'mp3', sizeBytes: 999 });
    await db.putTrack(meta);
    expect(await db.getTrack('t1')).toEqual(meta);
  });

  it('returns null for a track that was never stored', async () => {
    const db = freshDb();
    expect(await db.getTrack('missing')).toBeNull();
  });

  it('putTrack is an upsert, not an insert', async () => {
    const db = freshDb();
    await db.putTrack(trackMeta({ title: 'First' }));
    await db.putTrack(trackMeta({ title: 'Second' }));
    expect((await db.getTrack('t1'))?.title).toBe('Second');
    expect(await db.listAllTrackIds()).toEqual(['t1']);
  });

  it('lists only the ids belonging to the requested album', async () => {
    const db = freshDb();
    await db.putTrack(trackMeta({ id: 't1', albumId: 'a1' }));
    await db.putTrack(trackMeta({ id: 't2', albumId: 'a1' }));
    await db.putTrack(trackMeta({ id: 't3', albumId: 'a2' }));

    expect((await db.listTrackIdsByAlbum('a1')).sort()).toEqual(['t1', 't2']);
    expect(await db.listTrackIdsByAlbum('a2')).toEqual(['t3']);
    expect(await db.listTrackIdsByAlbum('nope')).toEqual([]);
  });

  it('lists every stored track id', async () => {
    const db = freshDb();
    expect(await db.listAllTrackIds()).toEqual([]);
    await db.putTrack(trackMeta({ id: 't2' }));
    await db.putTrack(trackMeta({ id: 't1' }));
    expect((await db.listAllTrackIds()).sort()).toEqual(['t1', 't2']);
  });

  it('deletes a single track without touching the others', async () => {
    const db = freshDb();
    await db.putTrack(trackMeta({ id: 't1' }));
    await db.putTrack(trackMeta({ id: 't2' }));
    await db.deleteTrack('t1');
    expect(await db.getTrack('t1')).toBeNull();
    expect(await db.getTrack('t2')).not.toBeNull();
    // Deleting a missing key is a no-op, not an error.
    await expect(db.deleteTrack('absent')).resolves.toBeUndefined();
  });
});

describe('blobs', () => {
  it('round-trips blob bytes and content type', async () => {
    const db = freshDb();
    await db.putBlob('t1', audioBlob([0, 1, 2, 250, 255], 'audio/ogg'));
    const blob = await db.getBlob('t1');
    expect(blob).not.toBeNull();
    expect(await blobBytes(blob!)).toEqual([0, 1, 2, 250, 255]);
    expect(blob!.type).toBe('audio/ogg');
  });

  it('returns null for a blob that was never stored', async () => {
    const db = freshDb();
    expect(await db.getBlob('missing')).toBeNull();
  });

  it('lists and deletes blob keys', async () => {
    const db = freshDb();
    expect(await db.listBlobKeys()).toEqual([]);
    await db.putBlob('t1', audioBlob([1]));
    await db.putBlob('t2', audioBlob([2]));
    expect((await db.listBlobKeys()).sort()).toEqual(['t1', 't2']);

    await db.deleteBlob('t1');
    expect(await db.listBlobKeys()).toEqual(['t2']);
    expect(await db.getBlob('t1')).toBeNull();
  });

  it('keeps track metadata and blob stores independent', async () => {
    const db = freshDb();
    // A blob with no matching meta row is still listable (the app cleans these
    // up via `clear`), and vice versa.
    await db.putBlob('orphan', audioBlob([9]));
    await db.putTrack(trackMeta({ id: 'ghost' }));
    expect(await db.listBlobKeys()).toEqual(['orphan']);
    expect(await db.listAllTrackIds()).toEqual(['ghost']);
  });
});

describe('album metadata', () => {
  it('round-trips an album meta row', async () => {
    const db = freshDb();
    const meta = albumMeta();
    await db.putAlbumMeta(meta);
    expect(await db.getAlbumMeta('a1')).toEqual(meta);
  });

  it('returns null for an album that was never stored', async () => {
    const db = freshDb();
    expect(await db.getAlbumMeta('missing')).toBeNull();
  });

  it('lists all album metas, or an empty array when there are none', async () => {
    const db = freshDb();
    expect(await db.listAlbumMeta()).toEqual([]);
    await db.putAlbumMeta(albumMeta({ albumId: 'a1' }));
    await db.putAlbumMeta(albumMeta({ albumId: 'a2' }));
    const all = (await db.listAlbumMeta()).map((m) => m.albumId).sort();
    expect(all).toEqual(['a1', 'a2']);
  });

  it('deletes an album meta row', async () => {
    const db = freshDb();
    await db.putAlbumMeta(albumMeta());
    await db.deleteAlbumMeta('a1');
    expect(await db.getAlbumMeta('a1')).toBeNull();
  });
});

describe('deleteAlbum', () => {
  it('removes the album tracks, their blobs and the album meta, leaving others alone', async () => {
    const db = freshDb();
    await db.putTrack(trackMeta({ id: 't1', albumId: 'a1' }));
    await db.putTrack(trackMeta({ id: 't2', albumId: 'a1' }));
    await db.putTrack(trackMeta({ id: 't3', albumId: 'a2' }));
    await db.putBlob('t1', audioBlob([1]));
    await db.putBlob('t2', audioBlob([2]));
    await db.putBlob('t3', audioBlob([3]));
    await db.putAlbumMeta(albumMeta({ albumId: 'a1', trackIds: ['t1', 't2'] }));
    await db.putAlbumMeta(albumMeta({ albumId: 'a2', trackIds: ['t3'] }));

    await db.deleteAlbum('a1');

    expect(await db.listTrackIdsByAlbum('a1')).toEqual([]);
    expect(await db.getBlob('t1')).toBeNull();
    expect(await db.getBlob('t2')).toBeNull();
    expect(await db.getAlbumMeta('a1')).toBeNull();

    // The other album is untouched.
    expect(await db.listTrackIdsByAlbum('a2')).toEqual(['t3']);
    expect((await db.getBlob('t3'))?.size).toBe(1);
    expect(await db.getAlbumMeta('a2')).not.toBeNull();
  });

  it('is a no-op for an unknown album', async () => {
    const db = freshDb();
    await expect(db.deleteAlbum('nope')).resolves.toBeUndefined();
  });
});

describe('clear', () => {
  it('empties every store', async () => {
    const db = freshDb();
    await db.putTrack(trackMeta({ id: 't1', albumId: 'a1' }));
    await db.putBlob('t1', audioBlob([1]));
    await db.putAlbumMeta(albumMeta());

    await db.clear();

    expect(await db.listAllTrackIds()).toEqual([]);
    expect(await db.listBlobKeys()).toEqual([]);
    expect(await db.listAlbumMeta()).toEqual([]);
  });
});

describe('open / schema', () => {
  it('rejects every operation when no IndexedDB factory is available', async () => {
    const db = new IndexedDbOfflineDatabase({ factory: null });
    await expect(db.getTrack('t1')).rejects.toThrow(/IndexedDB is not available/);
    await expect(db.listAllTrackIds()).rejects.toThrow(/IndexedDB is not available/);
  });

  it('reuses existing stores on a version bump instead of recreating them', async () => {
    const name = `stave-upgrade-${Math.random().toString(36).slice(2)}`;
    const v1 = new IndexedDbOfflineDatabase({ name, version: 1 });
    await v1.putTrack(trackMeta({ id: 'kept' }));
    await v1.putBlob('kept', audioBlob([7, 8]));
    v1.close();
    // Let the close settle before requesting an upgrade.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const v2 = new IndexedDbOfflineDatabase({ name, version: 2 });
    try {
      expect(await v2.getTrack('kept')).not.toBeNull();
      expect(await blobBytes((await v2.getBlob('kept'))!)).toEqual([7, 8]);
      // The upgrade must not throw trying to create stores that already exist.
      await v2.putTrack(trackMeta({ id: 'new' }));
      expect((await v2.listAllTrackIds()).sort()).toEqual(['kept', 'new']);
    } finally {
      v2.close();
    }
  });

  it('shares an open connection across calls (single open request)', async () => {
    const db = freshDb();
    const [, , first] = await Promise.all([
      db.putTrack(trackMeta({ id: 't1' })),
      db.putBlob('t1', audioBlob([1])),
      db.listAllTrackIds(),
    ]);
    expect(first).toEqual(['t1']);
  });
});
