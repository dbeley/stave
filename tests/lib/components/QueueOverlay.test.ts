import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Track } from '$lib/domain/types';
import { KeyboardRouter } from '$lib/keyboard/registry.svelte';
import { QueueStore } from '$lib/stores/queue.svelte';

const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

import QueueOverlay from '$lib/components/QueueOverlay.svelte';

function track(id: string, title: string, artistName: string, durationSec: number): Track {
  return { id, title, artistName, durationSec, starred: false };
}

function buildFakes() {
  const keyboard = new KeyboardRouter({ activeScopes: () => ['overlay', 'queue'] });
  const items = [
    { uid: 'q1', track: track('t1', 'First Song', 'Aurelia Vance', 215) },
    { uid: 'q2', track: track('t2', 'Second Song', 'Aurelia Vance', 65) },
    { uid: 'q3', track: track('t3', 'Third Song', 'Other Artist', 3725) },
  ];
  const clamp = (index: number) => Math.max(0, Math.min(items.length - 1, index));
  const queue = {
    items,
    length: items.length,
    state: { index: 0, shuffle: false, repeat: 'off' as 'off' | 'all' | 'one', cursor: 0 },
    setCursor: vi.fn((index: number) => {
      queue.state.cursor = clamp(index);
    }),
    moveCursor: vi.fn((delta: number) => {
      queue.state.cursor = clamp(queue.state.cursor + delta);
    }),
    removeAtCursor: vi.fn(() => 2),
    moveCursorItem: vi.fn(() => true),
    jumpToUid: vi.fn(() => 1),
    clear: vi.fn(),
    toggleShuffle: vi.fn(() => true),
  };
  const player = { play: vi.fn() };
  const settings = {
    state: { autoDj: false },
    toggle: vi.fn(() => {
      settings.state.autoDj = !settings.state.autoDj;
    }),
  };
  const toasts = { info: vi.fn() };
  // Takes an id so tests can drive it per track (mockImplementation).
  const resolver = { isCached: vi.fn((_id: string) => false) };
  const app = { keyboard, queue, player, settings, toasts, resolver };
  return { app, keyboard, queue, player, settings, toasts, resolver, items };
}

type Fakes = ReturnType<typeof buildFakes>;

function install(fakes: Fakes): Fakes {
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, fakes.app);
  return fakes;
}

function mount(): Fakes {
  const fakes = install(buildFakes());
  render(QueueOverlay);
  return fakes;
}

function bindingFor(fakes: Fakes, key: string) {
  const found = fakes.keyboard.bindings.find((b) => b.keys.includes(key));
  if (!found) throw new Error(`no binding for ${key}`);
  return found;
}

/** The row element that owns a track title. */
function rowFor(title: string): HTMLElement {
  return screen.getByText(title).parentElement as HTMLElement;
}

describe('QueueOverlay', () => {
  it('lists the queue with numbers, titles, artists and durations', async () => {
    mount();
    await tick();

    expect(screen.getByRole('dialog', { name: 'queue' })).toBeTruthy();
    expect(screen.getByText('First Song')).toBeTruthy();
    expect(screen.getByText('Third Song')).toBeTruthy();
    // Durations are formatted via formatDuration: 65 -> 1:05, 3725 -> 1:02:05.
    expect(screen.getByText('1:05')).toBeTruthy();
    expect(screen.getByText('1:02:05')).toBeTruthy();
  });

  it('summarises the queue position in the header note', async () => {
    mount();
    await tick();

    expect(screen.getByText('3 items · 1/3')).toBeTruthy();
  });

  it('marks the playing row with ▶ and the cursor row with ▸', async () => {
    mount();
    await tick();

    expect(rowFor('First Song').textContent).toContain('▶');
    expect(rowFor('Second Song').textContent).not.toContain('▸');
  });

  it('shows the empty state when there is nothing queued', async () => {
    const fakes = buildFakes();
    fakes.app.queue.items = [];
    fakes.app.queue.length = 0;
    fakes.app.queue.state.index = -1;
    install(fakes);
    render(QueueOverlay);
    await tick();

    expect(screen.getByText(/the queue is empty/)).toBeTruthy();
  });

  it('badges tracks that are already cached offline', async () => {
    const fakes = buildFakes();
    fakes.resolver.isCached.mockImplementation((id: string) => id === 't2');
    install(fakes);
    render(QueueOverlay);
    await tick();

    expect(rowFor('Second Song').textContent).toContain('▣');
    expect(rowFor('First Song').textContent).not.toContain('▣');
  });

  it('jumps to the cursor item and starts playback on Enter', async () => {
    const fakes = mount();
    await tick();

    bindingFor(fakes, 'enter').run();

    expect(fakes.queue.jumpToUid).toHaveBeenCalledWith('q1');
    expect(fakes.player.play).toHaveBeenCalled();
  });

  it('removes the item under the cursor with x and reports it', async () => {
    const fakes = mount();
    await tick();

    bindingFor(fakes, 'x').run();

    expect(fakes.queue.removeAtCursor).toHaveBeenCalled();
    expect(fakes.toasts.info).toHaveBeenCalledWith('removed 2 from the queue');
  });

  it('clears the queue with c', async () => {
    const fakes = mount();
    await tick();

    bindingFor(fakes, 'c').run();

    expect(fakes.queue.clear).toHaveBeenCalled();
    expect(fakes.toasts.info).toHaveBeenCalledWith('queue cleared');
  });

  it('toggles shuffle with s', async () => {
    const fakes = mount();
    await tick();

    bindingFor(fakes, 's').run();

    expect(fakes.queue.toggleShuffle).toHaveBeenCalled();
    expect(fakes.toasts.info).toHaveBeenCalledWith('shuffle on');
  });

  it('toggles auto-dj with d', async () => {
    const fakes = mount();
    await tick();

    bindingFor(fakes, 'd').run();

    expect(fakes.settings.toggle).toHaveBeenCalledWith('autoDj');
    expect(fakes.toasts.info).toHaveBeenCalledWith('auto-dj on');
  });

  it('unregisters its bindings when the overlay closes', async () => {
    const fakes = install(buildFakes());
    const baseline = fakes.keyboard.bindings.length;

    const view = render(QueueOverlay);
    await tick();
    expect(fakes.keyboard.bindings.length).toBeGreaterThan(baseline);

    view.unmount();
    expect(fakes.keyboard.bindings.length).toBe(baseline);
  });

  it('removes the highlighted row and moves the highlight with j, real queue store', async () => {
    // Regression guard for two coupled defects. First, the visible highlight
    // must follow `j`. Second, `x` must remove the row the highlight is on:
    // QueueList's visible cursor and the store's remove/reorder cursor used to be
    // two different things, so `x` deleted whichever row the store pointed at.
    // The hand-rolled mock above shares one cursor and cannot catch either, so
    // this drives a real QueueStore.
    const queue = new QueueStore({ persist: false });
    queue.set(
      [
        track('t1', 'First Song', 'Aurelia Vance', 215),
        track('t2', 'Second Song', 'Aurelia Vance', 65),
        track('t3', 'Third Song', 'Other Artist', 3725),
      ],
      0,
    );
    const fakes = buildFakes();
    fakes.app.queue = queue as unknown as (typeof fakes)['app']['queue'];
    install(fakes);
    render(QueueOverlay);
    await tick();

    bindingFor(fakes, 'j').run();
    await tick();
    expect(rowFor('Second Song').textContent).toContain('▸');
    expect(rowFor('First Song').textContent).not.toContain('▸');

    bindingFor(fakes, 'x').run();
    await tick();

    expect(queue.items.map((item) => item.track.id)).toEqual(['t1', 't3']);
  });
});
