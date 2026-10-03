/**
 * Touch gestures shared by the list/queue components: a reusable `longPress`
 * Svelte action and the pure `dropIndex` helper for drag reordering.
 */

export interface LongPressParams {
  onLongPress: () => void;
  /** Hold duration in ms before firing. Defaults to 500. */
  delay?: number;
  /** Movement in px (either axis) that cancels the press. Defaults to 10. */
  slop?: number;
}

export interface LongPressAction {
  update(params: LongPressParams): void;
  destroy(): void;
}

const DEFAULT_DELAY = 500;
const DEFAULT_SLOP = 10;

/**
 * Svelte action: fire `onLongPress` after a touch/pen pointer is held still for
 * `delay` ms. Mouse pointers are ignored. Movement past `slop` in either axis,
 * or a `pointercancel`, aborts the press. Presses that start on an interactive
 * child (a button, link, input, …) are ignored — that child owns the pointer.
 * Once fired, the next `click` (and `contextmenu`, which Android emits instead
 * of a click) is swallowed one-shot, so the long-press never also activates the
 * row underneath and the native selection menu never appears.
 */
export function longPress(node: HTMLElement, params: LongPressParams): LongPressAction {
  let current = params;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let removeSwallow: (() => void) | null = null;

  const clearTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    tracking = false;
  };

  const clearSwallow = () => {
    if (removeSwallow) {
      removeSwallow();
      removeSwallow = null;
    }
  };

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    // A press that starts on an interactive child (a drag handle, a row's
    // inline button) must not open the action menu: the child owns that
    // pointer. Svelte delegates `pointerdown`, so the action's own listener
    // fires before the child's and would otherwise win the race.
    const target = event.target;
    if (
      target instanceof Element &&
      target.closest('button, a, input, select, textarea, [role="button"]')
    ) {
      return;
    }
    clearTimer();
    startX = event.clientX;
    startY = event.clientY;
    tracking = true;
    timer = setTimeout(() => {
      timer = null;
      tracking = false;

      // A press that ends where it started still produces a `click`; catch it
      // in the capture phase before the row's own handler can run. Android's
      // long-press often emits a `contextmenu` and *no* click, so that is
      // swallowed too (and disarms the pending swallow) — otherwise the native
      // text-selection menu shows on the held row and the click swallow lingers
      // to eat the next tap.
      clearSwallow();
      const swallow = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        clearSwallow();
      };
      window.addEventListener('click', swallow, { capture: true });
      window.addEventListener('contextmenu', swallow, { capture: true });
      removeSwallow = () => {
        window.removeEventListener('click', swallow, { capture: true });
        window.removeEventListener('contextmenu', swallow, { capture: true });
      };

      current.onLongPress();
    }, current.delay ?? DEFAULT_DELAY);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!tracking) return;
    const slop = current.slop ?? DEFAULT_SLOP;
    if (Math.abs(event.clientX - startX) > slop || Math.abs(event.clientY - startY) > slop) {
      clearTimer();
    }
  };

  const onPointerCancel = () => {
    clearTimer();
    // If the browser cancels the pointer after a press already fired (a system
    // gesture), drop the swallow so it cannot eat an unrelated later tap.
    clearSwallow();
  };

  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerType === 'mouse') return;
    clearTimer();
  };

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointercancel', onPointerCancel);
  node.addEventListener('pointerup', onPointerUp);

  return {
    update(next: LongPressParams) {
      current = next;
    },
    destroy() {
      clearTimer();
      clearSwallow();
      node.removeEventListener('pointerdown', onPointerDown);
      node.removeEventListener('pointermove', onPointerMove);
      node.removeEventListener('pointercancel', onPointerCancel);
      node.removeEventListener('pointerup', onPointerUp);
    },
  };
}

/**
 * The row index a drag at vertical position `clientY` should drop into, using
 * the nearest row center. Clamped to the list bounds; an empty list yields 0.
 */
export function dropIndex(clientY: number, rects: { top: number; bottom: number }[]): number {
  if (rects.length === 0) return 0;

  let nearest = 0;
  let nearestDistance = Infinity;
  for (const [index, rect] of rects.entries()) {
    const center = (rect.top + rect.bottom) / 2;
    const distance = Math.abs(clientY - center);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = index;
    }
  }
  return nearest;
}
