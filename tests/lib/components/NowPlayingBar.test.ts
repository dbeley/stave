import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Track } from '$lib/domain/types';

const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

import NowPlayingBar from '$lib/components/NowPlayingBar.svelte';

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
  error?: string;
  volume?: number;
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
      error: overrides.error,
    },
    volume: overrides.volume ?? 0.8,
    progress: overrides.progress ?? 0,
    previous: vi.fn(),
    toggle: vi.fn(),
    next: vi.fn(),
  };
  // `repeat` must be the real union, not a single literal: the badges branch on
  // it and the test flips it to 'all'.
  const queue = { state: { shuffle: false, repeat: 'off' as 'off' | 'one' | 'all' } };
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, { player, queue });
  return { player, queue };
}

async function mount(overrides: PlayerOverrides = {}) {
  const fakes = install(overrides);
  render(NowPlayingBar);
  await tick();
  return fakes;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NowPlayingBar', () => {
  it('invites the user to start something when nothing is playing', async () => {
    await mount();

    expect(screen.getByText(/nothing playing/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'previous track' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'play or pause' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'next track' })).toBeTruthy();
  });

  it('shows the current track, artist and album', async () => {
    await mount({ track: TRACK });

    expect(screen.getByText('Meridian Drift')).toBeTruthy();
    expect(screen.getByText('Aurelia Vance')).toBeTruthy();
    expect(screen.getByText('Neon Cartography')).toBeTruthy();
  });

  it('formats elapsed/remaining position from the player state', async () => {
    await mount({ track: TRACK, position: 65, duration: 215 });

    expect(screen.getByText('1:05/3:35')).toBeTruthy();
  });

  it('falls back to the track duration when the player has not reported one', async () => {
    await mount({ track: TRACK, position: 0, duration: 0 });

    expect(screen.getByText('0:00/3:35')).toBeTruthy();
  });

  it('renders the play glyph when paused and the pause glyph when playing', async () => {
    await mount({ track: TRACK, status: 'paused' });
    expect(screen.getByRole('button', { name: 'play or pause' }).textContent?.trim()).toBe('>');
  });

  it('shows the pause glyph while playing', async () => {
    install({ track: TRACK, status: 'playing' });
    render(NowPlayingBar);
    await tick();

    expect(screen.getByRole('button', { name: 'play or pause' }).textContent?.trim()).toBe('||');
  });

  it('shows shuffle and repeat badges when enabled', async () => {
    const fakes = install({ track: TRACK });
    fakes.queue.state.shuffle = true;
    fakes.queue.state.repeat = 'all';
    render(NowPlayingBar);
    await tick();

    expect(screen.getByText('shuffle')).toBeTruthy();
    expect(screen.getByText('repeat:all')).toBeTruthy();
  });

  it('labels the playback source', async () => {
    await mount({ track: TRACK, source: 'stream' });
    expect(screen.getByText('≈ stream')).toBeTruthy();
  });

  it('labels offline-cache playback', async () => {
    await mount({ track: TRACK, source: 'cache' });
    expect(screen.getByText('▣ local')).toBeTruthy();
  });

  it('exposes playback progress as an accessible progressbar', async () => {
    await mount({ track: TRACK, progress: 0.25 });

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
  });

  it('reports a playback error', async () => {
    await mount({ track: TRACK, error: 'stream failed' });

    expect(screen.getByText(/stream failed/)).toBeTruthy();
  });

  it('renders the volume bar as blocks', async () => {
    await mount({ track: TRACK, volume: 0.8 });

    expect(document.body.textContent).toContain('vol ▮▮▮▮▮▮▮▮▯▯');
  });

  it('drives the transport buttons', async () => {
    const { player } = await mount({ track: TRACK });

    await fireEvent.click(screen.getByRole('button', { name: 'play or pause' }));
    await fireEvent.click(screen.getByRole('button', { name: 'next track' }));
    await fireEvent.click(screen.getByRole('button', { name: 'previous track' }));

    expect(player.toggle).toHaveBeenCalled();
    expect(player.next).toHaveBeenCalled();
    expect(player.previous).toHaveBeenCalled();
  });
});
