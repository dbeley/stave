<!--
  Playlist page: header metadata and the ordered track list.
 *
 * There is no playlist store, so the page fetches by id and owns its slice.
 * Enter on a track replaces the queue with the playlist, starting there.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import ListView from '$lib/components/ListView.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import StateMessage from '$lib/components/StateMessage.svelte';
  import TrackRow from '$lib/components/TrackRow.svelte';
  import { describeError } from '$lib/api/errors';
  import type { Playlist } from '$lib/domain/types';
  import { countTracks, formatLongDuration } from '$lib/utils/format';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import { actions } from '$lib/ui/actionsRegistry.svelte';
  import { trackListBindings } from '$lib/ui/trackKeys.svelte';

  let id = $derived(app.router.current.name === 'playlist' ? app.router.current.id : '');
  let playlist = $state<Playlist | undefined>();
  let error = $state<string | undefined>();
  let entries = $derived(playlist?.entries ?? []);
  let totalDuration = $derived(entries.reduce((sum, track) => sum + track.durationSec, 0));
  let cursor = new ListCursor();
  let startedFor = '';

  async function fetchPlaylist(playlistId: string): Promise<void> {
    error = undefined;
    try {
      if (!app.isConnected) throw new Error('not connected');
      playlist = await app.requireClient().getPlaylist(playlistId);
    } catch (cause) {
      error = describeError(cause);
      playlist = undefined;
    }
  }

  // Fetch once per id (the router can swap ids without remounting the page).
  $effect(() => {
    const currentId = id;
    if (!currentId || startedFor === currentId) return;
    startedFor = currentId;
    void fetchPlaylist(currentId);
  });

  onMount(() =>
    app.keyboard.registerAll([
      ...listNavigationBindings(cursor, { hint: true }),
      ...trackListBindings(cursor, () => entries, {
        context: () =>
          playlist ? { tracks: entries, index: cursor.index, label: playlist.name } : undefined,
      }),
    ]),
  );
</script>

<main class="page">
  {#if error}
    <Panel title="playlist" grow={true}>
      <StateMessage
        kind="error"
        message="could not load this playlist"
        detail={error}
        hint="go back and try again"
      />
    </Panel>
  {:else if !playlist}
    <Panel title="playlist" grow={true}>
      <StateMessage kind="loading" message="loading playlist" />
    </Panel>
  {:else}
    <Panel title="playlist">
      <h1 class="name">{playlist.name}</h1>
      <dl class="meta">
        {#if playlist.owner}
          <dt>owner</dt>
          <dd>{playlist.owner}</dd>
        {/if}
        <dt>tracks</dt>
        <dd>{countTracks(entries.length)} · {formatLongDuration(totalDuration)}</dd>
      </dl>
    </Panel>

    <Panel
      title="tracks"
      note={entries.length ? `${cursor.index + 1}/${entries.length}` : ''}
      active={true}
      scroll={true}
      grow={true}
    >
      {#if entries.length === 0}
        <StateMessage kind="empty" message="this playlist is empty" />
      {:else}
        <ListView
          items={entries}
          {cursor}
          keyOf={(track, index) => `${track.id}-${index}`}
          ariaLabel="playlist tracks"
          onActivate={(track, index) =>
            void actions.playTrackNow(track, { tracks: entries, index, label: playlist?.name })}
        >
          {#snippet row(track, index)}
            <TrackRow
              {track}
              {index}
              showAlbum={true}
              technical={app.settings.state.showTechnicalColumns}
            />
          {/snippet}
        </ListView>
      {/if}
    </Panel>
  {/if}
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
  .name {
    margin: 0 0 0.3rem;
    font-size: 1.15rem;
    color: var(--accent);
  }
  .meta {
    display: grid;
    grid-template-columns: 8ch 1fr;
    gap: 0.1rem 0.5rem;
    margin: 0;
  }
  .meta dt {
    color: var(--fg-faint);
  }
  .meta dd {
    margin: 0;
  }
</style>
