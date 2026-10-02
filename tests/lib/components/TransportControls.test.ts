import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

import TransportControls from '$lib/components/TransportControls.svelte';

function install() {
  const player = {
    state: { status: 'paused' },
    previous: vi.fn(),
    toggle: vi.fn(),
    next: vi.fn(),
    seekBy: vi.fn(),
  };
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, { player });
  return { player };
}

async function mount(props: Record<string, any> = {}) {
  const fakes = install();
  render(TransportControls, { props });
  await tick();
  return fakes;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TransportControls', () => {
  it('drives previous, play/pause and next through the player', async () => {
    const { player } = await mount();

    await fireEvent.click(screen.getByRole('button', { name: 'play or pause' }));
    expect(player.toggle).toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'next track' }));
    expect(player.next).toHaveBeenCalled();

    await fireEvent.click(screen.getByRole('button', { name: 'previous track' }));
    expect(player.previous).toHaveBeenCalled();
  });

  it('omits the ±10s buttons by default', async () => {
    await mount();

    expect(screen.queryByRole('button', { name: 'seek back 10 seconds' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'seek forward 10 seconds' })).toBeNull();
  });

  it('offers ±10s seek when seek10 is set', async () => {
    const { player } = await mount({ seek10: true });

    await fireEvent.click(screen.getByRole('button', { name: 'seek back 10 seconds' }));
    expect(player.seekBy).toHaveBeenCalledWith(-10);

    await fireEvent.click(screen.getByRole('button', { name: 'seek forward 10 seconds' }));
    expect(player.seekBy).toHaveBeenCalledWith(10);
  });

  it('lays the controls out in order', async () => {
    await mount({ seek10: true });

    const labels = screen.getAllByRole('button').map((button) => button.getAttribute('aria-label'));
    expect(labels).toEqual([
      'previous track',
      'seek back 10 seconds',
      'play or pause',
      'seek forward 10 seconds',
      'next track',
    ]);
  });
});
