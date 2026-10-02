<!--
  Generic selectable list.

  Owns the things every list needs and no list should re-implement: the
  reverse-video cursor, scrolling the selection into view, mouse clicks and
  ARIA wiring. Pages supply the row rendering through a snippet.

  With `virtualise` set, only the rows near the viewport are rendered. A library
  with thousands of artists is the reason: 6000 rows in the DOM costs seconds on
  the first paint and again on every cursor move, while only ~40 can be seen at
  once. The list keeps its full height through two spacer elements, so scrolling
  and `scrollIntoView` behave exactly as they do without it.
-->
<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { keepCursorRowVisible, type ListCursor } from '$lib/keyboard/list.svelte';

  interface Props {
    items: T[];
    cursor: ListCursor;
    /** Row renderer: `{#snippet row(item, index, selected)}`. */
    row: Snippet<[T, number, boolean]>;
    /** Stable key for each row. */
    keyOf?: (item: T, index: number) => string | number;
    /** Click / Enter behaviour. */
    onActivate?: (item: T, index: number) => void;
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
    ariaLabel,
    followTail = false,
    virtualise = false,
    rowHeight = 22,
  }: Props = $props();

  let container: HTMLDivElement | undefined = $state();

  /**
   * Row height used by the window maths: starts as the caller's estimate and is
   * refined from the first rendered row, so a themed font size cannot make the
   * offset drift. Capturing the prop once is deliberate — it is an initial value,
   * not something to re-read.
   */
  // svelte-ignore state_referenced_locally
  let measuredHeight = $state(rowHeight);
  /** Rows kept rendered beyond each edge, so scrolling rarely shows a gap. */
  const OVERSCAN = 8;

  let viewportHeight = $state(0);
  let scrollTop = $state(0);

  /** The half-open range of indices to render. */
  let window = $derived.by(() => {
    if (!virtualise || items.length === 0) {
      return { start: 0, end: items.length };
    }
    // Always include the cursor: scrolling to it must not land on a row that is
    // not rendered yet, or `j` would move the selection to nothing.
    const visible = Math.ceil(viewportHeight / measuredHeight) + OVERSCAN * 2;
    const first = Math.floor(scrollTop / measuredHeight) - OVERSCAN;
    const start = Math.max(0, Math.min(first, Math.max(0, cursor.index - OVERSCAN)));
    const end = Math.min(items.length, Math.max(start + visible, cursor.index + OVERSCAN + 1));
    return { start: Math.max(0, Math.min(start, items.length)), end };
  });

  let startPad = $derived(window.start * measuredHeight);
  let endPad = $derived(Math.max(0, (items.length - window.end) * measuredHeight));

  // Keep the cursor inside the (possibly shrunken) list.
  $effect(() => {
    cursor.setCount(items.length);
  });

  // Track the scrollport so the window follows scrolling, and the real row height
  // so a themed font size does not make the estimate drift.
  $effect(() => {
    if (!container) return;
    const element = container;
    const read = () => {
      viewportHeight = element.clientHeight;
      scrollTop = element.scrollTop;
      const first = element.querySelector<HTMLElement>('.row');
      if (first && first.offsetHeight > 0) measuredHeight = first.offsetHeight;
    };
    read();
    element.addEventListener('scroll', read, { passive: true });
    // A resize can change how many rows fit; re-read rather than guess.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(read) : undefined;
    observer?.observe(element);
    return () => {
      element.removeEventListener('scroll', read);
      observer?.disconnect();
    };
  });

  // Scroll the selection into view whenever it moves.
  keepCursorRowVisible(
    () => container,
    () => (followTail ? items.length - 1 : cursor.index),
  );

  function activate(item: T, index: number): void {
    cursor.set(index);
    onActivate?.(item, index);
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
    {#each items.slice(window.start, window.end) as item, offset (keyOfItem(item, window.start + offset))}
      {@const index = window.start + offset}
      <div
        class="row"
        class:selected={cursor.isSelected(index)}
        role="option"
        aria-selected={cursor.isSelected(index)}
        tabindex="-1"
        data-row={index}
        onclick={() => activate(item, index)}
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
