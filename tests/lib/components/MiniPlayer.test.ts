import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Track } from '$lib/domain/types';

const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

import MiniPlayer from '$lib/components/MiniPlayer.svelte';

const TRACK: Track = {
  id: 't1',
  title: 'Meridian Drift',
  artistName: 'Aurelia Vance',
  albumName: 'Neon Cartography',
  durationSec: 215,
  starred: false,
};

interface PlayerOverrides {
  track?: Track;
  status?: string;
  position?: number;
  duration?: number;
  source?: string;
  progress?: number;
}

function install(overrides: PlayerOverrides = {}) {
  const player = {
    state: {
      track: overrides.track,
      status: overrides.status ?? 'paused',
      position: overrides.position ?? 0,
      duration: overrides.duration ?? 0,
      source: overrides.source,
    },
    progress: overrides.progress ?? 0,
    previous: vi.fn(),
    toggle: vi.fn(),
    next: vi.fn(),
    seekFraction: vi.fn(),
  };
  const router = { navigate: vi.fn() };
  const library = { albumDetail: vi.fn(() => ({ album: undefined })) };
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, {
    player,
    router,
    library,
    // CoverArt -> coverArtUrl asks the client for a URL; without one it falls
    // back to the generated ASCII pattern, which is all jsdom can render.
    getClient: () => null,
  });
  return { player, router };
}

async function mount(overrides: PlayerOverrides = {}) {
  const fakes = install(overrides);
  const result = render(MiniPlayer);
  await tick();
  return { ...fakes, container: result.container };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MiniPlayer', () => {
  it('renders nothing without a current track', async () => {
    const { container } = await mount();

    expect(container.textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'open now playing' })).toBeNull();
  });

  it('shows title and artist', async () => {
    await mount({ track: TRACK });

    expect(screen.getByText('Meridian Drift')).toBeTruthy();
    expect(screen.getByText('Aurelia Vance')).toBeTruthy();
  });

  it('opens now playing when the body is tapped', async () => {
    const { router } = await mount({ track: TRACK });

    await fireEvent.click(screen.getByRole('button', { name: 'open now playing' }));

    expect(router.navigate).toHaveBeenCalledWith({ name: 'now-playing' });
  });

  it('drives play/pause and next', async () => {
    const { player, router } = await mount({ track: TRACK });

    await fireEvent.click(screen.getByRole('button', { name: 'play or pause' }));
    await fireEvent.click(screen.getByRole('button', { name: 'next track' }));

    expect(player.toggle).toHaveBeenCalled();
    expect(player.next).toHaveBeenCalled();
    // The transport must not bubble into the body's "open now playing" tap.
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it('exposes a seekable progress slider', async () => {
    await mount({ track: TRACK, position: 50, duration: 200, progress: 0.25 });

    expect(screen.getByRole('slider').getAttribute('aria-valuenow')).toBe('25');
  });

  it('labels the playback source', async () => {
    await mount({ track: TRACK, source: 'stream' });
    expect(screen.getByText('≈')).toBeTruthy();
  });

  it('labels offline-cache playback', async () => {
    await mount({ track: TRACK, source: 'cache' });
    expect(screen.getByText('▣')).toBeTruthy();
  });
});
