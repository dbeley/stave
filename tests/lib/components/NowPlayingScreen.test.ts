import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Track } from '$lib/domain/types';

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

import NowPlayingScreen from '$lib/components/NowPlayingScreen.svelte';

function track(over: Partial<Track> = {}): Track {
  return {
    id: 't1',
    title: 'Meridian Drift',
    albumId: 'al1',
    albumName: 'Neon Cartography',
    artistId: 'ar1',
    artistName: 'Aurelia Vance',
    durationSec: 245,
    year: 2024,
    suffix: 'mp3',
    bitRate: 320,
    starred: false,
    ...over,
  };
}

function makeApp(over: Record<string, unknown> = {}): Record<string, any> {
  const current = track();
  return {
    router: { current: { name: 'now-playing' }, navigate: vi.fn() },
    player: {
      state: {
        track: current,
        status: 'playing',
        position: 60,
        duration: 245,
        source: 'stream',
        error: undefined,
        autoDjAdded: 0,
      },
      progress: 0.25,
      play: vi.fn().mockResolvedValue(undefined),
      previous: vi.fn(),
      next: vi.fn(),
      toggle: vi.fn(),
      seekBy: vi.fn(),
      seekFraction: vi.fn(),
    },
    queue: {
      items: [
        { uid: 'u1', track: current },
        { uid: 'u2', track: track({ id: 't2', title: 'Signal Bloom' }) },
      ],
      state: { index: 0, shuffle: false, repeat: 'off', cursor: 0 },
      length: 2,
      setCursor: vi.fn(),
      moveCursor: vi.fn(),
      jumpToUid: vi.fn(),
      removeAtCursor: vi.fn(() => 1),
      moveCursorItem: vi.fn(() => true),
      clear: vi.fn(),
      toggleShuffle: vi.fn(() => true),
      cycleRepeat: vi.fn(() => 'all'),
    },
    ui: {
      state: { nowPlayingTab: 'info' },
      showNowPlayingTab: vi.fn(),
    },
    favorites: { isTrackStarred: () => false },
    resolver: { isCached: () => false },
    // coverArtIdFor falls back to the album when the track carries no art id.
    library: { albumDetail: () => ({ album: undefined }) },
    settings: { state: { asciiCoverArt: false } },
    keyboard: { registerAll: vi.fn(() => () => {}) },
    getClient: () => null,
    toasts: { info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...over,
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
    openTrackActions: vi.fn(),
    toggleTrackFavorite: vi.fn(),
  });
});

describe('NowPlayingScreen', () => {
  it('renders both segments and shows info by default', async () => {
    install(makeApp());

    render(NowPlayingScreen);
    await tick();

    expect(screen.getByRole('tab', { name: 'now playing' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'queue' })).toBeTruthy();

    // The info segment is the default: hero + transport are visible.
    expect(screen.getByRole('button', { name: 'play or pause' })).toBeTruthy();
    // The queue segment is not rendered yet.
    expect(screen.queryByText('Signal Bloom')).toBeNull();
  });

  it('switches the tab through the shared ui store', async () => {
    const app = makeApp();
    install(app);

    render(NowPlayingScreen);
    await tick();

    await fireEvent.click(screen.getByRole('tab', { name: 'queue' }));
    expect(app.ui.showNowPlayingTab).toHaveBeenCalledWith('queue');

    await fireEvent.click(screen.getByRole('tab', { name: 'now playing' }));
    expect(app.ui.showNowPlayingTab).toHaveBeenCalledWith('info');
  });

  it('shows queue rows when the queue segment is selected', async () => {
    const app = makeApp();
    app.ui.state.nowPlayingTab = 'queue';
    install(app);

    render(NowPlayingScreen);
    await tick();

    expect(screen.getByText('Signal Bloom')).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'queue' })).toBeTruthy();
    // The info segment is hidden.
    expect(screen.queryByRole('button', { name: 'play or pause' })).toBeNull();
  });

  it('renders an empty state with no track', async () => {
    const app = makeApp();
    app.player.state.track = undefined;
    install(app);

    render(NowPlayingScreen);
    await tick();

    expect(screen.getByText('nothing is playing')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'play or pause' })).toBeNull();
  });
});
