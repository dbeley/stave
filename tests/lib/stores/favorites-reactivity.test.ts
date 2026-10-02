import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { FavoritesStore } from '$lib/stores/favorites.svelte';
import type { SubsonicClient } from '$lib/api/client';
import type { Album, Track } from '$lib/domain/types';
import FavoriteStar from '../../fixtures/FavoriteStar.svelte';

function fakeClient(): SubsonicClient {
  return {
    getStarred: vi.fn().mockResolvedValue({ artists: [], albums: [], tracks: [] }),
    star: vi.fn().mockResolvedValue(undefined),
    unstar: vi.fn().mockResolvedValue(undefined),
  } as unknown as SubsonicClient;
}

function track(id: string): Track {
  return { id, title: `Track ${id}`, durationSec: 10, starred: false };
}

function album(id: string): Album {
  return { id, name: `Album ${id}`, songCount: 1, durationSec: 10, starred: false };
}

/**
 * Regression: a starred badge must disappear when the entity is un-starred.
 *
 * `isStarred` used to return an optimistic override before touching the reactive
 * starred lists. The `$derived` in the row therefore lost its subscription after
 * the first (star) toggle, and the untoggle — which only removes the entity from
 * the reactive list — never re-ran it. The store was right; the UI stayed starred.
 */
describe('favourite reactivity', () => {
  it('shows a track as un-starred after the second toggle', async () => {
    const store = new FavoritesStore({ client: () => fakeClient() });
    const entity = track('t1');
    render(FavoriteStar, { store, track: entity });
    expect(screen.getByTestId('track').textContent).toBe('plain');

    await store.toggleTrack(entity);
    await tick();
    expect(screen.getByTestId('track').textContent).toBe('starred');

    await store.toggleTrack(entity);
    await tick();
    expect(screen.getByTestId('track').textContent).toBe('plain');
  });

  it('shows an album as un-starred after the second toggle', async () => {
    const store = new FavoritesStore({ client: () => fakeClient() });
    const entity = album('a1');
    render(FavoriteStar, { store, album: entity });
    expect(screen.getByTestId('album').textContent).toBe('plain');

    await store.toggleAlbum(entity);
    await tick();
    expect(screen.getByTestId('album').textContent).toBe('starred');

    await store.toggleAlbum(entity);
    await tick();
    expect(screen.getByTestId('album').textContent).toBe('plain');
  });
});
