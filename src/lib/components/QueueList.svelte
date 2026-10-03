<!--
  The queue as a list: what is playing, what is next, and direct manipulation.
  Reorder with J/K, remove with x, jump with Enter — keyboard-first, and each row
  is a tap target.

  Shared by the queue overlay (`Q`) and the now-playing page, so the two cannot
  drift apart in either binding or rendering.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import {
    ListCursor,
    keepCursorRowVisible,
    listNavigationBindings,
  } from '$lib/keyboard/list.svelte';
  import { formatDuration, truncate } from '$lib/utils/format';
  import { longPress, dropIndex } from '$lib/utils/press';
  import { actions } from '$lib/ui/actionsRegistry.svelte';
  import type { Scope } from '$lib/keyboard/registry.svelte';
  import type { QueueStore } from '$lib/stores/queue.svelte';

  /**
   * A list cursor that *is* the queue store's own cursor.
   *
   * The row you highlight, the row `enter` plays and the row `x`/`J`/`K` act on
   * are then the same by construction. Before this, QueueList kept a private
   * `ListCursor` for the highlight while the store kept a second cursor for
   * remove/reorder; they silently drifted, so `x` deleted whichever row the
   * store happened to point at (often the playing or last one) rather than the
   * row on screen. Delegating every mutation to the store leaves exactly one
   * cursor to keep in sync — and none to forget.
   */
  class QueueCursor extends ListCursor {
    private readonly queue: QueueStore;
    constructor(queue: QueueStore) {
      super();
      this.queue = queue;
    }
    override get index(): number {
      return this.queue.state.cursor;
    }
    override get count(): number {
      return this.queue.length;
    }
    override set(index: number): void {
      this.queue.setCursor(index);
    }
    override move(delta: number): number {
      this.queue.moveCursor(delta);
      return this.queue.state.cursor;
    }
    override first(): void {
      this.queue.setCursor(0);
    }
    override last(): void {
      this.queue.setCursor(this.queue.length - 1);
    }
    override isSelected(index: number): boolean {
      return this.queue.state.cursor === index;
    }
  }

  interface Props {
    /** `overlay` inside the queue window, `page` when it is the page's content. */
    scope?: Scope;
    /** Include the bindings in the always-visible hint bar. */
    hint?: boolean;
    /** Shown when the queue is empty. */
    emptyMessage?: string;
  }

  let {
    scope = 'overlay',
    hint = false,
    emptyMessage = 'the queue is empty — press enter on an album or track',
  }: Props = $props();

  let cursor = new QueueCursor(app.queue);
  let items = $derived(app.queue.items);
  let playingIndex = $derived(app.queue.state.index);

  // The scrollport `keepCursorRowVisible` measures against.
  let container: HTMLDivElement | undefined = $state();

  // A long queue is taller than the window it sits in, so the cursor has to drag
  // the list with it — see keepCursorRowVisible.
  keepCursorRowVisible(
    () => container,
    () => cursor.index,
  );

  function playItem(index: number): void {
    const item = items[index];
    if (!item) return;
    app.queue.jumpToUid(item.uid);
    void app.player.play();
  }

  /**
   * The list is driven by the app's keyboard router (enter activates the
   * selected row), so rows are not Tab targets. But a pointer click focuses a
   * row in some browsers, and an interactive role must then be usable from the
   * keyboard — hence tabindex="-1" and Enter. Space deliberately bubbles, so the
   * global play/pause binding still works while a row has focus.
   */
  function onRowKeydown(event: KeyboardEvent, index: number): void {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.stopPropagation();
    playItem(index);
  }

  // --------------------------------------------------- touch drag & remove

  /** The drag in progress: `from` is the row being dragged, `to` the drop row. */
  let dragFrom: number | null = null;
  let dragTo: number | null = null;

  /** Row geometry for the drag target calculation, measured on each move. */
  function rowRects(): { top: number; bottom: number }[] {
    if (!container) return [];
    return Array.from(container.querySelectorAll<HTMLElement>('.row'), (row) => {
      const rect = row.getBoundingClientRect();
      return { top: rect.top, bottom: rect.bottom };
    });
  }

  /**
   * A drag starts on the handle. `touch-action: none` keeps the list from
   * scrolling, and pointer capture routes the move/up events back to the handle
   * as the finger travels.
   */
  function startDrag(event: PointerEvent, index: number): void {
    event.stopPropagation();
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    dragFrom = index;
    dragTo = index;
  }

  function moveDrag(event: PointerEvent): void {
    if (dragFrom === null) return;
    dragTo = dropIndex(event.clientY, rowRects());
  }

  function endDrag(event: PointerEvent): void {
    if (dragFrom === null) return;
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    const from = dragFrom;
    const to = dragTo ?? from;
    dragFrom = null;
    dragTo = null;
    if (from !== to) app.queue.move(from, to);
  }

  function cancelDrag(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    dragFrom = null;
    dragTo = null;
  }

  onMount(() =>
    app.keyboard.registerAll([
      ...listNavigationBindings(cursor, {
        scope,
        hint,
        onActivate: () => playItem(cursor.index),
      }),
      {
        keys: ['x', 'delete'],
        scope,
        group: 'queue',
        description: 'remove from queue',
        hint,
        run: () => {
          const removed = app.queue.removeAtCursor();
          if (removed > 0) app.toasts.info(`removed ${removed} from the queue`);
        },
      },
      {
        keys: ['J'],
        scope,
        group: 'queue',
        description: 'move item down',
        hint,
        run: () => {
          // The store moves its own cursor with the item, so the highlight
          // follows without a second, separately-clamped move().
          app.queue.moveCursorItem(1);
        },
      },
      {
        keys: ['K'],
        scope,
        group: 'queue',
        description: 'move item up',
        hint,
        run: () => {
          app.queue.moveCursorItem(-1);
        },
      },
      {
        keys: ['c'],
        scope,
        group: 'queue',
        description: 'clear the queue',
        hint,
        run: () => {
          app.queue.clear();
          app.toasts.info('queue cleared');
        },
      },
      {
        keys: ['s'],
        scope,
        group: 'queue',
        description: 'shuffle the queue',
        hint,
        run: () => {
          const on = app.queue.toggleShuffle();
          app.toasts.info(`shuffle ${on ? 'on' : 'off'}`);
        },
      },
      {
        keys: ['d'],
        scope,
        group: 'queue',
        description: 'toggle auto-dj for the rest of this session',
        hint,
        run: () => {
          app.settings.toggle('autoDj');
          app.toasts.info(`auto-dj ${app.settings.state.autoDj ? 'on' : 'off'}`);
        },
      },
    ]),
  );
</script>

<div class="rows" bind:this={container} role="listbox" aria-label="queue">
  {#each items as item, index (item.uid)}
    <div
      class="row"
      class:selected={cursor.isSelected(index)}
      class:playing={index === playingIndex}
      role="option"
      aria-selected={cursor.isSelected(index)}
      data-row={index}
      tabindex="-1"
      onclick={() => playItem(index)}
      onkeydown={(event) => onRowKeydown(event, index)}
      use:longPress={{ onLongPress: () => actions.openTrackActions(item.track) }}
    >
      <button
        type="button"
        class="drag"
        aria-label="reorder {item.track.title}"
        tabindex="-1"
        onclick={(event) => event.stopPropagation()}
        onpointerdown={(event) => startDrag(event, index)}
        onpointermove={(event) => moveDrag(event)}
        onpointerup={(event) => endDrag(event)}
        onpointercancel={(event) => cancelDrag(event)}
      >
        ≡
      </button>
      <span class="marker"
        >{index === playingIndex ? '▶' : cursor.isSelected(index) ? '▸' : ' '}</span
      >
      <span class="number">{String(index + 1).padStart(3, ' ')}</span>
      <span class="title">{truncate(item.track.title, 40)}</span>
      <span class="artist">{truncate(item.track.artistName ?? '', 24)}</span>
      <span class="duration">{formatDuration(item.track.durationSec)}</span>
      {#if app.resolver.isCached(item.track.id)}<span class="badge" title="available offline"
          >▣</span
        >{/if}
      <button
        type="button"
        class="remove"
        aria-label="remove {item.track.title}"
        tabindex="-1"
        onclick={(event) => {
          event.stopPropagation();
          app.queue.remove([item.uid]);
        }}
      >
        ✕
      </button>
    </div>
  {/each}
  {#if items.length === 0}
    <p class="empty">{emptyMessage}</p>
  {/if}
</div>

<style>
  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
    padding: 0 0.3em;
    cursor: pointer;
  }
  .row.selected {
    background: var(--accent);
    color: var(--bg);
  }
  .row.playing .title {
    color: var(--ok);
    font-weight: 700;
  }
  .row.selected .title,
  .row.selected .artist,
  .row.selected .duration {
    color: var(--bg);
  }
  .marker {
    width: 1em;
    flex: none;
    color: var(--accent);
  }
  .row.selected .marker {
    color: var(--bg);
  }
  .number {
    color: var(--fg-faint);
    flex: none;
  }
  .title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .artist {
    flex: none;
    width: 24ch;
    color: var(--fg-dim);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .duration {
    flex: none;
    color: var(--fg-dim);
  }
  .badge {
    flex: none;
    color: var(--ok);
  }
  .drag,
  .remove {
    flex: none;
    align-self: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    line-height: 1;
    color: inherit;
    opacity: 0.7;
    cursor: pointer;
  }
  .drag {
    touch-action: none;
  }
  .drag:hover,
  .remove:hover {
    opacity: 1;
  }
  :global([data-shell='touch']) .drag,
  :global([data-shell='touch']) .remove {
    min-height: 44px;
    min-width: 44px;
  }
  .empty {
    color: var(--fg-dim);
    margin: 0.4rem 0;
  }
</style>
