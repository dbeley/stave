<!--
  Generic selectable list.

  Owns the things every list needs and no list should re-implement: the
  reverse-video cursor, scrolling the selection into view, mouse clicks and
  ARIA wiring. Pages supply the row rendering through a snippet.

  With `virtualise` set, only the rows near the viewport are rendered. A library
  with thousands of artists is the reason: 6000 rows in the DOM costs seconds on
  the first paint and again on every cursor move, while only ~40 can be seen at
  once. The list keeps its full height through two spacer elements, so scrolling
  behaves exactly as it does without it.

  Three things make this work, and each was wrong at first:

  - The scrollport is usually an *ancestor* (the panel body), not the list. Read
    the visible band from rectangles, never from the list's own `clientHeight`: a
    list that does not scroll is as tall as its content, so it reports a viewport
    of 6000 rows and the mechanism disables itself.
  - A cursor far outside the rendered band must *scroll* there, not widen the band
    to reach it. The first version grew the window to cover the cursor, so `G`
    built every row between the top and the bottom: 5901 rows, ~450ms per `j`.
  - The row height is the *median* of the rendered rows, not the first one. An
    artists list puts a letter heading above each group, and a window beginning on
    those (shorter) rows took ~9px as the scale for all 6000.
-->
<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import type { ListCursor } from '$lib/keyboard/list.svelte';
  import { scrollIntoViewIfNeeded } from '$lib/utils/dom';
  import { longPress } from '$lib/utils/press';

  interface Props {
    items: T[];
    cursor: ListCursor;
    /** Row renderer: `{#snippet row(item, index, selected)}`. */
    row: Snippet<[T, number, boolean]>;
    /** Stable key for each row. */
    keyOf?: (item: T, index: number) => string | number;
    /** Click / Enter behaviour. */
    onActivate?: (item: T, index: number) => void;
    /** Touch long-press behaviour (fires only on touch, per `press.ts`). */
    onLongPress?: (item: T, index: number) => void;
    ariaLabel?: string;
    /** Keep the last item visible when new ones append. */
    followTail?: boolean;
    /**
     * Render only the rows near the viewport. Worth it past a few hundred items;
     * below that the bookkeeping costs more than it saves.
     */
    virtualise?: boolean;
    /** Assumed row height in px, before measurement. */
    rowHeight?: number;
  }

  let {
    items,
    cursor,
    row,
    keyOf,
    onActivate,
    onLongPress,
    ariaLabel,
    followTail = false,
    virtualise = false,
    rowHeight = 22,
  }: Props = $props();

  let container: HTMLDivElement | undefined = $state();

  /**
   * Row height used by the window maths: starts as the caller's estimate and is
   * refined from the rendered rows, so a themed font size cannot make the offset
   * drift. Capturing the prop once is deliberate — it is an initial value, not
   * something to re-read.
   */
  // svelte-ignore state_referenced_locally
  let measuredHeight = $state(rowHeight);
  /** Rows kept rendered beyond each edge, so scrolling rarely shows a gap. */
  const OVERSCAN = 8;

  let viewportHeight = $state(0);
  /** How far the list has scrolled past the top of its scrollport. */
  let scrollTop = $state(0);
  let scrollport = $state<HTMLElement | null>(null);

  /**
   * The nearest ancestor that actually scrolls, or null when the page does.
   * `overflow: hidden` is not a scrollport, and neither is the default.
   */
  function findScrollport(element: HTMLElement): HTMLElement | null {
    let node = element.parentElement;
    while (node) {
      const overflowY = getComputedStyle(node).overflowY;
      if (overflowY === 'auto' || overflowY === 'scroll') return node;
      node = node.parentElement;
    }
    return null;
  }

  /** The half-open range of indices to render, from the scroll position alone. */
  let range = $derived.by(() => {
    if (!virtualise || items.length === 0) {
      return { start: 0, end: items.length };
    }
    const height = Math.max(1, measuredHeight);
    const visible = Math.max(1, Math.ceil(viewportHeight / height)) + OVERSCAN * 2;
    const start = Math.max(0, Math.min(Math.floor(scrollTop / height) - OVERSCAN, items.length));
    const end = Math.min(items.length, start + visible);
    return { start, end };
  });

  let startPad = $derived(range.start * measuredHeight);
  let endPad = $derived(Math.max(0, (items.length - range.end) * measuredHeight));

  // Keep the cursor inside the (possibly shrunken) list.
  $effect(() => {
    cursor.setCount(items.length);
  });

  // Track the scrollport so the window follows scrolling, and the real row height
  // so a themed font size does not make the estimate drift.
  $effect(() => {
    if (!container) return;
    const element = container;
    const port = findScrollport(element);
    scrollport = port;
    const read = () => {
      const listTop = element.getBoundingClientRect().top;
      if (port) {
        viewportHeight = port.clientHeight;
        // Measured, not read from `scrollTop`: the list can sit below a header
        // inside the same scrollport.
        scrollTop = Math.max(0, port.getBoundingClientRect().top - listTop);
      } else {
        viewportHeight = window.innerHeight;
        scrollTop = Math.max(0, -listTop);
      }
      /*
       * Median, not the first row: a list that groups (an artists page puts a
       * heading above each letter) would otherwise take a heading's height as the
       * scale for every row.
       */
      const heights: number[] = [];
      for (const node of element.querySelectorAll<HTMLElement>('.row')) {
        if (node.offsetHeight > 0) heights.push(node.offsetHeight);
      }
      if (heights.length > 0) {
        heights.sort((a, b) => a - b);
        const middle = heights[Math.floor(heights.length / 2)];
        if (middle !== undefined) measuredHeight = middle;
      }
    };
    read();
    // Any scroll may move the band over this list, so listen in the capture phase
    // rather than guessing which ancestor scrolls.
    document.addEventListener('scroll', read, { capture: true, passive: true });
    window.addEventListener('resize', read);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : undefined;
    observer?.observe(element);
    if (port) observer?.observe(port);
    return () => {
      document.removeEventListener('scroll', read, { capture: true });
      window.removeEventListener('resize', read);
      observer?.disconnect();
    };
  });

  /** Move the scrollport so the list's own offset becomes `offset`. */
  function scrollListTo(offset: number): void {
    const target = Math.max(0, offset);
    if (scrollport) {
      // Relative: keeps any content above the list out of the arithmetic.
      scrollport.scrollTop += target - scrollTop;
    } else {
      scrollIntoViewIfNeeded(container);
    }
    scrollTop = target;
  }

  /**
   * Bring the cursor's row into view as the cursor moves.
   *
   * Two mechanisms, because a virtualised row outside the window does not exist:
   * `scrollIntoView` cannot scroll to a row that has not been rendered, so there
   * the scrollport is moved by arithmetic — which is what makes the row exist, the
   * reverse of the usual order. Non-virtualised lists keep every row in the DOM
   * and use the ordinary scroll-into-view.
   */
  $effect(() => {
    const target = followTail ? items.length - 1 : cursor.index;
    if (!container || items.length === 0) return;
    if (!virtualise) {
      const found =
        container.querySelector<HTMLElement>(`[data-row="${target}"]`) ??
        container.querySelector<HTMLElement>('.row.selected');
      scrollIntoViewIfNeeded(found);
      return;
    }
    const top = target * measuredHeight;
    const bottom = top + measuredHeight;
    if (top < scrollTop) {
      scrollListTo(top);
    } else if (bottom > scrollTop + viewportHeight) {
      scrollListTo(bottom - Math.max(viewportHeight, measuredHeight));
    }
  });

  function activate(item: T, index: number): void {
    cursor.set(index);
    onActivate?.(item, index);
  }

  /** Long-press: move the cursor onto the row first, then open its actions. */
  function longPressRow(item: T, index: number): void {
    cursor.set(index);
    onLongPress?.(item, index);
  }

  function keyOfItem(item: T, index: number): string | number {
    return keyOf ? keyOf(item, index) : index;
  }
</script>

<div class="list" role="listbox" aria-label={ariaLabel} tabindex="-1" bind:this={container}>
  {#if virtualise}
    <!-- Spacers preserve the scroll height of the rows that are not rendered. -->
    {#if startPad > 0}
      <div class="pad" style="height: {startPad}px" aria-hidden="true"></div>
    {/if}
    {#each items.slice(range.start, range.end) as item, offset (keyOfItem(item, range.start + offset))}
      {@const index = range.start + offset}
      <div
        class="row"
        class:selected={cursor.isSelected(index)}
        role="option"
        aria-selected={cursor.isSelected(index)}
        tabindex="-1"
        data-row={index}
        onclick={() => activate(item, index)}
        use:longPress={{ onLongPress: () => longPressRow(item, index) }}
        onkeydown={(event) => {
          if (event.key === 'Enter') activate(item, index);
        }}
      >
        <span class="marker" aria-hidden="true">{cursor.isSelected(index) ? '▸' : ' '}</span>
        <div class="content">{@render row(item, index, cursor.isSelected(index))}</div>
      </div>
    {/each}
    {#if endPad > 0}
      <div class="pad" style="height: {endPad}px" aria-hidden="true"></div>
    {/if}
  {:else}
    {#each items as item, index (keyOfItem(item, index))}
      <div
        class="row"
        class:selected={cursor.isSelected(index)}
        role="option"
        aria-selected={cursor.isSelected(index)}
        tabindex="-1"
        data-row={index}
        onclick={() => activate(item, index)}
        use:longPress={{ onLongPress: () => longPressRow(item, index) }}
        onkeydown={(event) => {
          if (event.key === 'Enter') activate(item, index);
        }}
      >
        <span class="marker" aria-hidden="true">{cursor.isSelected(index) ? '▸' : ' '}</span>
        <div class="content">{@render row(item, index, cursor.isSelected(index))}</div>
      </div>
    {/each}
  {/if}
</div>

<style>
  .list {
    display: flex;
    flex-direction: column;
    outline: none;
  }
  .row {
    display: flex;
    gap: 0.25em;
    align-items: baseline;
    padding: 0 0.2em;
    cursor: pointer;
    border-left: 2px solid transparent;
  }
  .row.selected {
    background: var(--accent);
    color: var(--bg);
    border-left-color: var(--accent);
  }
  .row.selected :global(.dim) {
    color: var(--bg);
    opacity: 0.75;
  }
  .row.selected :global(.badge) {
    border-color: var(--bg);
    color: var(--bg);
  }
  .marker {
    flex: none;
    width: 1em;
    color: inherit;
    opacity: 0.8;
  }
  .content {
    flex: 1;
    min-width: 0;
  }
  .pad {
    flex: none;
  }
</style>
