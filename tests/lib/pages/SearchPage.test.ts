import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Album, Artist, SearchResults, Track } from '$lib/domain/types';

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

import SearchPage from '$lib/pages/SearchPage.svelte';

function artist(id: string, name: string): Artist {
  return { id, name, albumCount: 1, starred: false };
}

function album(id: string, name: string): Album {
  return { id, name, songCount: 3, durationSec: 600, starred: false };
}

function track(id: string, title: string): Track {
  return { id, title, durationSec: 200, starred: false };
}

function results(partial: Partial<SearchResults> = {}): SearchResults {
  return { artists: [], albums: [], tracks: [], ...partial };
}

function makeApp(res: SearchResults, over: Record<string, unknown> = {}): Record<string, any> {
  const total = res.artists.length + res.albums.length + res.tracks.length;
  const app: Record<string, any> = {
    search: {
      state: { query: '', resultsFor: '', results: res, loading: false, error: undefined, total },
      hasQuery: true,
      setQuery: vi.fn(),
      submit: vi.fn().mockResolvedValue(undefined),
    },
    focusRequests: { search: 0 },
    toasts: { info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn() },
    player: { state: { track: undefined as Track | undefined } },
    keyboard: { registerAll: vi.fn(() => () => {}) },
    settings: { state: { showTechnicalColumns: false, asciiCoverArt: false } },
    favorites: {
      isAlbumStarred: () => false,
      isArtistStarred: () => false,
      isTrackStarred: () => false,
    },
    listenLater: { has: () => false },
    downloads: { isCached: () => false },
    resolver: { isCached: () => false },
  };
  if (over.search) {
    const { state, ...rest } = over.search as { state?: Record<string, unknown> } & Record<
      string,
      unknown
    >;
    Object.assign(app.search, rest);
    if (state) Object.assign(app.search.state, state);
  }
  for (const [key, value] of Object.entries(over)) {
    if (key !== 'search') app[key] = value;
  }
  return app;
}

function install(app: Record<string, unknown>): void {
  for (const key of Object.keys(mocks.app)) delete mocks.app[key];
  Object.assign(mocks.app, app);
}

beforeEach(() => {
  for (const key of Object.keys(mocks.actions)) delete mocks.actions[key];
  Object.assign(mocks.actions, {
    openArtist: vi.fn(),
    openAlbum: vi.fn(),
    playTrackNow: vi.fn(),
    playArtistNow: vi.fn(),
    playAlbumNow: vi.fn(),
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
  });
});

describe('SearchPage', () => {
  it('renders headings with counts plus every result', async () => {
    install(
      makeApp(
        results({
          artists: [artist('ar1', 'Aurelia Vance')],
          albums: [album('al1', 'Neon Cartography')],
          tracks: [track('t1', 'Meridian Drift')],
        }),
      ),
    );

    render(SearchPage);
    await tick();

    expect(screen.getByText(/artists \(1\)/)).toBeTruthy();
    expect(screen.getByText(/albums \(1\)/)).toBeTruthy();
    expect(screen.getByText(/tracks \(1\)/)).toBeTruthy();
    expect(screen.getByText('Aurelia Vance')).toBeTruthy();
    expect(screen.getByText('Neon Cartography')).toBeTruthy();
    expect(screen.getByText('Meridian Drift')).toBeTruthy();
  });

  it('offers per-result queue actions for tracks and albums', async () => {
    install(
      makeApp(
        results({
          albums: [album('al1', 'Neon Cartography')],
          tracks: [track('t1', 'Meridian Drift')],
        }),
      ),
    );

    render(SearchPage);
    await tick();

    expect(screen.getByTitle('add to the end of the queue')).toBeTruthy();
    expect(screen.getByTitle('play next')).toBeTruthy();
    expect(screen.getByTitle('add album to the end of the queue')).toBeTruthy();
    expect(screen.getByTitle('play album next')).toBeTruthy();
  });

  it('queues a track next when its mini button is clicked without navigating', async () => {
    install(makeApp(results({ tracks: [track('t1', 'Meridian Drift')] })));

    render(SearchPage);
    await tick();

    await fireEvent.click(screen.getByTitle('play next'));

    expect(mocks.actions.enqueueTrack).toHaveBeenCalledWith(
      expect.objectContaining({ id: 't1' }),
      'next',
    );
    expect(mocks.actions.playTrackNow).not.toHaveBeenCalled();
  });

  it('typing asks the store to set the query', async () => {
    install(makeApp(results()));

    render(SearchPage);
    await tick();

    const input = screen.getByLabelText('search');
    await fireEvent.input(input, { target: { value: 'neon' } });

    expect(mocks.app.search.setQuery).toHaveBeenCalledWith('neon');
  });

  it('pressing Enter runs the search immediately', async () => {
    install(makeApp(results()));

    render(SearchPage);
    await tick();

    await fireEvent.keyDown(screen.getByLabelText('search'), { key: 'Enter' });

    expect(mocks.app.search.submit).toHaveBeenCalled();
  });

  it('activating a track replaces the queue and plays it', async () => {
    install(makeApp(results({ tracks: [track('t1', 'Meridian Drift')] })));

    render(SearchPage);
    await tick();

    await fireEvent.click(
      screen.getByText('Meridian Drift').closest('[role="option"]') as HTMLElement,
    );

    expect(mocks.actions.playTrackNow).toHaveBeenCalledWith(expect.objectContaining({ id: 't1' }));
  });

  it('activating an album or an artist navigates to it', async () => {
    install(
      makeApp(
        results({
          albums: [album('al1', 'Neon Cartography')],
          artists: [artist('ar1', 'Aurelia Vance')],
        }),
      ),
    );

    render(SearchPage);
    await tick();

    await fireEvent.click(
      screen.getByText('Neon Cartography').closest('[role="option"]') as HTMLElement,
    );
    expect(mocks.actions.openAlbum).toHaveBeenCalledWith('al1');

    await fireEvent.click(
      screen.getByText('Aurelia Vance').closest('[role="option"]') as HTMLElement,
    );
    expect(mocks.actions.openArtist).toHaveBeenCalledWith('ar1');
  });

  it('nudges the user to type before there is a query', async () => {
    install(makeApp(results(), { search: { hasQuery: false } }));

    render(SearchPage);
    await tick();

    expect(screen.getByText(/type to search/i)).toBeTruthy();
  });

  it('shows the empty state when a query returns nothing', async () => {
    install(makeApp(results()));

    render(SearchPage);
    await tick();

    expect(screen.getByText(/no results/i)).toBeTruthy();
  });

  it('shows the error state when the search fails', async () => {
    install(makeApp(results(), { search: { state: { error: 'kaboom' }, hasQuery: true } }));

    render(SearchPage);
    await tick();

    expect(screen.getByText(/search failed/i)).toBeTruthy();
    expect(screen.getByText(/kaboom/)).toBeTruthy();
  });
});
