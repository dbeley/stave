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

import NowPlayingPage from '$lib/pages/NowPlayingPage.svelte';

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
    },
    queue: {
      items: [
        { uid: 'u1', track: current },
        { uid: 'u2', track: track({ id: 't2', title: 'Signal Bloom' }) },
      ],
      state: { index: 0, shuffle: false, repeat: 'off' },
      length: 2,
      jumpToUid: vi.fn(),
      removeAtCursor: vi.fn(() => 1),
      moveCursorItem: vi.fn(() => true),
      clear: vi.fn(),
      toggleShuffle: vi.fn(() => true),
      cycleRepeat: vi.fn(() => 'all'),
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

describe('NowPlayingPage', () => {
  it('says so when nothing is playing, instead of showing empty scaffolding', async () => {
    const app = makeApp();
    app.player.state.track = undefined;
    install(app);

    render(NowPlayingPage);
    await tick();

    expect(screen.getByText('nothing is playing')).toBeTruthy();
    expect(screen.queryByText('Meridian Drift')).toBeNull();
  });

  it('renders the cover, metadata and the queue', async () => {
    install(makeApp());

    const { container } = render(NowPlayingPage);
    await tick();

    // The title also appears in the queue row below, so scope to the heading.
    expect(container.querySelector('h1')?.textContent?.trim()).toBe('Meridian Drift');
    expect(screen.getByRole('button', { name: 'Aurelia Vance' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Neon Cartography' })).toBeTruthy();

    const meta = container.querySelector('.meta')?.textContent ?? '';
    expect(meta).toContain('2024');
    expect(meta).toContain('MP3');
    expect(meta).toContain('320 kbps');
    expect(meta).toContain('4:05');

    // Both queue rows are rendered by the shared QueueList.
    expect(screen.getByText('Signal Bloom')).toBeTruthy();
    expect(screen.getByRole('listbox', { name: 'queue' })).toBeTruthy();
  });

  it('follows the transport buttons through to the player', async () => {
    const app = makeApp();
    install(app);
    render(NowPlayingPage);
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: 'play or pause' }));
    expect(app.player.toggle).toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'next track' }));
    expect(app.player.next).toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'previous track' }));
    expect(app.player.previous).toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'seek back 10 seconds' }));
    expect(app.player.seekBy).toHaveBeenCalledWith(-10);

    await fireEvent.click(screen.getByRole('button', { name: 'seek forward 10 seconds' }));
    expect(app.player.seekBy).toHaveBeenCalledWith(10);
  });

  it('shows the audio source, including when it comes from the cache', async () => {
    const app = makeApp();
    install(app);
    const first = render(NowPlayingPage);
    await tick();
    expect(screen.getByText('≈ stream')).toBeTruthy();
    first.unmount();

    const cached = makeApp();
    cached.player.state.source = 'cache';
    cached.resolver.isCached = () => true;
    install(cached);
    render(NowPlayingPage);
    await tick();
    expect(screen.getByText('▣ offline')).toBeTruthy();
  });

  it('navigates to the artist and the album from the metadata', async () => {
    install(makeApp());
    render(NowPlayingPage);
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: 'Aurelia Vance' }));
    expect(mocks.actions.openArtist).toHaveBeenCalledWith('ar1');

    await fireEvent.click(screen.getByRole('button', { name: 'Neon Cartography' }));
    expect(mocks.actions.openAlbum).toHaveBeenCalledWith('al1');
  });

  it('registers its own bindings for the current track', async () => {
    const app = makeApp();
    install(app);
    render(NowPlayingPage);
    await tick();

    // Flatten every registration: the queue list is a child component and
    // mounts (and registers) before the page does.
    const calls = app.keyboard.registerAll.mock.calls as Array<
      [Array<{ keys: string[]; run: () => void }>]
    >;
    const bindings = calls.flatMap((call) => call[0]);
    const forKeys = (keys: string[]) => bindings.find((b) => keys.every((k) => b.keys.includes(k)));

    forKeys(['o'])?.run();
    expect(mocks.actions.openTrackActions).toHaveBeenCalledWith(app.player.state.track);

    forKeys(['f'])?.run();
    expect(mocks.actions.toggleTrackFavorite).toHaveBeenCalledWith(app.player.state.track);

    forKeys(['y'])?.run();
    expect(mocks.actions.openArtist).toHaveBeenCalledWith('ar1');
  });

  it('jumps to the queue item when its row is activated', async () => {
    const app = makeApp();
    install(app);
    render(NowPlayingPage);
    await tick();

    await fireEvent.click(screen.getByText('Signal Bloom'));
    expect(app.queue.jumpToUid).toHaveBeenCalledWith('u2');
    expect(app.player.toggle).not.toHaveBeenCalled();
  });
});
