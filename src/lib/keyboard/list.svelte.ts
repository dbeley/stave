/**
 * List navigation shared by every list page.
 *
 * A `ListCursor` holds the selection; `listNavigationBindings` turns it into the
 * standard vim key set. Pages compose these with their own action bindings, so
 * `j`/`k`/`gg`/`G`/`^d`/`^u` behave identically everywhere — which is the
 * point of a keyboard-first UI.
 */

import { moveIndex, scrollIntoViewIfNeeded } from '$lib/utils/dom';
import type { Binding, Scope } from './registry.svelte';

export const HALF_PAGE_ROWS = 10;

export class ListCursor {
  readonly state: { index: number; count: number };

  constructor(initial?: { index?: number; count?: number }) {
    this.state = $state<{ index: number; count: number }>({
      index: initial?.index ?? 0,
      count: initial?.count ?? 0,
    });
  }

  get index(): number {
    return this.state.index;
  }

  get count(): number {
    return this.state.count;
  }

  get isEmpty(): boolean {
    return this.state.count === 0;
  }

  /** Update the item count, keeping the selection in range. */
  setCount(count: number): void {
    this.state.count = Math.max(0, count);
    this.clamp();
  }

  set(index: number): void {
    this.state.index = moveIndex(index, 0, this.state.count, { wrap: false });
  }

  /** Move by delta, clamped (vim behaviour: no wrap at the ends). */
  move(delta: number): number {
    const next = moveIndex(this.state.index, delta, this.state.count, { wrap: false });
    this.state.index = next;
    return next;
  }

  first(): void {
    this.state.index = 0;
  }

  last(): void {
    this.state.index = Math.max(0, this.state.count - 1);
  }

  /** Half-page jumps; `direction` is +1 (down) or -1 (up). */
  page(direction: number, rows = HALF_PAGE_ROWS): number {
    return this.move(direction * rows);
  }

  /** The selected item, if any. */
  selected<T>(items: readonly T[]): T | undefined {
    // An empty cursor selects nothing, even when the caller passes a list.
    if (this.state.count <= 0) return undefined;
    return items[this.state.index];
  }

  isSelected(index: number): boolean {
    return this.state.index === index;
  }

  clamp(): void {
    this.state.index = moveIndex(this.state.index, 0, Math.max(this.state.count, 1), {
      wrap: false,
    });
  }

  reset(): void {
    this.state.index = 0;
  }
}

export interface ListBindingOptions {
  /** Enter — the primary action (open a page, play a track). */
  onActivate?: () => void;
  /** `o` — the secondary action (usually the action menu). */
  onOpen?: () => void;
  scope?: Scope;
  group?: string;
  /** Extra bindings merged in after the navigation ones. */
  extras?: Binding[];
  hint?: boolean;
}

/**
 * The standard list key set.
 *   j/k, ↓/↑   move            gg / G   first / last
 *   ^d/^u      half page       enter     activate
 */
/**
 * Keep the cursor's row inside its scrollport as the cursor moves.
 *
 * Every list taller than its container needs this. The overlay components render
 * their own rows instead of going through `ListView`, and each of them forgot it:
 * `j` walked the selection off the bottom edge while the list itself stayed put.
 * One implementation, so the next list cannot forget either.
 *
 * The row is found by `data-row` and falls back to `.row.selected` for lists that
 * do not tag their rows.
 */
export function keepCursorRowVisible(
  container: () => HTMLElement | null | undefined,
  index: () => number,
): void {
  $effect(() => {
    const target = index();
    const root = container();
    if (!root) return;
    const row =
      root.querySelector<HTMLElement>(`[data-row="${target}"]`) ??
      root.querySelector<HTMLElement>('.row.selected');
    scrollIntoViewIfNeeded(row);
  });
}

export function listNavigationBindings(
  cursor: ListCursor,
  options: ListBindingOptions = {},
): Binding[] {
  const scope = options.scope ?? 'page';
  const group = options.group ?? 'navigation';
  const base: Binding[] = [
    {
      keys: ['j', 'down'],
      scope,
      group,
      description: 'move down',
      hint: options.hint ?? true,
      run: () => {
        cursor.move(1);
      },
    },
    {
      keys: ['k', 'up'],
      scope,
      group,
      description: 'move up',
      hint: options.hint ?? true,
      run: () => {
        cursor.move(-1);
      },
    },
    {
      keys: ['g g', 'home'],
      scope,
      group,
      description: 'first item',
      run: () => {
        cursor.first();
      },
    },
    {
      keys: ['G', 'end'],
      scope,
      group,
      description: 'last item',
      run: () => {
        cursor.last();
      },
    },
    {
      keys: ['ctrl+d', 'pagedown'],
      scope,
      group,
      description: 'half page down',
      run: () => {
        cursor.page(1);
      },
    },
    {
      keys: ['ctrl+u', 'pageup'],
      scope,
      group,
      description: 'half page up',
      run: () => {
        cursor.page(-1);
      },
    },
  ];

  if (options.onActivate) {
    base.push({
      keys: ['enter'],
      scope,
      group,
      description: 'open / play',
      hint: options.hint ?? true,
      run: options.onActivate,
    });
  }
  if (options.onOpen) {
    base.push({
      keys: ['o'],
      scope,
      group,
      description: 'actions menu',
      hint: true,
      run: options.onOpen,
    });
  }

  return [...base, ...(options.extras ?? [])];
}
