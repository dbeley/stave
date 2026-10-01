import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';
import { ListCursor } from '$lib/keyboard/list.svelte';
import ListView from '$lib/components/ListView.svelte';

interface Item {
  id: string;
  title: string;
}

const items: Item[] = [
  { id: 'a', title: 'Alpha' },
  { id: 'b', title: 'Beta' },
  { id: 'c', title: 'Gamma' },
];

/**
 * The row is supplied by the page as a snippet. Tests build one with
 * `createRawSnippet` so `ListView` is exercised directly, without a host
 * component and without reaching into internal markup.
 */
const row = createRawSnippet<[Item, number, boolean]>((getItem, _getIndex, getSelected) => ({
  render: () => `<span>${getItem().title}${getSelected() ? ' *' : ''}</span>`,
}));

function renderList(
  overrides: {
    items?: Item[];
    ariaLabel?: string;
    onActivate?: (item: Item, index: number) => void;
    cursor?: ListCursor;
  } = {},
) {
  const cursor = overrides.cursor ?? new ListCursor({ index: 0, count: 0 });
  const onActivate = overrides.onActivate ?? vi.fn();
  // ListView is generic, so svelte-check infers `unknown` for its snippet and key
  // callbacks here; the harness erases the generic in one place rather than
  // sprinkling casts on each prop.
  render(ListView, {
    props: {
      items: overrides.items ?? items,
      cursor,
      row: row as never,
      keyOf: (item: Item) => item.id,
      onActivate,
      ariaLabel: overrides.ariaLabel ?? 'tracks',
    } as never,
  });
  return { cursor, onActivate };
}

function options(): HTMLElement[] {
  return screen.getAllByRole('option');
}

describe('ListView', () => {
  it('renders a labelled listbox with one option per item', () => {
    renderList();

    const listbox = screen.getByRole('listbox', { name: 'tracks' });
    expect(listbox).toBeTruthy();

    const rows = options();
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('Alpha'),
      expect.stringContaining('Beta'),
      expect.stringContaining('Gamma'),
    ]);
  });

  it('marks the cursor row as selected and exposes it via aria-selected', () => {
    renderList();

    const rows = options();
    expect(rows[0]!.getAttribute('aria-selected')).toBe('true');
    expect(rows[1]!.getAttribute('aria-selected')).toBe('false');
    expect(rows[0]!.classList.contains('selected')).toBe(true);
    expect(rows[1]!.classList.contains('selected')).toBe(false);

    // The cursor marker ('▸') only shows on the selected row.
    expect(rows[0]!.textContent).toContain('▸');
    expect(rows[1]!.textContent).not.toContain('▸');
  });

  it('stamps each row with its index via data-row', () => {
    renderList();

    expect(options().map((r) => r.getAttribute('data-row'))).toEqual(['0', '1', '2']);
  });

  it('keeps the cursor count in sync with the items', async () => {
    const { cursor } = renderList();

    await tick();
    expect(cursor.count).toBe(3);
  });

  it('activates the clicked item and moves the cursor onto it', async () => {
    const { cursor, onActivate } = renderList();

    await fireEvent.click(options()[1]!);

    expect(onActivate).toHaveBeenCalledWith(items[1], 1);
    expect(cursor.index).toBe(1);
  });

  it('activates the focused row on Enter', async () => {
    const { cursor, onActivate } = renderList();

    await fireEvent.keyDown(options()[2]!, { key: 'Enter' });

    expect(onActivate).toHaveBeenCalledWith(items[2], 2);
    expect(cursor.index).toBe(2);
  });

  it('ignores keys other than Enter', async () => {
    const { onActivate } = renderList();

    await fireEvent.keyDown(options()[0]!, { key: 'x' });

    expect(onActivate).not.toHaveBeenCalled();
  });

  it('renders an empty listbox (no options) when there is nothing to show', () => {
    renderList({ items: [] });

    expect(screen.getByRole('listbox', { name: 'tracks' })).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});
