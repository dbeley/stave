import { describe, it, expect, vi, afterEach } from 'vitest';
import { longPress, dropIndex } from '$lib/utils/press';
import type { LongPressParams } from '$lib/utils/press';

/**
 * jsdom has no `PointerEvent`. A `MouseEvent` carrying `clientX`/`clientY`
 * reaches the action's pointer listeners; `pointerType` is attached with
 * `Object.defineProperty` so the action's touch/pen guard can read it.
 * Mirrors the workaround documented in `tests/lib/components/SeekBar.test.ts`.
 */
function pointer(
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  options: { pointerType?: string; clientX?: number; clientY?: number } = {},
): MouseEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
  });
  Object.defineProperty(event, 'pointerType', { value: options.pointerType ?? 'touch' });
  return event;
}

function mountLongPress(params: LongPressParams) {
  const node = document.createElement('div');
  document.body.appendChild(node);
  const action = longPress(node, params);
  return { node, action };
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('longPress', () => {
  it('fires after the delay on a touch pointer', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { node, action } = mountLongPress({ onLongPress });

    node.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    vi.advanceTimersByTime(499);
    expect(onLongPress).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    action.destroy();
  });

  it('cancels when the pointer moves past the slop', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { node, action } = mountLongPress({ onLongPress });

    node.dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 100 }));
    node.dispatchEvent(pointer('pointermove', { clientX: 130, clientY: 100 }));
    vi.advanceTimersByTime(500);
    expect(onLongPress).not.toHaveBeenCalled();

    action.destroy();
  });

  it('ignores mouse pointers', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { node, action } = mountLongPress({ onLongPress });

    node.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse' }));
    vi.advanceTimersByTime(500);
    expect(onLongPress).not.toHaveBeenCalled();

    action.destroy();
  });

  it('does not fire when the press starts on an interactive child', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { node, action } = mountLongPress({ onLongPress });

    const button = document.createElement('button');
    node.appendChild(button);

    button.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    vi.advanceTimersByTime(500);
    expect(onLongPress).not.toHaveBeenCalled();

    action.destroy();
  });

  it('swallows the click that follows a fired long-press', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { node, action } = mountLongPress({ onLongPress });

    node.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    node.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);

    // One-shot: the swallow must not linger to block later taps.
    const next = new MouseEvent('click', { bubbles: true, cancelable: true });
    node.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(false);

    action.destroy();
  });

  it('cancels on pointercancel', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { node, action } = mountLongPress({ onLongPress });

    node.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    node.dispatchEvent(pointer('pointercancel', { pointerType: 'touch' }));
    vi.advanceTimersByTime(500);
    expect(onLongPress).not.toHaveBeenCalled();

    action.destroy();
  });

  it('does not fire when the pointer is released before the delay', async () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { node, action } = mountLongPress({ onLongPress });

    node.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    node.dispatchEvent(pointer('pointerup', { pointerType: 'touch' }));
    await vi.advanceTimersByTimeAsync(600);
    expect(onLongPress).not.toHaveBeenCalled();

    action.destroy();
  });

  it('does not cancel an already-fired press when the pointer is released', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { node, action } = mountLongPress({ onLongPress });

    node.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    node.dispatchEvent(pointer('pointerup', { pointerType: 'touch' }));

    // The swallow for the click that follows a fired press is still armed.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    node.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);

    action.destroy();
  });

  it('swallows a contextmenu that follows a fired press instead of a click', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { node, action } = mountLongPress({ onLongPress });

    node.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    // Android long-press: a contextmenu, no click. It is swallowed (so the
    // native menu never shows) and disarms the pending click swallow.
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    node.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);

    // A later, unrelated tap must not be eaten by the lingering swallow.
    const later = new MouseEvent('click', { bubbles: true, cancelable: true });
    node.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);

    action.destroy();
  });

  it('disarms the swallow when the pointer is cancelled after firing', () => {
    vi.useFakeTimers();
    const onLongPress = vi.fn();
    const { node, action } = mountLongPress({ onLongPress });

    node.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    vi.advanceTimersByTime(500);
    expect(onLongPress).toHaveBeenCalledTimes(1);

    node.dispatchEvent(pointer('pointercancel', { pointerType: 'touch' }));

    const later = new MouseEvent('click', { bubbles: true, cancelable: true });
    node.dispatchEvent(later);
    expect(later.defaultPrevented).toBe(false);

    action.destroy();
  });
});

describe('dropIndex', () => {
  it('returns the nearest row index for a drag position', () => {
    const rects = [
      { top: 0, bottom: 20 },
      { top: 20, bottom: 40 },
      { top: 40, bottom: 60 },
    ];

    expect(dropIndex(45, rects)).toBe(2);
  });

  it('clamps outside the list and handles an empty list', () => {
    const rects = [
      { top: 0, bottom: 20 },
      { top: 20, bottom: 40 },
      { top: 40, bottom: 60 },
    ];

    expect(dropIndex(-50, rects)).toBe(0);
    expect(dropIndex(999, rects)).toBe(2);
    expect(dropIndex(10, [])).toBe(0);
  });
});
