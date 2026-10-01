import { describe, expect, it, vi } from 'vitest';
import { LISTEN_LATER_KEY, ListenLaterStore } from '$lib/stores/listenLater.svelte';
import type { Album } from '$lib/domain/types';
import { memoryStorage } from '../../helpers/storage';

function album(id: string, name = `Album ${id}`): Album {
  return { id, name, songCount: 3, durationSec: 600, starred: false };
}

describe('ListenLaterStore', () => {
  it('starts empty and reports membership', () => {
    const store = new ListenLaterStore({}, null);
    expect(store.isEmpty).toBe(true);
    expect(store.count).toBe(0);
    expect(store.has('a')).toBe(false);
  });

  it('adds albums, newest first, and ignores duplicates', () => {
    const store = new ListenLaterStore({}, null);
    store.add(album('a'));
    store.add(album('b'));
    store.add(album('a'));

    expect(store.count).toBe(2);
    expect(store.albums.map((entry) => entry.id)).toEqual(['b', 'a']);
    expect(store.has('a')).toBe(true);
  });

  it('toggle adds then removes, returning the resulting membership', () => {
    const store = new ListenLaterStore({}, null);
    expect(store.toggle(album('a'))).toBe(true);
    expect(store.has('a')).toBe(true);
    expect(store.toggle(album('a'))).toBe(false);
    expect(store.has('a')).toBe(false);
  });

  it('remove is a no-op for an album that is not listed', () => {
    const store = new ListenLaterStore({}, null);
    const sync = vi.fn();
    const withSync = new ListenLaterStore({ sync }, null);
    store.remove('nope');
    withSync.remove('nope');
    expect(store.count).toBe(0);
    expect(sync).not.toHaveBeenCalled();
  });

  it('reorders entries and clamps out-of-range indices', () => {
    const store = new ListenLaterStore({}, null);
    store.add(album('a'));
    store.add(album('b'));
    store.add(album('c')); // order after adds: c, b, a
    expect(store.albums.map((entry) => entry.id)).toEqual(['c', 'b', 'a']);

    store.move(0, 2);
    expect(store.albums.map((entry) => entry.id)).toEqual(['b', 'a', 'c']);

    // Out-of-range indices are clamped rather than throwing.
    store.move(0, 99);
    expect(store.albums.map((entry) => entry.id)).toEqual(['a', 'c', 'b']);
    store.move(99, 0);
    expect(store.albums.map((entry) => entry.id)).toEqual(['b', 'a', 'c']);
  });

  it('clear empties the list', () => {
    const store = new ListenLaterStore({}, null);
    store.add(album('a'));
    store.add(album('b'));
    store.clear();
    expect(store.isEmpty).toBe(true);
    expect(store.entriesForOffline()).toEqual([]);
  });

  it('updates the metadata of a listed album without moving it', () => {
    const store = new ListenLaterStore({}, null);
    store.add(album('a', 'Old name'));
    store.updateAlbum({ ...album('a', 'New name'), year: 2024 });
    expect(store.albums[0]?.name).toBe('New name');
    expect(store.albums[0]?.year).toBe(2024);
    expect(store.count).toBe(1);
  });

  it('persists and reloads the list', () => {
    const storage = memoryStorage();
    const store = new ListenLaterStore({}, storage);
    store.add(album('a', 'Kept'));
    expect(storage.map.has(LISTEN_LATER_KEY)).toBe(true);

    const reloaded = new ListenLaterStore({}, storage);
    expect(reloaded.count).toBe(1);
    expect(reloaded.albums[0]?.name).toBe('Kept');
  });

  it('ignores a corrupt stored blob', () => {
    const storage = memoryStorage({ [LISTEN_LATER_KEY]: 'not json at all' });
    const store = new ListenLaterStore({}, storage);
    expect(store.isEmpty).toBe(true);
  });

  it('notifies the offline cache about what changed', () => {
    const sync = vi.fn();
    const store = new ListenLaterStore({ sync, now: () => 1234 }, null);

    store.add(album('a'));
    expect(sync).toHaveBeenLastCalledWith(expect.any(Array), {
      added: [expect.objectContaining({ id: 'a' })],
      removed: [],
    });
    expect(store.state.entries[0]?.addedAt).toBe(1234);

    store.remove('a');
    expect(sync).toHaveBeenLastCalledWith(expect.any(Array), { added: [], removed: ['a'] });
  });

  it('reports every removed album when cleared', () => {
    const sync = vi.fn();
    const store = new ListenLaterStore({ sync }, null);
    store.add(album('a'));
    store.add(album('b'));
    sync.mockClear();

    store.clear();
    expect(sync).toHaveBeenCalledWith([], { added: [], removed: ['b', 'a'] });
  });
});
