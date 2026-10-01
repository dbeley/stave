<!--
  Listen later: the local, album-only shortlist that doubles as the offline
  download worklist.
 *
 * Nothing here ever reaches the server — it is a private "grab this next" queue.
 * Each row is enriched with its offline status so the list can be worked
 * without opening the queue window: d downloads now, D retries a failure,
 * X deletes the cached copy and O flips the global offline-cache switch.
 *
 * Key collisions checked against the shared album bindings
 * (enter/p/n/a/f/L/o/y in `$lib/ui/albumKeys`): `y` there is "go to artist", so
 * deleting a downloaded copy moves to `X`, which is bound nowhere else. `x`
 * (remove from list) and `D` (retry) shadow global bindings on purpose — page
 * bindings outrank globals.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import AlbumRow from '$lib/components/AlbumRow.svelte';
  import ListView from '$lib/components/ListView.svelte';
  import Meter from '$lib/components/Meter.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import StateMessage from '$lib/components/StateMessage.svelte';
  import { countAlbums, countTracks, formatBytes } from '$lib/utils/format';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import { albumListBindings } from '$lib/ui/albumKeys.svelte';
  import { actions } from '$lib/ui/actionsRegistry.svelte';

  let cursor = new ListCursor();

  let albums = $derived(app.listenLater.albums);
  let count = $derived(app.listenLater.count);
  let caching = $derived(app.settings.state.offlineCacheEnabled);
  let cachedCount = $derived(app.resolver.cachedCount);
  let cachedBytes = $derived(app.downloads.cachedBytes);

  function selected(): (typeof albums)[number] | undefined {
    return cursor.selected(albums);
  }

  function removeSelected(): void {
    const album = selected();
    if (!album) return;
    app.listenLater.remove(album.id);
    app.toasts.info(`removed from listen later: "${album.name}"`);
  }

  function clearAll(): void {
    if (count === 0) return;
    app.listenLater.clear();
    app.toasts.info('listen later cleared');
  }

  /** Reorder, keeping the cursor on the row that moved. */
  function moveSelected(delta: number): void {
    const from = cursor.index;
    const to = from + delta;
    if (to < 0 || to >= count) return;
    app.listenLater.move(from, to);
    cursor.set(to);
  }

  /** Force a download now, even when the global cache switch is off. */
  function downloadSelected(): void {
    const album = selected();
    if (!album) return;
    app.downloads.enqueue(album);
    app.toasts.info(
      caching
        ? `queued for offline: "${album.name}"`
        : `downloading "${album.name}" now (offline cache is off — forced for this album)`,
    );
  }

  function retrySelected(): void {
    const album = selected();
    if (!album) return;
    const entry = app.downloads.entry(album.id);
    if (entry?.status === 'failed') {
      app.downloads.retry(album.id);
      app.toasts.info(`retrying: "${album.name}"`);
    } else {
      app.toasts.warn('nothing failed to retry for this album');
    }
  }

  function deleteCopy(): void {
    const album = selected();
    if (!album) return;
    void app.downloads.remove(album.id);
    app.toasts.info(`deleted the downloaded copy of "${album.name}"`);
  }

  function toggleOfflineCache(): void {
    app.setOfflineCacheEnabled(!caching);
  }

  onMount(() =>
    app.keyboard.registerAll([
      ...listNavigationBindings(cursor, { hint: true }),
      ...albumListBindings(cursor, () => albums),
      {
        keys: ['x'],
        scope: 'page',
        group: 'listen later',
        description: 'remove from listen later',
        hint: true,
        run: () => removeSelected(),
      },
      {
        keys: ['c'],
        scope: 'page',
        group: 'listen later',
        description: 'clear the list',
        hint: true,
        run: () => clearAll(),
      },
      {
        keys: ['J'],
        scope: 'page',
        group: 'listen later',
        description: 'move down',
        hint: true,
        run: () => moveSelected(1),
      },
      {
        keys: ['K'],
        scope: 'page',
        group: 'listen later',
        description: 'move up',
        hint: true,
        run: () => moveSelected(-1),
      },
      {
        keys: ['d'],
        scope: 'page',
        group: 'listen later',
        description: 'download now',
        hint: true,
        run: () => downloadSelected(),
      },
      {
        keys: ['D'],
        scope: 'page',
        group: 'listen later',
        description: 'retry a failed download',
        hint: true,
        run: () => retrySelected(),
      },
      {
        keys: ['X'],
        scope: 'page',
        group: 'listen later',
        description: 'delete cached copy',
        hint: true,
        run: () => deleteCopy(),
      },
      {
        keys: ['O'],
        scope: 'page',
        group: 'listen later',
        description: 'offline cache on/off',
        hint: true,
        run: () => toggleOfflineCache(),
      },
    ]),
  );
</script>

<main class="page">
  <Panel title="offline cache" note={caching ? 'on' : 'off'}>
    <div class="summary">
      <span>caching</span>
      <span class:on={caching}>{caching ? 'on' : 'off'}</span>
      <span class="dim">{countAlbums(count)} in listen later</span>
      <span class="dim">{countTracks(cachedCount)} cached · {formatBytes(cachedBytes)} used</span>
    </div>
    {#if !caching}
      <p class="hint">
        offline caching is off — these albums are not downloaded. enable it in settings, or press
        <kbd>O</kbd> here to fetch them now.
      </p>
    {/if}
  </Panel>

  <Panel title="listen later" note={count} active={true} scroll={true} grow={true}>
    {#if count === 0}
      <StateMessage
        kind="empty"
        message="listen later is empty"
        hint="local only — this list never touches the server; add albums with L"
      />
    {:else}
      <ListView
        items={albums}
        {cursor}
        keyOf={(album) => album.id}
        ariaLabel="listen later"
        onActivate={(album) => actions.openAlbum(album.id)}
      >
        {#snippet row(album)}
          {@const download = app.downloads.entry(album.id)}
          <div class="later-row">
            <AlbumRow {album} />
            <span class="spacer"></span>
            {#if download}
              {#if download.status === 'queued'}
                <span class="status queued">queued</span>
              {:else if download.status === 'downloading'}
                <span class="status downloading">
                  <Meter
                    value={download.total > 0 ? download.done / download.total : 0}
                    showPercent={true}
                    label="downloading"
                  />
                  <span class="dim"
                    >{download.done}/{download.total} · {formatBytes(download.bytes)}</span
                  >
                </span>
              {:else if download.status === 'cached'}
                <span class="status cached">cached · {formatBytes(download.bytes)}</span>
              {:else if download.status === 'failed'}
                <span class="status failed">failed · {download.error ?? 'unknown error'}</span>
              {/if}
            {/if}
          </div>
        {/snippet}
      </ListView>
    {/if}
  </Panel>
</main>

<style>
  .page {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 0.55rem;
    gap: 0.5rem;
  }
  .summary {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.8em;
  }
  .on {
    color: var(--ok);
  }
  .dim {
    color: var(--fg-dim);
  }
  .hint {
    margin: 0.4rem 0 0;
    color: var(--fg-faint);
  }
  kbd {
    font-family: var(--font-mono);
    color: var(--accent);
  }
  .later-row {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
    min-width: 0;
  }
  .spacer {
    flex: 1;
  }
  .status {
    flex: none;
    white-space: nowrap;
  }
  .queued {
    color: var(--fg-dim);
  }
  .downloading {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4em;
    color: var(--fg-dim);
  }
  .cached {
    color: var(--ok);
  }
  .failed {
    color: var(--danger);
  }
</style>
