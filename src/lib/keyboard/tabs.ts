import type { Binding } from '$lib/keyboard/registry.svelte';

export interface TabBindingOptions {
  /** Tab ids in display order. */
  ids: readonly string[];
  /** Returns the id currently shown. */
  active: () => string;
  /** Called with the id that should be shown next. */
  onSelect: (id: string) => void;
  /** Group the bindings appear under in the help overlay. */
  group?: string;
  /** Show the shortcuts in the hint bar. */
  hint?: boolean;
}

/**
 * `tab` / `shift+tab` move between tabs, wrapping at both ends.
 *
 * Every tabbed view goes through this so the shortcut cannot drift between pages.
 * It had drifted: the favourites sections answered to `tab` while the album sort
 * orders answered to `z`, for the same gesture.
 *
 * Pages spread the result into their single `registerAll` call rather than having
 * `TabStrip` register its own bindings — one call per page keeps the registration
 * list a single source of truth (and keeps the page tests, which capture that one
 * call, meaningful).
 */
export function tabBindings(options: TabBindingOptions): Binding[] {
  const step = (delta: number) => {
    const { ids } = options;
    if (ids.length === 0) return;
    const current = ids.indexOf(options.active());
    // Unknown or stale id: treat the first tab as the one we are leaving.
    const from = current === -1 ? 0 : current;
    const next = ids[(from + delta + ids.length) % ids.length];
    if (next !== undefined) options.onSelect(next);
  };

  return [
    {
      keys: ['tab'],
      scope: 'page',
      group: options.group ?? 'navigation',
      description: 'next tab',
      hint: options.hint ?? true,
      run: () => step(1),
    },
    {
      keys: ['shift+tab'],
      scope: 'page',
      group: options.group ?? 'navigation',
      description: 'previous tab',
      run: () => step(-1),
    },
  ];
}
