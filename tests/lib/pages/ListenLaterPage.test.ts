import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Album } from '$lib/domain/types';
import type { DownloadEntry } from '$lib/offline/downloads.svelte';

/**
 * `$lib/keyboard/list.svelte` runs runes outside a compiled Svelte module (it throws in
 * jsdom), so it is replaced with a plain cursor and no-op navigation bindings.
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
    starred: false,
  };

  const actions = {
    openAlbum: vi.fn(),
    openArtist: vi.fn(),
    playAlbumNow: vi.fn(),
    playAlbumNext: vi.fn(),
    enqueueAlbum: vi.fn(),
    toggleAlbumFavorite: vi.fn(),
    toggleListenLater: vi.fn(),
    openAlbumActions: vi.fn(),
  };

  const listenLater = {
    state: { entries: [] as { album: Album; addedAt: number }[] },
    get albums(): Album[] {
      return listenLater.state.entries.map((entry) => entry.album);
    },
    get count(): number {
      return listenLater.state.entries.length;
    },
    has: () => true,
    remove: vi.fn(),
    clear: vi.fn(),
    move: vi.fn(),
  };

  const downloads = {
    entry: vi.fn<(albumId: string) => DownloadEntry | undefined>(),
    enqueue: vi.fn(),
    retry: vi.fn(),
    remove: vi.fn(),
    isCached: () => true,
    cachedBytes: 1_048_576,
  };

  const app = {
    listenLater,
    downloads,
    toasts: { info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn() },
    settings: {
      state: { offlineCacheEnabled: false, showTechnicalColumns: false, asciiCoverArt: false },
    },
    setOfflineCacheEnabled: vi.fn(),
    favorites: {
      isAlbumStarred: () => false,
      state: { albums: [album], artists: [], tracks: [] },
    },
    resolver: { cachedCount: 5, isCached: () => true },
    player: { state: { track: undefined as undefined | { id: string } } },
    keyboard: { registerAll: vi.fn(() => () => {}) },
    router: { navigate: vi.fn() },
  };

  return { album, actions, listenLater, downloads, app };
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

import ListenLaterPage from '$lib/pages/ListenLaterPage.svelte';

beforeEach(() => {
  h.listenLater.state.entries = [];
  h.downloads.entry.mockReset();
  h.downloads.entry.mockReturnValue(undefined);
  h.app.settings.state.offlineCacheEnabled = false;
});

describe('ListenLaterPage', () => {
  it('lists local albums and shows their cached status and cache usage', async () => {
    h.listenLater.state.entries = [{ album: h.album, addedAt: 1 }];
    h.downloads.entry.mockReturnValue({
      albumId: 'a1',
      albumName: 'Neon Cartography',
      status: 'cached',
      total: 9,
      done: 9,
      bytes: 1_048_576,
      updatedAt: 0,
    });

    render(ListenLaterPage);
    await tick();

    expect(screen.getByText('Neon Cartography')).toBeTruthy();
    expect(screen.getByText('cached · 1.0 MB')).toBeTruthy();
    expect(screen.getByText('1 album in listen later')).toBeTruthy();
    expect(screen.getByText('5 tracks cached · 1.0 MB used')).toBeTruthy();
  });

  it('shows a download meter while an album is downloading', async () => {
    h.listenLater.state.entries = [{ album: h.album, addedAt: 1 }];
    h.downloads.entry.mockReturnValue({
      albumId: 'a1',
      albumName: 'Neon Cartography',
      status: 'downloading',
      total: 4,
      done: 2,
      bytes: 524_288,
      updatedAt: 0,
    });

    render(ListenLaterPage);
    await tick();

    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(screen.getByText('downloading')).toBeTruthy();
    expect(screen.getByText('2/4 · 512 KB')).toBeTruthy();
  });

  it('explains that the list is local-only and shows the caching-off hint', async () => {
    render(ListenLaterPage);
    await tick();

    expect(screen.getByText(/listen later is empty/)).toBeTruthy();
    expect(screen.getByText(/never touches the server/)).toBeTruthy();
    expect(screen.getByText(/offline caching is off/)).toBeTruthy();
  });

  it('opens the album page when a row is activated', async () => {
    h.listenLater.state.entries = [{ album: h.album, addedAt: 1 }];
    render(ListenLaterPage);
    await tick();

    const row = screen.getByText('Neon Cartography').closest('[role="option"]');
    expect(row).toBeTruthy();
    await fireEvent.click(row as HTMLElement);
    expect(h.actions.openAlbum).toHaveBeenCalledWith('a1');
  });
});
