import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Track } from '$lib/domain/types';

const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

import SeekBar from '$lib/components/SeekBar.svelte';

const TRACK: Track = {
  id: 't1',
  title: 'Meridian Drift',
  durationSec: 215,
  starred: false,
};

interface PlayerOverrides {
  position?: number;
  duration?: number;
  track?: Track;
  progress?: number;
}

function install(overrides: PlayerOverrides = {}) {
  const player = {
    state: {
      position: overrides.position ?? 0,
      duration: overrides.duration ?? 0,
      track: overrides.track,
    },
    progress: overrides.progress ?? 0,
    seekFraction: vi.fn(),
  };
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, { player });
  return { player };
}

async function mount(overrides: PlayerOverrides = {}, props: Record<string, any> = {}) {
  const fakes = install(overrides);
  render(SeekBar, { props });
  await tick();
  return fakes;
}

/**
 * jsdom has no `PointerEvent`, so `fireEvent.pointerDown` would fall back to a
 * plain `Event` and drop `clientX`. A `MouseEvent` carrying the pointer type
 * name reaches the component's `onpointerdown`/`onpointerup` listeners, and
 * `clientX` is the only coordinate the seek logic reads.
 */
function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number): MouseEvent {
  return new MouseEvent(type, { clientX, bubbles: true, cancelable: true, composed: true });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('SeekBar', () => {
  it('exposes the position as an accessible slider', async () => {
    await mount({ position: 50, duration: 200, progress: 0.25 }, { interactive: true });

    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-valuemin')).toBe('0');
    expect(slider.getAttribute('aria-valuemax')).toBe('100');
    expect(slider.getAttribute('aria-valuenow')).toBe('25');
  });

  it('defaults the slider name to seek', async () => {
    await mount({ position: 50, duration: 200, progress: 0.25 }, { interactive: true });
    expect(screen.getByRole('slider').getAttribute('aria-label')).toBe('seek');
  });

  it('names the slider from the label', async () => {
    await mount(
      { position: 50, duration: 200, progress: 0.25 },
      { interactive: true, label: 'progress' },
    );
    expect(screen.getByRole('slider').getAttribute('aria-label')).toBe('progress');
  });

  it('seeks to the tapped fraction', async () => {
    const { player } = await mount(
      { position: 0, duration: 200, progress: 0.25 },
      {
        interactive: true,
      },
    );

    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;

    slider.dispatchEvent(pointer('pointerdown', 100));
    slider.dispatchEvent(pointer('pointerup', 100));

    expect(player.seekFraction).toHaveBeenCalledWith(0.5);
  });

  it('ignores a tap when the duration is unknown', async () => {
    const { player } = await mount(
      { position: 0, duration: 0, progress: 0 },
      {
        interactive: true,
      },
    );

    const slider = screen.getByRole('slider');
    slider.getBoundingClientRect = () => ({ left: 0, width: 200 }) as DOMRect;

    slider.dispatchEvent(pointer('pointerdown', 100));
    slider.dispatchEvent(pointer('pointerup', 100));

    expect(player.seekFraction).not.toHaveBeenCalled();
  });

  it('renders a read-only progressbar when not interactive', async () => {
    await mount({ position: 50, duration: 200, progress: 0.25 });

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('25');
  });

  it('renders the time pair when showTimes is set', async () => {
    await mount(
      { position: 65, duration: 215, track: TRACK, progress: 0.25 },
      {
        showTimes: true,
      },
    );

    expect(screen.getByText('1:05/3:35')).toBeTruthy();
  });
});
