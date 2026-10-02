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
 * or a `pointercancel`, aborts the press. Once fired, the next `click` is
 * swallowed (one-shot capture listener) so the long-press never also activates
 * the row underneath.
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
    clearTimer();
    startX = event.clientX;
    startY = event.clientY;
    tracking = true;
    timer = setTimeout(() => {
      timer = null;
      tracking = false;

      // A press that ends where it started still produces a `click`; catch it
      // in the capture phase before the row's own handler can run.
      clearSwallow();
      const swallow = (click: Event) => {
        click.preventDefault();
        click.stopPropagation();
        clearSwallow();
      };
      window.addEventListener('click', swallow, { capture: true });
      removeSwallow = () => window.removeEventListener('click', swallow, { capture: true });

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
  };

  node.addEventListener('pointerdown', onPointerDown);
  node.addEventListener('pointermove', onPointerMove);
  node.addEventListener('pointercancel', onPointerCancel);

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
