<!--
  Generic selectable list.
 *
 * Owns the things every list needs and no list should re-implement: the
 * reverse-video cursor, scrolling the selection into view, mouse clicks and
 * ARIA wiring. Pages supply the row rendering through a snippet.
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
  }

  let { items, cursor, row, keyOf, onActivate, ariaLabel, followTail = false }: Props = $props();

  let container: HTMLDivElement | undefined = $state();

  // Keep the cursor inside the (possibly shrunken) list.
  $effect(() => {
    cursor.setCount(items.length);
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
</style>
