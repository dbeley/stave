import { describe, it, expect, vi } from 'vitest';
import { HALF_PAGE_ROWS, ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
import type { Binding } from '$lib/keyboard/registry.svelte';

function makeCursor(count: number, index = 0): ListCursor {
  return new ListCursor({ index, count });
}

function byDescription(bindings: Binding[], description: string): Binding {
  const found = bindings.find((binding) => binding.description === description);
  if (!found) throw new Error(`no binding with description ${description}`);
  return found;
}

describe('ListCursor', () => {
  it('clamps the index when the count shrinks and never goes negative', () => {
    const cursor = makeCursor(10, 7);
    cursor.setCount(3);
    expect(cursor.index).toBe(2);
    cursor.setCount(0);
    expect(cursor.index).toBe(0);
    expect(cursor.count).toBe(0);
    cursor.setCount(-4);
    expect(cursor.count).toBe(0);
    expect(cursor.isEmpty).toBe(true);
  });

  it('move() clamps at both ends and does not wrap', () => {
    const cursor = makeCursor(5, 0);
    expect(cursor.move(-1)).toBe(0);
    expect(cursor.move(3)).toBe(3);
    expect(cursor.move(99)).toBe(4);
    expect(cursor.move(1)).toBe(4);
  });

  it('set() clamps into range', () => {
    const cursor = makeCursor(4, 0);
    cursor.set(2);
    expect(cursor.index).toBe(2);
    cursor.set(99);
    expect(cursor.index).toBe(3);
    cursor.set(-5);
    expect(cursor.index).toBe(0);
  });

  it('first()/last() jump to the ends', () => {
    const cursor = makeCursor(6, 3);
    cursor.first();
    expect(cursor.index).toBe(0);
    cursor.last();
    expect(cursor.index).toBe(5);
    const empty = makeCursor(0);
    empty.last();
    expect(empty.index).toBe(0);
  });

  it('page() moves by HALF_PAGE_ROWS, clamped, in either direction', () => {
    const cursor = makeCursor(100, 50);
    expect(cursor.page(1)).toBe(50 + HALF_PAGE_ROWS);
    expect(cursor.page(-1)).toBe(50);
    expect(cursor.page(1, 3)).toBe(53);
    expect(cursor.page(-1, 3)).toBe(50);
  });

  it('selected()/isSelected() read the item at the index', () => {
    const cursor = makeCursor(3, 1);
    expect(cursor.isSelected(1)).toBe(true);
    expect(cursor.isSelected(0)).toBe(false);
    expect(cursor.selected(['a', 'b', 'c'])).toBe('b');
    expect(makeCursor(0).selected(['a'])).toBeUndefined();
  });

  it('reset() returns to the first item', () => {
    const cursor = makeCursor(5, 4);
    cursor.reset();
    expect(cursor.index).toBe(0);
  });
});

describe('listNavigationBindings', () => {
  it('exposes the documented vim navigation set', () => {
    const bindings = listNavigationBindings(makeCursor(10));
    expect(bindings.map((binding) => binding.description)).toEqual([
      'move down',
      'move up',
      'first item',
      'last item',
      'half page down',
      'half page up',
    ]);
    expect(byDescription(bindings, 'move down').keys).toEqual(['j', 'down']);
    expect(byDescription(bindings, 'move up').keys).toEqual(['k', 'up']);
    expect(byDescription(bindings, 'first item').keys).toEqual(['g g', 'home']);
    expect(byDescription(bindings, 'last item').keys).toEqual(['G', 'end']);
    expect(byDescription(bindings, 'half page down').keys).toEqual(['ctrl+d', 'pagedown']);
    expect(byDescription(bindings, 'half page up').keys).toEqual(['ctrl+u', 'pageup']);
  });

  it('j and k move one row, clamped', () => {
    const cursor = makeCursor(3, 0);
    const bindings = listNavigationBindings(cursor);
    byDescription(bindings, 'move down').run();
    expect(cursor.index).toBe(1);
    byDescription(bindings, 'move down').run();
    byDescription(bindings, 'move down').run();
    expect(cursor.index).toBe(2);
    byDescription(bindings, 'move up').run();
    expect(cursor.index).toBe(1);
  });

  it('gg/home jump to the first item and G/end to the last', () => {
    const cursor = makeCursor(20, 5);
    const bindings = listNavigationBindings(cursor);
    byDescription(bindings, 'first item').run();
    expect(cursor.index).toBe(0);
    byDescription(bindings, 'last item').run();
    expect(cursor.index).toBe(19);
  });

  it('ctrl+d/ctrl+u page by HALF_PAGE_ROWS', () => {
    const cursor = makeCursor(100, 50);
    const bindings = listNavigationBindings(cursor);
    byDescription(bindings, 'half page down').run();
    expect(cursor.index).toBe(60);
    byDescription(bindings, 'half page up').run();
    expect(cursor.index).toBe(50);
  });

  it('adds enter only when onActivate is provided, and o only when onOpen is', () => {
    const withoutActions = listNavigationBindings(makeCursor(3));
    expect(withoutActions.some((binding) => binding.keys.includes('enter'))).toBe(false);
    expect(withoutActions.some((binding) => binding.keys.includes('o'))).toBe(false);

    const onActivate = vi.fn();
    const onOpen = vi.fn();
    const withActions = listNavigationBindings(makeCursor(3), { onActivate, onOpen });
    byDescription(withActions, 'open / play').run();
    expect(onActivate).toHaveBeenCalledTimes(1);
    byDescription(withActions, 'actions menu').run();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('appends extras and honours scope/group/hint options', () => {
    const extras: Binding[] = [
      { keys: ['s'], scope: 'queue', group: 'playback', description: 'shuffle', run: () => {} },
    ];
    const bindings = listNavigationBindings(makeCursor(3), {
      scope: 'queue',
      group: 'playback',
      hint: false,
      extras,
    });
    expect(bindings.at(-1)).toBe(extras[0]);
    expect(bindings.every((binding) => binding.scope === 'queue')).toBe(true);
    expect(bindings.every((binding) => binding.group === 'playback')).toBe(true);
    // Extras are passed through by identity (so they can be unregistered
    // again), which means their own `hint` shape is left alone.
    expect(
      bindings.every((binding) => binding.hint === undefined || typeof binding.hint === 'boolean'),
    ).toBe(true);
    expect(byDescription(bindings, 'move down').hint).toBe(false);
  });

  it('every run() returns void (never leaks a value)', () => {
    const cursor = makeCursor(5, 2);
    const bindings = listNavigationBindings(cursor, { onActivate: () => {}, onOpen: () => {} });
    for (const binding of bindings) {
      expect(binding.run()).toBeUndefined();
    }
  });
});
