import { describe, expect, it, vi } from 'vitest';
import { FavoritesStore } from '$lib/stores/favorites.svelte';
import type { SubsonicClient } from '$lib/api/client';
import type { Album, Artist, Track } from '$lib/domain/types';

function album(id: string, starred = false): Album {
  return { id, name: `Album ${id}`, songCount: 1, durationSec: 10, starred };
}

function artist(id: string): Artist {
  return { id, name: `Artist ${id}`, albumCount: 1, starred: false };
}

function track(id: string): Track {
  return { id, title: `Track ${id}`, durationSec: 10, starred: false };
}

/** A client stub exposing only what the favorites store touches. */
function fakeClient(overrides: Partial<SubsonicClient> = {}): SubsonicClient {
  return {
    getStarred: vi.fn().mockResolvedValue({ artists: [], albums: [], tracks: [] }),
    star: vi.fn().mockResolvedValue(undefined),
    unstar: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as SubsonicClient;
}

describe('FavoritesStore', () => {
  it('starts empty', () => {
    const store = new FavoritesStore({ client: () => null });
    expect(store.isEmpty).toBe(true);
    expect(store.total).toBe(0);
  });

  it('loads starred entities from the server', async () => {
    const client = fakeClient({
      getStarred: vi.fn().mockResolvedValue({
        artists: [artist('ar1')],
        albums: [album('al1', true)],
        tracks: [track('t1')],
      }),
    });
    const store = new FavoritesStore({ client: () => client });

    await store.load();

    expect(store.total).toBe(3);
    expect(store.isAlbumStarred(album('al1'))).toBe(true);
    expect(store.state.loadedAt).toBeTruthy();
  });

  it('reports failure to load without throwing', async () => {
    const client = fakeClient({
      getStarred: vi.fn().mockRejectedValue(new Error('server exploded')),
    });
    const onError = vi.fn();
    const store = new FavoritesStore({ client: () => client, onError });

    await expect(store.load()).resolves.toBeUndefined();
    expect(store.state.error).toBe('server exploded');
    expect(onError).toHaveBeenCalledOnce();
  });

  it('surfaces "not connected" when there is no client', async () => {
    const store = new FavoritesStore({ client: () => null });
    await store.load();
    expect(store.state.error).toBe('not connected');
  });

  it('de-duplicates concurrent loads', async () => {
    const getStarred = vi.fn().mockResolvedValue({ artists: [], albums: [], tracks: [] });
    const store = new FavoritesStore({ client: () => fakeClient({ getStarred }) });

    await Promise.all([store.load(), store.load(), store.load()]);
    expect(getStarred).toHaveBeenCalledOnce();
  });

  it('stars optimistically and counts the entity as starred immediately', async () => {
    const star = vi.fn().mockResolvedValue(undefined);
    const onSuccess = vi.fn();
    const store = new FavoritesStore({ client: () => fakeClient({ star }), onSuccess });

    const promise = store.toggleAlbum(album('al1'));
    // The optimistic update happens before the request resolves.
    expect(store.isAlbumStarred(album('al1'))).toBe(true);

    await expect(promise).resolves.toBe(true);
    expect(star).toHaveBeenCalledWith({ albumId: 'al1' });
    expect(store.state.albums.map((entry) => entry.id)).toEqual(['al1']);
    expect(onSuccess).toHaveBeenCalledOnce();
  });

  it('unstars with unstar()', async () => {
    const unstar = vi.fn().mockResolvedValue(undefined);
    const client = fakeClient({
      getStarred: vi
        .fn()
        .mockResolvedValue({ artists: [], albums: [album('al1', true)], tracks: [] }),
      unstar,
    });
    const store = new FavoritesStore({ client: () => client });
    await store.load();

    await expect(store.toggleAlbum(album('al1'))).resolves.toBe(false);
    expect(unstar).toHaveBeenCalledWith({ albumId: 'al1' });
    expect(store.isAlbumStarred(album('al1'))).toBe(false);
  });

  it('rolls the optimistic update back when the server rejects it', async () => {
    const star = vi.fn().mockRejectedValue(new Error('nope'));
    const onError = vi.fn();
    const store = new FavoritesStore({ client: () => fakeClient({ star }), onError });

    const result = await store.toggleAlbum(album('al1'));

    expect(result).toBe(false);
    expect(store.isAlbumStarred(album('al1'))).toBe(false);
    expect(store.state.albums).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('could not update favorite'));
  });

  it('tracks artists and tracks through separate star calls', async () => {
    const star = vi.fn().mockResolvedValue(undefined);
    const store = new FavoritesStore({ client: () => fakeClient({ star }) });

    await store.toggleArtist(artist('ar1'));
    await store.toggleTrack(track('t1'));

    expect(star).toHaveBeenCalledWith({ artistId: 'ar1' });
    expect(star).toHaveBeenCalledWith({ id: 't1' });
    expect(store.isArtistStarred(artist('ar1'))).toBe(true);
    expect(store.isTrackStarred(track('t1'))).toBe(true);
  });

  it('falls back to the entity’s own starred flag', () => {
    const store = new FavoritesStore({ client: () => null });
    expect(store.isAlbumStarred({ ...album('x'), starred: true })).toBe(true);
    expect(store.isAlbumStarred(album('x'))).toBe(false);
  });

  it('clear() empties the store and forgets overrides', async () => {
    const client = fakeClient({
      getStarred: vi
        .fn()
        .mockResolvedValue({ artists: [], albums: [album('al1', true)], tracks: [] }),
    });
    const store = new FavoritesStore({ client: () => client });
    await store.load();

    store.clear();
    expect(store.total).toBe(0);
    expect(store.isAlbumStarred(album('al1', true))).toBe(true); // from the album's own flag
  });
});
