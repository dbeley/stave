import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';

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

import ArtistsPage from '$lib/pages/ArtistsPage.svelte';

function artist(id: string, name: string, albumCount = 1) {
  return { id, name, albumCount, starred: false };
}

function makeApp(artistsSlice: Record<string, unknown>): Record<string, any> {
  const client = {
    getPlaylists: vi.fn().mockResolvedValue([]),
    getPlaylist: vi.fn(),
  };
  return {
    router: { current: { name: 'artists' }, navigate: vi.fn() },
    library: {
      artists: artistsSlice,
      loadArtistsList: vi.fn().mockResolvedValue(undefined),
      artistDetail: vi.fn(),
      loadArtist: vi.fn().mockResolvedValue(undefined),
    },
    favorites: {
      isArtistStarred: () => false,
      isAlbumStarred: () => false,
      isTrackStarred: () => false,
    },
    keyboard: { registerAll: vi.fn(() => () => {}) },
    settings: { state: { showTechnicalColumns: false } },
    resolver: { isCached: () => false },
    player: { state: { track: undefined } },
    isConnected: true,
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
  Object.assign(mocks.actions, {
    openArtist: vi.fn(),
    playArtistNow: vi.fn(),
    toggleArtistFavorite: vi.fn(),
    openArtistActions: vi.fn(),
  });
});

describe('ArtistsPage', () => {
  it('renders the index headings and artist names', async () => {
    install(
      makeApp({
        loading: false,
        error: undefined,
        listing: {
          ignoredArticles: 'The',
          indexes: [
            {
              name: 'A',
              artists: [artist('a1', 'Aurelia Vance', 2), artist('a2', 'Amon Tobin', 5)],
            },
            { name: 'B', artists: [artist('b1', 'Boards of Canada', 3)] },
          ],
          artists: [],
        },
      }),
    );

    render(ArtistsPage);

    expect(await screen.findByText('Aurelia Vance')).toBeTruthy();
    expect(screen.getByText('Amon Tobin')).toBeTruthy();
    expect(screen.getByText('Boards of Canada')).toBeTruthy();
    expect(screen.getByText(/A \(2\)/)).toBeTruthy();
    expect(screen.getByText(/B \(1\)/)).toBeTruthy();
  });

  it('loads the artist index on mount', async () => {
    install(makeApp({ loading: true, error: undefined, listing: undefined }));

    render(ArtistsPage);

    await waitFor(() => expect(mocks.app.library.loadArtistsList).toHaveBeenCalled());
  });

  it('shows the empty state when the index has no artists', async () => {
    install(
      makeApp({
        loading: false,
        error: undefined,
        listing: { ignoredArticles: '', indexes: [], artists: [] },
      }),
    );

    render(ArtistsPage);

    expect(await screen.findByText(/no artists yet/i)).toBeTruthy();
  });

  it('shows the error state when loading fails', async () => {
    install(makeApp({ loading: false, error: 'boom', listing: undefined }));

    render(ArtistsPage);

    expect(await screen.findByText(/could not load artists/i)).toBeTruthy();
    expect(screen.getByText(/boom/)).toBeTruthy();
  });

  it('jumps to the letter bucket when its shortcut is pressed', async () => {
    install(
      makeApp({
        loading: false,
        error: undefined,
        listing: {
          ignoredArticles: '',
          indexes: [
            { name: 'A', artists: [artist('a1', 'Aurelia Vance', 2)] },
            { name: 'B', artists: [artist('b1', 'Boards of Canada', 3)] },
          ],
          artists: [],
        },
      }),
    );

    render(ArtistsPage);
    await screen.findByText('Boards of Canada');

    const bindings = mocks.app.keyboard.registerAll.mock.calls.flatMap((call: any[]) => call[0]);
    const jumpB = bindings.find((b: any) => b.keys.includes('b'));
    expect(jumpB).toBeTruthy();

    jumpB.run();
    await tick();

    const row = screen.getByText('Boards of Canada').closest('[role="option"]');
    expect(row?.getAttribute('aria-selected')).toBe('true');
    expect(
      screen.getByText('Aurelia Vance').closest('[role="option"]')?.getAttribute('aria-selected'),
    ).toBe('false');
  });

  it('reports a letter that has no artists', async () => {
    install(
      makeApp({
        loading: false,
        error: undefined,
        listing: {
          ignoredArticles: '',
          indexes: [{ name: 'A', artists: [artist('a1', 'Aurelia Vance', 2)] }],
          artists: [],
        },
      }),
    );

    render(ArtistsPage);
    await screen.findByText('Aurelia Vance');

    const bindings = mocks.app.keyboard.registerAll.mock.calls.flatMap((call: any[]) => call[0]);
    const jumpZ = bindings.find((b: any) => b.keys.includes('z'));
    expect(jumpZ).toBeTruthy();

    jumpZ.run();

    expect(mocks.app.toasts.info).toHaveBeenCalledWith(expect.stringContaining('Z'));
  });
});
