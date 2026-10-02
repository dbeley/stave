import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Album, Artist, Track } from '$lib/domain/types';

/**
 * The keyboard module (`$lib/keyboard/list.svelte`) instantiates runes outside a
 * compiled Svelte module, which throws in jsdom, so the page is exercised
 * against a plain-JS cursor and no-op navigation bindings. The app itself is
 * faked store-by-store, the same way the composition root wires the real one.
 */
const h = vi.hoisted(() => {
  const album: Album = {
    id: 'a1',
    name: 'Neon Cartography',
    artistId: 'ar1',
    artistName: 'Aurelia Vance',
    songCount: 9,
    durationSec: 2400,
    year: 2024,
    starred: true,
  };
  const artist: Artist = { id: 'ar1', name: 'Aurelia Vance', albumCount: 3, starred: true };
  const track: Track = {
    id: 't1',
    title: 'Meridian Drift',
    albumId: 'a1',
    albumName: 'Neon Cartography',
    artistId: 'ar1',
    artistName: 'Aurelia Vance',
    durationSec: 215,
    starred: true,
  };

  const actions = {
    openArtist: vi.fn(),
    openAlbum: vi.fn(),
    playTrackNow: vi.fn(),
    enqueueAlbum: vi.fn(),
    enqueueTrack: vi.fn(),
    toggleArtistFavorite: vi.fn(),
    toggleAlbumFavorite: vi.fn(),
    toggleTrackFavorite: vi.fn(),
    toggleListenLater: vi.fn(),
    toggleListenLaterForTrack: vi.fn(),
    openAlbumActions: vi.fn(),
    openTrackActions: vi.fn(),
    openArtistActions: vi.fn(),
  };

  const favorites = {
    state: {
      artists: [] as Artist[],
      albums: [] as Album[],
      tracks: [] as Track[],
      loading: false,
      error: undefined as string | undefined,
    },
    load: vi.fn(),
    isAlbumStarred: () => true,
    isArtistStarred: () => true,
    isTrackStarred: () => true,
  };

  /** Bindings the page registered most recently, for simulated keypresses. */
  const registered: Array<{ keys: string[]; run: () => void }> = [];

  const app = {
    favorites,
    toasts: { info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: {
      state: { showTechnicalColumns: false, offlineCacheEnabled: false, asciiCoverArt: false },
    },
    listenLater: { has: () => false, state: { entries: [] } },
    downloads: { isCached: () => false, entry: () => undefined, cachedBytes: 0 },
    resolver: { isCached: () => false, cachedCount: 0 },
    player: { state: { track: undefined as Track | undefined } },
    // Captures what the page registers, so a test can press a key for real
    // (`tab` switches section) instead of watching a no-op stub.
    keyboard: {
      registerAll: vi.fn((bindings: Array<{ keys: string[]; run: () => void }>) => {
        registered.length = 0;
        registered.push(...bindings);
        return () => {};
      }),
    },
    router: { navigate: vi.fn() },
  };

  return { album, artist, track, actions, favorites, app, registered };
});

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

vi.mock('$lib/ui/actionsRegistry.svelte', () => ({ actions: h.actions }));

// A partial mock: everything except the cursor stays real, so adding an export to
// the module does not silently break these tests (it did when
// `keepCursorRowVisible` arrived — the mock simply did not have it).
vi.mock('$lib/keyboard/list.svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/keyboard/list.svelte')>();

  class ListCursor {
    state = { index: 0, count: 0 };
    get index() {
      return this.state.index;
    }
    get count() {
      return this.state.count;
    }
    get isEmpty() {
      return this.state.count === 0;
    }
    setCount(count: number) {
      this.state.count = Math.max(0, count);
      this.clamp();
    }
    set(index: number) {
      this.state.index = index;
    }
    move(delta: number) {
      const max = Math.max(0, this.state.count - 1);
      this.state.index = Math.min(Math.max(this.state.index + delta, 0), max);
      return this.state.index;
    }
    first() {
      this.state.index = 0;
    }
    last() {
      this.state.index = Math.max(0, this.state.count - 1);
    }
    page(direction: number) {
      return this.move(direction * 10);
    }
    selected<T>(items: readonly T[]): T | undefined {
      return items[this.state.index];
    }
    isSelected(index: number) {
      return this.state.index === index;
    }
    clamp() {
      const max = Math.max(Math.max(this.state.count, 1) - 1, 0);
      this.state.index = Math.min(Math.max(this.state.index, 0), max);
    }
    reset() {
      this.state.index = 0;
    }
  }
  return {
    ...actual,
    ListCursor,
    listNavigationBindings: () => [],
    // Nothing to scroll in jsdom; the pages only need it not to throw.
    keepCursorRowVisible: () => {},
  };
});

import FavoritesPage from '$lib/pages/FavoritesPage.svelte';

/** Press a key the page actually registered (no-op if it registered nothing). */
async function press(key: string): Promise<void> {
  const binding = h.registered.find((entry) => entry.keys.includes(key));
  binding?.run();
  await tick();
}

beforeEach(() => {
  h.favorites.state.artists = [];
  h.favorites.state.albums = [];
  h.favorites.state.tracks = [];
  h.favorites.state.loading = false;
  h.favorites.state.error = undefined;
});

describe('FavoritesPage', () => {
  it('loads favourites on mount', async () => {
    render(FavoritesPage);
    await tick();
    expect(h.favorites.load).toHaveBeenCalled();
  });

  it('shows one section at a time, with the counts on every tab', async () => {
    h.favorites.state.albums = [h.album];
    render(FavoritesPage);
    await tick();

    // The section bar lists all three with their counts…
    expect(screen.getByRole('tab', { name: /artists/ }).textContent).toMatch(/0/);
    expect(screen.getByRole('tab', { name: /albums/ }).textContent).toMatch(/1/);
    expect(screen.getByRole('tab', { name: /tracks/ }).textContent).toMatch(/0/);

    // …while only the focused section renders rows, so its own empty note shows.
    expect(screen.getByText(/no starred artists/)).toBeTruthy();
    expect(screen.queryByText('Neon Cartography')).toBeNull();
    expect(screen.queryByText(/nothing starred yet/)).toBeNull();
  });

  it('switches section with tab, keeping a cursor per section', async () => {
    h.favorites.state.albums = [h.album];
    h.favorites.state.tracks = [h.track];
    render(FavoritesPage);
    await tick();

    // The page starts on artists, so two presses reach the tracks section.
    await press('tab');
    expect(screen.getByText('Neon Cartography')).toBeTruthy();

    await press('tab');
    expect(screen.getByText('Meridian Drift')).toBeTruthy();

    // …and one more wraps back to artists, whose pane is empty here.
    await press('tab');
    expect(screen.getByText(/no starred artists/)).toBeTruthy();
  });

  it('shift+tab moves to the previous section', async () => {
    h.favorites.state.tracks = [h.track];
    render(FavoritesPage);
    await tick();

    // artists -> tracks is directly backwards from the artists section.
    await press('shift+tab');
    expect(screen.getByText('Meridian Drift')).toBeTruthy();
  });

  it('selects a section when its tab is clicked', async () => {
    h.favorites.state.tracks = [h.track];
    render(FavoritesPage);
    await tick();

    await fireEvent.click(screen.getByRole('tab', { name: /tracks/ }));
    await tick();

    expect(screen.getByText('Meridian Drift')).toBeTruthy();
    expect(screen.queryByText(/no starred artists/)).toBeNull();
  });

  it('opens the album page when a row is activated', async () => {
    h.favorites.state.albums = [h.album];
    render(FavoritesPage);
    await tick();

    // Albums live in their own pane now, so focus it first.
    await fireEvent.click(screen.getByRole('tab', { name: /albums/ }));
    await tick();

    const row = screen.getByText('Neon Cartography').closest('[role="option"]');
    expect(row).toBeTruthy();
    await fireEvent.click(row as HTMLElement);
    expect(h.actions.openAlbum).toHaveBeenCalledWith('a1');
  });

  it('shows one overall empty state when nothing is starred', async () => {
    render(FavoritesPage);
    await tick();

    expect(screen.getByText(/nothing starred yet/)).toBeTruthy();
    expect(screen.queryByText(/no starred artists/)).toBeNull();
  });
});
