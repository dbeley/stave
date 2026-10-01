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

import PlaylistsPage from '$lib/pages/PlaylistsPage.svelte';

interface Options {
  playlists?: unknown[];
  reject?: Error;
  connected?: boolean;
}

function makeApp({ playlists = [], reject, connected = true }: Options): Record<string, any> {
  const getPlaylists = reject
    ? vi.fn().mockRejectedValue(reject)
    : vi.fn().mockResolvedValue(playlists);
  const client = { getPlaylists, getPlaylist: vi.fn() };
  return {
    router: { current: { name: 'playlists' }, navigate: vi.fn() },
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

function install(app: Record<string, unknown>): void {
  for (const key of Object.keys(mocks.app)) delete mocks.app[key];
  Object.assign(mocks.app, app);
}

beforeEach(() => {
  for (const key of Object.keys(mocks.actions)) delete mocks.actions[key];
  Object.assign(mocks.actions, {});
});

describe('PlaylistsPage', () => {
  it('renders playlist name, owner, track count and duration', async () => {
    install(
      makeApp({
        playlists: [
          {
            id: 'p1',
            name: 'Late Night Jazz',
            owner: 'david',
            songCount: 12,
            durationSec: 3725,
            starred: false,
          },
        ],
      }),
    );

    render(PlaylistsPage);

    expect(await screen.findByText('Late Night Jazz')).toBeTruthy();
    expect(screen.getByText('david')).toBeTruthy();
    expect(screen.getByText('12 tracks')).toBeTruthy();
    expect(screen.getByText('1 h 02 min')).toBeTruthy();
  });

  it('shows the empty state when there are no playlists', async () => {
    install(makeApp({ playlists: [] }));

    render(PlaylistsPage);

    expect(await screen.findByText(/no playlists/i)).toBeTruthy();
  });

  it('shows the error state when the fetch fails', async () => {
    install(makeApp({ reject: new Error('down') }));

    render(PlaylistsPage);

    expect(await screen.findByText(/could not load playlists/i)).toBeTruthy();
    expect(screen.getByText(/down/)).toBeTruthy();
  });

  it('reports not connected without hitting the server', async () => {
    install(makeApp({ connected: false }));

    render(PlaylistsPage);

    expect(await screen.findByText(/could not load playlists/i)).toBeTruthy();
    expect(screen.getByText(/not connected/)).toBeTruthy();
  });
});
