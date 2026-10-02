import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Album, Track } from '$lib/domain/types';

const mocks = vi.hoisted(() => {
  const identity = (value: unknown) => value;
  Object.defineProperty(globalThis, '$derived', {
    configurable: true,
    writable: true,
    value: identity,
  });
  Object.defineProperty(globalThis, '$effect', {
    configurable: true,
    writable: true,
    value: () => () => {},
  });
  return {
    app: {} as Record<string, any>,
    actions: {} as Record<string, any>,
  };
});

vi.mock('$lib/app.svelte', () => ({ app: mocks.app }));
vi.mock('$lib/ui/actionsRegistry.svelte', () => ({ actions: mocks.actions }));

import AlbumPage from '$lib/pages/AlbumPage.svelte';

function track(id: string, title: string, over: Partial<Track> = {}): Track {
  return { id, title, durationSec: 200, starred: false, ...over };
}

function album(over: Partial<Album> = {}): Album {
  return {
    id: 'al1',
    name: 'Neon Cartography',
    artistId: 'ar1',
    artistName: 'Aurelia Vance',
    coverArtId: 'cov1',
    songCount: 2,
    durationSec: 600,
    year: 2024,
    genre: 'Synth',
    starred: false,
    tracks: [track('t1', 'Meridian Drift'), track('t2', 'Signal Bloom')],
    ...over,
  };
}

function makeApp(slice: Record<string, unknown>): Record<string, any> {
  return {
    router: { current: { name: 'album', id: 'al1' }, navigate: vi.fn() },
    library: {
      albumDetail: vi.fn(() => slice),
      loadAlbum: vi.fn().mockResolvedValue(undefined),
    },
    favorites: { isAlbumStarred: () => false, isTrackStarred: () => false },
    listenLater: { has: () => false },
    downloads: { isCached: () => false },
    resolver: { isCached: () => false },
    settings: { state: { asciiCoverArt: false, showTechnicalColumns: false } },
    keyboard: { registerAll: vi.fn(() => () => {}) },
    getClient: () => null,
    player: { state: { track: undefined as Track | undefined } },
    toasts: { info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function install(app: Record<string, unknown>): void {
  for (const key of Object.keys(mocks.app)) delete mocks.app[key];
  Object.assign(mocks.app, app);
}

beforeEach(() => {
  for (const key of Object.keys(mocks.actions)) delete mocks.actions[key];
  Object.assign(mocks.actions, {
    playTrackNow: vi.fn(),
    playAlbumNow: vi.fn(),
    enqueueAlbum: vi.fn(),
    toggleAlbumFavorite: vi.fn(),
    toggleListenLater: vi.fn(),
    openAlbumActions: vi.fn(),
    openArtist: vi.fn(),
  });
});

describe('AlbumPage', () => {
  it('renders the metadata and the tracklist', async () => {
    install(makeApp({ album: album(), loading: false, error: undefined, loadedAt: 1 }));

    render(AlbumPage);
    await tick();

    expect(screen.getByText('Neon Cartography')).toBeTruthy();
    expect(screen.getByText('Aurelia Vance')).toBeTruthy();
    expect(screen.getByText('2024')).toBeTruthy();
    expect(screen.getByText('Synth')).toBeTruthy();
    expect(screen.getByText(/2 tracks/)).toBeTruthy();
    expect(screen.getByText(/not favourite/)).toBeTruthy();
    expect(screen.getByText('Meridian Drift')).toBeTruthy();
    expect(screen.getByText('Signal Bloom')).toBeTruthy();
    expect(mocks.app.library.loadAlbum).toHaveBeenCalledWith('al1');
  });

  it('shows the album actions and wires their buttons', async () => {
    const a = album();
    install(makeApp({ album: a, loading: false, error: undefined, loadedAt: 1 }));

    render(AlbumPage);
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: '[P] play' }));
    expect(mocks.actions.playAlbumNow).toHaveBeenCalledWith(a);

    await fireEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(mocks.actions.enqueueAlbum).toHaveBeenCalledWith(a, 'next');

    await fireEvent.click(screen.getByRole('button', { name: '[A] queue' }));
    expect(mocks.actions.enqueueAlbum).toHaveBeenCalledWith(a, 'end');

    await fireEvent.click(screen.getByRole('button', { name: 'Aurelia Vance' }));
    expect(mocks.actions.openArtist).toHaveBeenCalledWith('ar1');
  });

  it('plays a track with its album context when the row is activated', async () => {
    const a = album();
    install(makeApp({ album: a, loading: false, error: undefined, loadedAt: 1 }));

    render(AlbumPage);
    await tick();

    const row = screen.getByText('Signal Bloom').closest('[role="option"]');
    expect(row).toBeTruthy();
    await fireEvent.click(row as HTMLElement);

    expect(mocks.actions.playTrackNow).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't2' }),
      expect.objectContaining({ index: 1, label: 'Neon Cartography' }),
    );
  });

  it('shows the empty-tracklist state', async () => {
    install(
      makeApp({ album: album({ tracks: [], songCount: 0 }), loading: false, error: undefined }),
    );

    render(AlbumPage);
    await tick();

    expect(screen.getByText(/this album reports no tracks/i)).toBeTruthy();
  });

  it('shows the loading state while the album is unknown', async () => {
    install(makeApp({ album: undefined, loading: true, error: undefined, loadedAt: undefined }));

    render(AlbumPage);
    await tick();

    expect(screen.getByText(/loading album/i)).toBeTruthy();
  });

  it('shows the error state when the album fails to load', async () => {
    install(makeApp({ album: undefined, loading: false, error: 'kaboom', loadedAt: undefined }));

    render(AlbumPage);
    await tick();

    expect(screen.getByText(/could not load this album/i)).toBeTruthy();
    expect(screen.getByText(/kaboom/)).toBeTruthy();
  });

  it('shows the not-connected detail when there is no server', async () => {
    install(
      makeApp({ album: undefined, loading: false, error: 'not connected', loadedAt: undefined }),
    );

    render(AlbumPage);
    await tick();

    expect(screen.getByText(/could not load this album/i)).toBeTruthy();
    expect(screen.getByText(/not connected/)).toBeTruthy();
  });
});
