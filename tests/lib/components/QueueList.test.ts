import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Track } from '$lib/domain/types';

/**
 * The queue list's touch affordances: an inline remove button, long-press for
 * the track action menu, and a drag handle that reorders. `QueueList` is shared
 * by the queue overlay and the now-playing page, so these are exercised on the
 * component directly (the overlay harness tests binding wiring, not touch).
 *
 * jsdom has no `PointerEvent`; a `MouseEvent` carrying a `pointerType` read
 * through `Object.defineProperty` reaches the pointer handlers, and the drag
 * target is driven through per-row `getBoundingClientRect` spies.
 */

const mocks = vi.hoisted(() => ({
  app: {} as Record<string, any>,
  actions: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: mocks.app, App: class {} }));
vi.mock('$lib/ui/actionsRegistry.svelte', () => ({ actions: mocks.actions }));

import QueueList from '$lib/components/QueueList.svelte';

function track(id: string, title: string, artistName: string, durationSec: number): Track {
  return { id, title, artistName, durationSec, starred: false };
}

function buildFakes() {
  const items = [
    { uid: 'q1', track: track('t1', 'First Song', 'Aurelia Vance', 215) },
    { uid: 'q2', track: track('t2', 'Second Song', 'Aurelia Vance', 65) },
    { uid: 'q3', track: track('t3', 'Third Song', 'Other Artist', 3725) },
  ];
  const queue = {
    items,
    length: items.length,
    state: { index: 0, shuffle: false, repeat: 'off' as 'off' | 'all' | 'one', cursor: 0 },
    move: vi.fn(),
    remove: vi.fn(),
    setCursor: vi.fn(),
    moveCursor: vi.fn(),
    jumpToUid: vi.fn(),
    removeAtCursor: vi.fn(),
    moveCursorItem: vi.fn(),
    clear: vi.fn(),
    toggleShuffle: vi.fn(),
  };
  const player = { play: vi.fn() };
  const keyboard = { registerAll: vi.fn(() => () => {}) };
  const resolver = { isCached: vi.fn((_id: string) => false) };
  const toasts = { info: vi.fn() };
  const settings = { state: { autoDj: false }, toggle: vi.fn() };
  const app = { queue, player, keyboard, resolver, toasts, settings };
  return { app, queue, player, keyboard, resolver, toasts, settings, items };
}

type Fakes = ReturnType<typeof buildFakes>;

function install(fakes: Fakes): Fakes {
  for (const key of Object.keys(mocks.app)) delete mocks.app[key];
  Object.assign(mocks.app, fakes.app);
  for (const key of Object.keys(mocks.actions)) delete mocks.actions[key];
  Object.assign(mocks.actions, { openTrackActions: vi.fn() });
  return fakes;
}

function mount(): Fakes {
  const fakes = install(buildFakes());
  render(QueueList);
  return fakes;
}

/** A `DOMRect`-shaped value the drag logic reads (`top`/`bottom`). */
function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/** A `MouseEvent` carrying the `pointerType` the pointer handlers read. */
function pointer(type: string, clientY = 0): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY });
  Object.defineProperty(event, 'pointerType', { value: 'touch' });
  return event;
}

describe('QueueList', () => {
  it('removes a row from its remove button', async () => {
    const fakes = mount();
    await tick();

    await fireEvent.click(screen.getByRole('button', { name: 'remove First Song' }));

    expect(fakes.queue.remove).toHaveBeenCalledWith(['q1']);
    // The remove button must not also trigger the row's click-to-play.
    expect(fakes.player.play).not.toHaveBeenCalled();
  });

  it('long-presses a row to open track actions', async () => {
    vi.useFakeTimers();
    const fakes = mount();
    await tick();

    const row = screen.getByText('Second Song').parentElement as HTMLElement;
    row.dispatchEvent(pointer('pointerdown'));
    await vi.advanceTimersByTimeAsync(500);

    expect(mocks.actions.openTrackActions).toHaveBeenCalledWith(fakes.items[1]!.track);
  });

  it('reorders via a drag handle drop', async () => {
    const fakes = mount();
    await tick();

    // jsdom does not lay out rows, so give each one a distinct geometry for the
    // nearest-row drop calculation (row 0: 0–20, row 1: 20–40, row 2: 40–60).
    screen.getAllByRole('option').forEach((row, index) => {
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue(rect(index * 20, (index + 1) * 20));
    });

    const handle = screen.getByRole('button', { name: 'reorder First Song' });
    handle.dispatchEvent(pointer('pointerdown', 10));
    handle.dispatchEvent(pointer('pointermove', 45));
    handle.dispatchEvent(pointer('pointerup', 45));

    expect(fakes.queue.move).toHaveBeenCalledWith(0, 2);
  });
});
