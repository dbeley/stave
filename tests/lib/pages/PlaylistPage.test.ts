import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';

const mocks = vi.hoisted(() => {
  // `$lib/keyboard/list.svelte.ts` is a plain .ts module using `$state`; the Svelte
  // plugin only compiles runes in *.svelte.ts modules, so under vitest the rune
  // resolves to Svelte's throwing global stub. Emulate the compiler here.
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

import PlaylistPage from '$lib/pages/PlaylistPage.svelte';

interface Options {
  playlist?: unknown;
  reject?: Error;
  connected?: boolean;
}

function makeApp({ playlist, reject, connected = true }: Options): Record<string, any> {
  const getPlaylist = reject
    ? vi.fn().mockRejectedValue(reject)
    : vi.fn().mockResolvedValue(playlist);
  const client = { getPlaylist, getPlaylists: vi.fn().mockResolvedValue([]) };
  return {
    router: { current: { name: 'playlist', id: 'p1' }, navigate: vi.fn() },
    library: {
      artists: { listing: undefined, loading: false, error: undefined },
      artistDetail: vi.fn(),
      loadArtist: vi.fn(),
      loadArtistsList: vi.fn(),
    },
    favorites: {
      isArtistStarred: () => false,
      isAlbumStarred: () => false,
      isTrackStarred: () => false,
    },
    listenLater: { has: () => false },
    downloads: { isCached: () => false },
    resolver: { isCached: () => false },
    player: { state: { track: undefined } },
    keyboard: { registerAll: vi.fn(() => () => {}) },
    settings: { state: { showTechnicalColumns: false, offlineCacheEnabled: false } },
    isConnected: connected,
    requireClient: () => client,
    toasts: { info: vi.fn(), warn: vi.fn(), ok: vi.fn(), error: vi.fn() },
  };
}

const PLAYLIST = {
  id: 'p1',
  name: 'Late Night Jazz',
  owner: 'david',
  songCount: 2,
  durationSec: 537,
  starred: false,
  entries: [
    { id: 't1', title: 'Blue in Green', durationSec: 337, starred: false, trackNumber: 1 },
    { id: 't2', title: 'So What', durationSec: 200, starred: false, trackNumber: 2 },
  ],
};

function install(app: Record<string, unknown>): void {
  for (const key of Object.keys(mocks.app)) delete mocks.app[key];
  Object.assign(mocks.app, app);
}

beforeEach(() => {
  for (const key of Object.keys(mocks.actions)) delete mocks.actions[key];
  Object.assign(mocks.actions, { playTrackNow: vi.fn() });
});

describe('PlaylistPage', () => {
  it('renders the header metadata and the track list', async () => {
    install(makeApp({ playlist: PLAYLIST }));

    render(PlaylistPage);

    expect(await screen.findByText('Late Night Jazz')).toBeTruthy();
    expect(screen.getByText('david')).toBeTruthy();
    expect(screen.getByText(/2 tracks/)).toBeTruthy();
    expect(screen.getByText('Blue in Green')).toBeTruthy();
    expect(screen.getByText('So What')).toBeTruthy();
  });

  it('shows the empty state when the playlist has no entries', async () => {
    install(makeApp({ playlist: { ...PLAYLIST, songCount: 0, durationSec: 0, entries: [] } }));

    render(PlaylistPage);

    expect(await screen.findByText(/this playlist is empty/i)).toBeTruthy();
    expect(screen.getByText(/0 tracks/)).toBeTruthy();
  });

  it('shows the error state when the fetch fails', async () => {
    install(makeApp({ reject: new Error('down') }));

    render(PlaylistPage);

    expect(await screen.findByText(/could not load this playlist/i)).toBeTruthy();
    expect(screen.getByText(/down/)).toBeTruthy();
  });

  it('reports not connected without hitting the server', async () => {
    install(makeApp({ connected: false }));

    render(PlaylistPage);

    expect(await screen.findByText(/could not load this playlist/i)).toBeTruthy();
    expect(screen.getByText(/not connected/)).toBeTruthy();
  });
});
