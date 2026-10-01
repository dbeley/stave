import { describe, expect, it, vi } from 'vitest';
import { LibraryStore } from '$lib/stores/library.svelte';
import type { SubsonicClient } from '$lib/api/client';
import type { Album, Artist, ArtistBio, Track } from '$lib/domain/types';

function album(id: string, name = `Album ${id}`): Album {
  return { id, name, songCount: 2, durationSec: 20, starred: false };
}

function artist(id: string, name = `Artist ${id}`): Artist {
  return { id, name, albumCount: 1, starred: false };
}

function track(id: string): Track {
  return { id, title: `Track ${id}`, durationSec: 10, starred: false };
}

const emptyBio: ArtistBio = { images: {}, similarArtists: [] };

function fakeClient(overrides: Partial<SubsonicClient> = {}): SubsonicClient {
  return {
    getAlbumList: vi.fn().mockResolvedValue([]),
    getArtists: vi.fn().mockResolvedValue({ ignoredArticles: '', indexes: [], artists: [] }),
    getAlbum: vi.fn().mockResolvedValue(album('al1')),
    getArtist: vi.fn().mockResolvedValue({ artist: artist('ar1'), albums: [] }),
    getArtistInfo2: vi.fn().mockResolvedValue(emptyBio),
    getTopSongs: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as SubsonicClient;
}

describe('LibraryStore album lists', () => {
  it('starts with an empty slice for every sort', () => {
    const store = new LibraryStore({ client: () => null });
    const slice = store.list('newest');
    expect(slice.items).toEqual([]);
    expect(slice.loading).toBe(false);
    expect(slice.loadedAt).toBeUndefined();
  });

  it('loads a list and records the offset and pagination state', async () => {
    const getAlbumList = vi.fn().mockResolvedValue([album('a'), album('b')]);
    const store = new LibraryStore({
      client: () => fakeClient({ getAlbumList }),
      pageSize: () => 2,
    });

    await store.loadAlbumList('newest');

    const slice = store.list('newest');
    expect(slice.items.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(slice.offset).toBe(2);
    expect(slice.hasMore).toBe(true);
    expect(slice.loadedAt).toBeTruthy();
    expect(getAlbumList).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'newest', size: 2, offset: 0 }),
    );
  });

  it('does not refetch a list that is already loaded unless asked', async () => {
    const getAlbumList = vi.fn().mockResolvedValue([album('a')]);
    const store = new LibraryStore({ client: () => fakeClient({ getAlbumList }) });

    await store.loadAlbumList('newest');
    await store.loadAlbumList('newest');
    expect(getAlbumList).toHaveBeenCalledOnce();

    await store.loadAlbumList('newest', { refresh: true });
    expect(getAlbumList).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates concurrent loads of the same list', async () => {
    const getAlbumList = vi.fn().mockResolvedValue([album('a')]);
    const store = new LibraryStore({ client: () => fakeClient({ getAlbumList }) });

    await Promise.all([store.loadAlbumList('newest'), store.loadAlbumList('newest')]);
    expect(getAlbumList).toHaveBeenCalledOnce();
  });

  it('paginates with loadMoreAlbums for paginated sorts only', async () => {
    const getAlbumList = vi
      .fn()
      .mockResolvedValueOnce([album('a'), album('b')])
      .mockResolvedValueOnce([album('c')]);
    const store = new LibraryStore({
      client: () => fakeClient({ getAlbumList }),
      pageSize: () => 2,
    });

    await store.loadAlbumList('alphabeticalByName');
    await store.loadMoreAlbums('alphabeticalByName');

    expect(store.list('alphabeticalByName').items.map((entry) => entry.id)).toEqual([
      'a',
      'b',
      'c',
    ]);

    // A random list is not stable, so asking for more of it is a no-op.
    getAlbumList.mockClear();
    await store.loadAlbumList('random');
    await store.loadMoreAlbums('random');
    expect(getAlbumList).toHaveBeenCalledOnce();
  });

  it('records an error and notifies without throwing', async () => {
    const onError = vi.fn();
    const store = new LibraryStore({
      client: () => fakeClient({ getAlbumList: vi.fn().mockRejectedValue(new Error('boom')) }),
      onError,
    });

    await store.loadAlbumList('newest');
    expect(store.list('newest').error).toBe('boom');
    expect(store.list('newest').loading).toBe(false);
    expect(onError).toHaveBeenCalledWith('boom');
  });

  it('reports "not connected" when there is no client', async () => {
    const store = new LibraryStore({ client: () => null });
    await store.loadAlbumList('newest');
    expect(store.list('newest').error).toBe('not connected');
  });
});

describe('LibraryStore artists', () => {
  it('loads the artist index', async () => {
    const getArtists = vi.fn().mockResolvedValue({
      ignoredArticles: 'The',
      indexes: [{ name: 'A', artists: [artist('ar1', 'Aurora')] }],
      artists: [artist('ar1', 'Aurora')],
    });
    const store = new LibraryStore({ client: () => fakeClient({ getArtists }), onError: vi.fn() });

    await store.loadArtistsList();

    expect(store.artists.listing?.artists[0]?.name).toBe('Aurora');
    expect(store.artists.loadedAt).toBeTruthy();
    expect(store.artists.error).toBeUndefined();
  });
});

describe('LibraryStore album detail', () => {
  it('loads an album with its tracks', async () => {
    const getAlbum = vi.fn().mockResolvedValue({ ...album('al1'), tracks: [track('t1')] });
    const store = new LibraryStore({ client: () => fakeClient({ getAlbum }) });

    await store.loadAlbum('al1');

    expect(store.albumDetail('al1').album?.tracks).toHaveLength(1);
    expect(store.albumDetail('al1').error).toBeUndefined();
  });

  it('short-circuits on an empty id', async () => {
    const getAlbum = vi.fn();
    const store = new LibraryStore({ client: () => fakeClient({ getAlbum }) });
    await store.loadAlbum('');
    expect(getAlbum).not.toHaveBeenCalled();
  });

  it('keeps the previous album when a refresh fails', async () => {
    const getAlbum = vi
      .fn()
      .mockResolvedValueOnce(album('al1', 'Good'))
      .mockRejectedValueOnce(new Error('later failure'));
    const store = new LibraryStore({ client: () => fakeClient({ getAlbum }), onError: vi.fn() });

    await store.loadAlbum('al1');
    await store.loadAlbum('al1', { refresh: true });

    expect(store.albumDetail('al1').album?.name).toBe('Good');
    expect(store.albumDetail('al1').error).toBe('later failure');
  });
});

describe('LibraryStore artist detail', () => {
  it('loads albums, biography and top songs', async () => {
    const getArtist = vi.fn().mockResolvedValue({ artist: artist('ar1'), albums: [album('al1')] });
    const getArtistInfo2 = vi.fn().mockResolvedValue({
      biography: 'A long life story.',
      similarArtists: [artist('ar2')],
      images: {},
    });
    const getTopSongs = vi.fn().mockResolvedValue([track('t1')]);
    const store = new LibraryStore({
      client: () => fakeClient({ getArtist, getArtistInfo2, getTopSongs }),
    });

    await store.loadArtist('ar1');

    const slice = store.artistDetail('ar1');
    expect(slice.artist?.name).toBe('Artist ar1');
    expect(slice.albums.map((entry) => entry.id)).toEqual(['al1']);
    expect(slice.bio?.biography).toBe('A long life story.');
    expect(slice.bioUnavailable).toBe(false);
    expect(slice.topSongs.map((entry) => entry.id)).toEqual(['t1']);
    expect(slice.error).toBeUndefined();
  });

  it('degrades gracefully when the server has no biography (no Last.fm)', async () => {
    const store = new LibraryStore({
      client: () =>
        fakeClient({
          getArtist: vi.fn().mockResolvedValue({ artist: artist('ar1'), albums: [album('al1')] }),
          getArtistInfo2: vi.fn().mockRejectedValue(new Error('not found')),
          getTopSongs: vi.fn().mockRejectedValue(new Error('not found')),
          getAlbum: vi.fn(),
        } as Partial<SubsonicClient>),
    });

    await store.loadArtist('ar1');

    const slice = store.artistDetail('ar1');
    // Albums still render; only the optional extras are missing.
    expect(slice.albums).toHaveLength(1);
    expect(slice.error).toBeUndefined();
    expect(slice.bioUnavailable).toBe(true);
    expect(slice.topSongs).toEqual([]);
  });

  it('marks an empty biography as unavailable rather than present', async () => {
    const store = new LibraryStore({
      client: () =>
        fakeClient({
          getArtist: vi.fn().mockResolvedValue({ artist: artist('ar1'), albums: [] }),
          getArtistInfo2: vi.fn().mockResolvedValue(emptyBio),
        }),
    });

    await store.loadArtist('ar1');
    expect(store.artistDetail('ar1').bioUnavailable).toBe(true);
  });

  it('reports a hard failure of the artist itself', async () => {
    const onError = vi.fn();
    const store = new LibraryStore({
      client: () => fakeClient({ getArtist: vi.fn().mockRejectedValue(new Error('no artist')) }),
      onError,
    });

    await store.loadArtist('ar1');
    expect(store.artistDetail('ar1').error).toBe('no artist');
    expect(onError).toHaveBeenCalledWith('no artist');
  });
});

describe('LibraryStore invalidation', () => {
  it('drops cached album and artist detail', async () => {
    const store = new LibraryStore({
      client: () =>
        fakeClient({
          getAlbum: vi.fn().mockResolvedValue(album('al1')),
          getArtist: vi.fn().mockResolvedValue({ artist: artist('ar1'), albums: [] }),
        }),
    });

    await store.loadAlbum('al1');
    await store.loadArtist('ar1');
    expect(store.albumDetail('al1').album).toBeDefined();

    store.invalidate('album', 'al1');
    expect(store.albumDetail('al1').album).toBeUndefined();

    store.invalidate('all');
    expect(store.artistDetail('ar1').artist).toBeUndefined();
    expect(store.artists.loadedAt).toBeUndefined();
  });
});
