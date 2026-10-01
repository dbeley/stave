import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { KeyboardRouter } from '$lib/keyboard/registry.svelte';

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

import ArtistPage from '$lib/pages/ArtistPage.svelte';

function makeApp(slice: Record<string, unknown>): Record<string, any> {
  const client = { getPlaylists: vi.fn().mockResolvedValue([]), getPlaylist: vi.fn() };
  return {
    router: { current: { name: 'artist', id: 'ar1' }, navigate: vi.fn() },
    library: {
      artists: { listing: undefined, loading: false, error: undefined },
      loadArtistsList: vi.fn(),
      artistDetail: vi.fn(() => slice),
      loadArtist: vi.fn().mockResolvedValue(undefined),
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
    isConnected: true,
    requireClient: () => client,
    toasts: { info: vi.fn(), warn: vi.fn(), ok: vi.fn(), error: vi.fn() },
  };
}

function slice(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artist: { id: 'ar1', name: 'Aurelia Vance', albumCount: 2, starred: false },
    albums: [
      {
        id: 'al1',
        name: 'Neon Cartography',
        artistId: 'ar1',
        songCount: 8,
        durationSec: 2400,
        starred: false,
      },
    ],
    topSongs: [
      { id: 't1', title: 'Signal Bloom', durationSec: 200, starred: false, artistId: 'ar1' },
    ],
    bio: { biography: 'A synth explorer.', similarArtists: [] },
    bioUnavailable: false,
    loading: false,
    error: undefined,
    ...overrides,
  };
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
    playArtistNow: vi.fn(),
    toggleArtistFavorite: vi.fn(),
    openArtistActions: vi.fn(),
    playTrackNow: vi.fn(),
  });
});

describe('ArtistPage', () => {
  it('renders the artist, album and top-track panels', () => {
    install(makeApp(slice()));

    render(ArtistPage);

    expect(screen.getByText('Aurelia Vance')).toBeTruthy();
    expect(screen.getByText('Neon Cartography')).toBeTruthy();
    expect(screen.getByText('Signal Bloom')).toBeTruthy();
    expect(screen.getByText('A synth explorer.')).toBeTruthy();
  });

  it('shows the no-biography info state when the server has no metadata', () => {
    install(makeApp(slice({ bio: undefined, bioUnavailable: true })));

    render(ArtistPage);

    expect(screen.getByText(/no biography available/i)).toBeTruthy();
  });

  it('shows the error state when the artist fails to load', () => {
    install(makeApp(slice({ artist: undefined, albums: [], topSongs: [], error: 'kaboom' })));

    render(ArtistPage);

    expect(screen.getByText(/could not load this artist/i)).toBeTruthy();
    expect(screen.getByText(/kaboom/)).toBeTruthy();
  });

  it('acts on the similar artist under the cursor, not on the artist being viewed', async () => {
    // Regression: the page-level `o` (the artist you are standing on) used to win
    // in the similar-artists pane, so asking for actions while hovering a similar
    // artist gave you actions for the wrong artist entirely.
    const router = new KeyboardRouter({ activeScopes: () => ['page', 'global'] });
    const app = makeApp(
      slice({
        bio: {
          biography: 'A synth explorer.',
          similarArtists: [{ id: 'ar9', name: 'Other Artist', albumCount: 1 }],
        },
      }),
    );
    app.keyboard = {
      registerAll: (bindings: unknown) => router.registerAll(bindings as never),
    };
    install(app);

    render(ArtistPage);
    await tick();

    // Tab twice: albums → top tracks → similar artists, then ask for actions.
    router.handle({ key: 'Tab' });
    router.handle({ key: 'Tab' });
    router.handle({ key: 'o' });

    expect(mocks.actions.openArtistActions).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'ar9' }),
    );
  });
});
