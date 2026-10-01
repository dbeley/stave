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
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import { formatDuration, truncate } from '$lib/utils/format';
  import type { Scope } from '$lib/keyboard/registry.svelte';

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

  let cursor = new ListCursor();
  let items = $derived(app.queue.items);
  let playingIndex = $derived(app.queue.state.index);

  // Whoever renders the rows owns the cursor count: without this `move()` clamps
  // against 0, so j/k are inert and the highlight drifts out of step with the
  // queue's own selection cursor, which is what reorder/remove act on.
  $effect(() => cursor.setCount(items.length));

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
          if (app.queue.moveCursorItem(1)) cursor.move(1);
        },
      },
      {
        keys: ['K'],
        scope,
        group: 'queue',
        description: 'move item up',
        hint,
        run: () => {
          if (app.queue.moveCursorItem(-1)) cursor.move(-1);
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

<div class="rows" role="listbox" aria-label="queue">
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
    >
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
  .empty {
    color: var(--fg-dim);
    margin: 0.4rem 0;
  }
</style>
