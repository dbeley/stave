<!--
  Playlists: every playlist on the server.
 *
 * There is no playlist store, so the page owns its slice and fetches once on
 * mount; `r` re-fetches. Enter (or a click) opens the playlist.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import ListView from '$lib/components/ListView.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import StateMessage from '$lib/components/StateMessage.svelte';
  import { describeError } from '$lib/api/errors';
  import type { Playlist } from '$lib/domain/types';
  import { countTracks, formatLongDuration, truncate } from '$lib/utils/format';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';

  let playlists = $state<Playlist[]>([]);
  let loading = $state(true);
  let error = $state<string | undefined>();
  let cursor = new ListCursor();
  let started = false;

  async function fetchPlaylists(): Promise<void> {
    loading = true;
    error = undefined;
    try {
      if (!app.isConnected) throw new Error('not connected');
      playlists = await app.requireClient().getPlaylists();
    } catch (cause) {
      error = describeError(cause);
    } finally {
      loading = false;
    }
  }

  function openSelected(): void {
    const playlist = cursor.selected(playlists);
    if (playlist) app.router.navigate({ name: 'playlist', id: playlist.id });
  }

  // Fetch once; `r` is the explicit refresh.
  $effect(() => {
    if (started) return;
    started = true;
    void fetchPlaylists();
  });

  onMount(() =>
    app.keyboard.registerAll([
      ...listNavigationBindings(cursor, { hint: true, onActivate: openSelected }),
      {
        keys: ['r'],
        scope: 'page',
        group: 'playlist',
        description: 'reload playlists',
        run: () => void fetchPlaylists(),
      },
    ]),
  );
</script>

<main class="page">
  <Panel
    title="playlists"
    note={error ? '' : playlists.length}
    active={true}
    scroll={true}
    grow={true}
  >
    {#if error}
      <StateMessage
        kind="error"
        message="could not load playlists"
        detail={error}
        hint="press r to retry"
      />
    {:else if loading && playlists.length === 0}
      <StateMessage kind="loading" message="loading playlists" />
    {:else if playlists.length === 0}
      <StateMessage
        kind="empty"
        message="no playlists"
        hint="create one on the server and press r"
      />
    {:else}
      <ListView
        items={playlists}
        {cursor}
        keyOf={(playlist) => playlist.id}
        ariaLabel="playlists"
        onActivate={(playlist) => app.router.navigate({ name: 'playlist', id: playlist.id })}
      >
        {#snippet row(playlist)}
          <div class="row">
            <span class="name">{truncate(playlist.name, 44)}</span>
            {#if playlist.owner}
              <span class="dim owner">{playlist.owner}</span>
            {/if}
            <span class="spacer"></span>
            <span class="dim count">{countTracks(playlist.songCount)}</span>
            <span class="dim duration">{formatLongDuration(playlist.durationSec)}</span>
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
  .row {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
    min-width: 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .owner {
    flex: none;
    max-width: 20ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .dim {
    color: var(--fg-dim);
  }
  .count,
  .duration {
    flex: none;
  }
</style>
