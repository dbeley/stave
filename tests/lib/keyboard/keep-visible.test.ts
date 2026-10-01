import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import KeepVisible from './fixtures/KeepVisible.svelte';

/**
 * `j` used to walk the selection off the bottom of a long list while the list
 * itself stayed put: the overlays render their own rows, and each had forgotten
 * to scroll. This pins the behaviour once, for every list: the row the cursor is
 * on is the row that gets scrolled to.
 *
 * jsdom implements no scrolling, so `scrollIntoView` is stubbed. What is asserted
 * is *which element* was asked to scroll — `mock.instances` holds the receiver,
 * which is the element the method was called on (the arguments are just options).
 */
describe('keepCursorRowVisible', () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView as unknown as Element['scrollIntoView'];
  });

  it('scrolls the row the cursor is on', async () => {
    render(KeepVisible, { index: 0 });
    await tick();

    expect(scrollIntoView).toHaveBeenCalled();
    const asked = scrollIntoView.mock.instances.at(-1) as HTMLElement;
    expect(asked.dataset.row).toBe('0');
    expect(asked.className).toContain('selected');
  });

  it('follows the cursor when it moves', async () => {
    const { rerender } = render(KeepVisible, { index: 0 });
    await tick();
    scrollIntoView.mockClear();

    // Re-render with a new index, the way a page does when `j` moves the cursor.
    await rerender({ index: 2 });
    await tick();

    expect(scrollIntoView).toHaveBeenCalled();
    expect(scrollIntoView.mock.instances.at(-1)).toBe(document.querySelector('[data-row="2"]'));
  });
});
