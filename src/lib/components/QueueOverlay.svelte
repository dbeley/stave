<!--
  The queue window: what is playing, what is next, and direct manipulation of it.
  Reorder with J/K, remove with x, jump with Enter — all keyboard-first.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import Overlay from '$lib/components/Overlay.svelte';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import { formatDuration, truncate } from '$lib/utils/format';

  let cursor = new ListCursor();
  let items = $derived(app.queue.items);

  // This overlay renders its own rows, so nothing else syncs the cursor's count.
  // Without it move() clamps against 0 and j/k are inert — and the highlight then
  // drifts out of step with the queue's own selection cursor, which is what
  // reorder/remove act on.
  $effect(() => cursor.setCount(items.length));
  let playingIndex = $derived(app.queue.state.index);

  onMount(() => {
    const unbind = app.keyboard.registerAll([
      ...listNavigationBindings(cursor, {
        scope: 'overlay',
        hint: false,
        onActivate: () => {
          const item = items[cursor.index];
          if (!item) return;
          app.queue.jumpToUid(item.uid);
          void app.player.play();
        },
      }),
      {
        keys: ['x', 'delete'],
        scope: 'overlay',
        group: 'queue',
        description: 'remove from queue',
        run: () => {
          const removed = app.queue.removeAtCursor();
          if (removed > 0) app.toasts.info(`removed ${removed} from the queue`);
        },
      },
      {
        keys: ['J'],
        scope: 'overlay',
        group: 'queue',
        description: 'move item down',
        run: () => {
          if (app.queue.moveCursorItem(1)) cursor.move(1);
        },
      },
      {
        keys: ['K'],
        scope: 'overlay',
        group: 'queue',
        description: 'move item up',
        run: () => {
          if (app.queue.moveCursorItem(-1)) cursor.move(-1);
        },
      },
      {
        keys: ['c'],
        scope: 'overlay',
        group: 'queue',
        description: 'clear the queue',
        run: () => {
          app.queue.clear();
          app.toasts.info('queue cleared');
        },
      },
      {
        keys: ['s'],
        scope: 'overlay',
        group: 'queue',
        description: 'shuffle the queue',
        run: () => {
          const on = app.queue.toggleShuffle();
          app.toasts.info(`shuffle ${on ? 'on' : 'off'}`);
        },
      },
      {
        keys: ['d'],
        scope: 'overlay',
        group: 'queue',
        description: 'toggle auto-dj for the rest of this session',
        run: () => {
          app.settings.toggle('autoDj');
          app.toasts.info(`auto-dj ${app.settings.state.autoDj ? 'on' : 'off'}`);
        },
      },
    ]);
    return unbind;
  });
</script>

<Overlay
  title="queue"
  note="{items.length} items · {playingIndex + 1}/{items.length}"
  width="min(94vw, 92ch)"
>
  <div class="rows">
    {#each items as item, index (item.uid)}
      <div
        class="row"
        class:selected={cursor.isSelected(index)}
        class:playing={index === playingIndex}
      >
        <span class="marker"
          >{index === playingIndex ? '▶' : cursor.isSelected(index) ? '▸' : ' '}</span
        >
        <span class="number">{String(index + 1).padStart(3, ' ')}</span>
        <span class="title">{truncate(item.track.title, 40)}</span>
        <span class="artist">{truncate(item.track.artistName ?? '', 24)}</span>
        <span class="duration">{formatDuration(item.track.durationSec)}</span>
        {#if app.resolver.isCached(item.track.id)}<span class="badge">▣</span>{/if}
      </div>
    {/each}
    {#if items.length === 0}
      <p class="empty">the queue is empty — press enter on an album or track</p>
    {/if}
  </div>
</Overlay>

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
