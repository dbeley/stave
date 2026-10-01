/** Small DOM helpers shared by the keyboard layer and list components. */

/** True when the event target is a text field the user is typing in. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  // Strict boolean: `isContentEditable` is undefined on plain elements in some
  // engines, and a truthy/falsy leak here would silently swallow shortcuts.
  return target.isContentEditable === true;
}

export function closestWithAttribute(
  target: EventTarget | null,
  attribute: string,
): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  return target.closest(`[${attribute}]`);
}

export function clamp(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(Math.max(value, min), max);
}

/** Keep an element visible inside its scroll container, one row of slack. */
export function scrollIntoViewIfNeeded(element: HTMLElement | null | undefined): void {
  if (!element) return;
  if (typeof element.scrollIntoView !== 'function') return;
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** Move a list selection by `delta`, wrapping only when asked to. */
export function moveIndex(
  index: number,
  delta: number,
  length: number,
  options: { wrap?: boolean } = {},
): number {
  if (length <= 0) return 0;
  if (options.wrap) {
    return (((index + delta) % length) + length) % length;
  }
  return clamp(index + delta, 0, length - 1);
}

export function prefersReducedMotion(): boolean {
  if (typeof globalThis.matchMedia !== 'function') return false;
  return globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** A stable, human-checkable unique id for queue entries and DOM keys. */
let seq = 0;
export function uniqueId(prefix = 'id'): string {
  seq += 1;
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${seq.toString(36)}${random}`;
}

/** The `#app` element, used for focus management. */
export function appRoot(): HTMLElement | null {
  return globalThis.document?.getElementById('app') ?? null;
}
