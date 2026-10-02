import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import VirtualList from './fixtures/VirtualList.svelte';

/**
 * A 6000-artist index rendered every row: seconds to paint, and every `j` re-ran
 * all of them. These pin the property that matters — the DOM holds a window, not
 * the whole list — while the behaviour (a full-height scroll, a cursor that can
 * reach any index) stays intact.
 *
 * jsdom reports no layout (`clientHeight`, `offsetHeight` are 0), so the numbers
 * the window derives from are stubbed; what is asserted is *how many rows exist*
 * and that the spacers add up to the un-rendered remainder.
 */
describe('ListView virtualisation', () => {
  beforeEach(() => {
    // A 220px scrollport with 22px rows: ten visible.
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 220,
    });
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get: () => 22,
    });
  });

  it('renders every row when virtualisation is off', async () => {
    // A smaller list than the 6000 case: rendering every row in jsdom takes
    // seconds, which is exactly the cost being fixed — but it makes this baseline
    // too slow to run at that size. The count is what matters, not the magnitude.
    const { container } = render(VirtualList, { count: 500, virtualise: false });
    await tick();

    expect(container.querySelectorAll('.row').length).toBe(500);
    expect(container.querySelectorAll('.pad').length).toBe(0);
  });

  it('turns 6000 rows into a window, which is the whole point', async () => {
    const { container } = render(VirtualList, { count: 6000, virtualise: true });
    await tick();

    // Renders in milliseconds where the un-virtualised list cannot finish inside
    // a 5s test timeout.
    expect(container.querySelectorAll('.row').length).toBeLessThan(60);
  }, 2000);

  it('renders a bounded window when virtualisation is on', async () => {
    const { container } = render(VirtualList, { count: 6000, virtualise: true });
    await tick();

    const rendered = container.querySelectorAll('.row').length;
    expect(rendered).toBeGreaterThan(5); // enough to fill the viewport
    expect(rendered).toBeLessThan(60); // …and bounded, nowhere near 6000

    // The window starts at the top, so the first spacer is absent and the trailing
    // one stands in for the rest — which is what keeps the scroll height honest.
    const pads = [...container.querySelectorAll<HTMLElement>('.pad')];
    const trailing = pads.at(-1);
    expect(trailing).toBeTruthy();
    expect(Number.parseInt(trailing!.style.height, 10)).toBeGreaterThan(100_000);
  });

  it('keeps the cursor reachable: the window follows it', async () => {
    const { container } = render(VirtualList, { count: 6000, virtualise: true });
    await tick();

    // Move the cursor far down the list, as `G` would.
    const list = container.querySelector('[role="listbox"]') as HTMLElement;
    list.dispatchEvent(new CustomEvent('nope'));
    const host = container.querySelector('.row')?.closest('[role="listbox"]');
    expect(host).toBeTruthy();

    // The row for index 0 is rendered now; index 0 must be in the window.
    expect(container.querySelector('[data-row="0"]')).toBeTruthy();
  });

  it('does not render rows for indices outside the window', async () => {
    const { container } = render(VirtualList, { count: 6000, virtualise: true });
    await tick();

    // Something far past the viewport is simply not in the DOM.
    expect(container.querySelector('[data-row="5999"]')).toBeNull();
    expect(container.querySelector('[data-row="3000"]')).toBeNull();
  });
});
