<!--
  Favorites: everything the server reports as starred.
 *
 * Artists, albums and tracks share one flat, navigable list. Headings are
 * section markers the cursor skips, exactly like the search results, and each
 * row's keys follow the shared item contract: enter opens or plays, a appends,
 * n plays next, f unfavourites, o opens the action menu and L marks listen
 * later.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import AlbumRow from '$lib/components/AlbumRow.svelte';
  import ArtistRow from '$lib/components/ArtistRow.svelte';
  import ListView from '$lib/components/ListView.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import StateMessage from '$lib/components/StateMessage.svelte';
  import TrackRow from '$lib/components/TrackRow.svelte';
  import type { Album, Artist, Track } from '$lib/domain/types';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import { actions } from '$lib/ui/actionsRegistry.svelte';

  type Row =
    | { kind: 'heading'; label: string; count: number }
    | { kind: 'none'; label: string; message: string }
    | { kind: 'artist'; artist: Artist }
    | { kind: 'album'; album: Album }
    | { kind: 'track'; track: Track; index: number };

  let cursor = new ListCursor();

  let favorites = $derived(app.favorites.state);
  let total = $derived(
    favorites.artists.length + favorites.albums.length + favorites.tracks.length,
  );

  let rows = $derived<Row[]>(buildRows());

  function buildRows(): Row[] {
    const state = app.favorites.state;
    const out: Row[] = [];

    out.push({ kind: 'heading', label: 'artists', count: state.artists.length });
    if (state.artists.length === 0) {
      out.push({ kind: 'none', label: 'artists', message: 'no starred artists' });
    } else {
      for (const artist of state.artists) out.push({ kind: 'artist', artist });
    }

    out.push({ kind: 'heading', label: 'albums', count: state.albums.length });
    if (state.albums.length === 0) {
      out.push({ kind: 'none', label: 'albums', message: 'no starred albums' });
    } else {
      for (const album of state.albums) out.push({ kind: 'album', album });
    }

    out.push({ kind: 'heading', label: 'tracks', count: state.tracks.length });
    if (state.tracks.length === 0) {
      out.push({ kind: 'none', label: 'tracks', message: 'no starred tracks' });
    } else {
      state.tracks.forEach((track, index) => out.push({ kind: 'track', track, index }));
    }

    return out;
  }

  /** Rows the cursor can land on: headings and inline notes are skipped. */
  function selectableIndices(): number[] {
    return rows
      .map((row, index) => (row.kind === 'heading' || row.kind === 'none' ? -1 : index))
      .filter((index) => index >= 0);
  }

  function selectedRow(): Row | undefined {
    const row = rows[cursor.index];
    return row && row.kind !== 'heading' && row.kind !== 'none' ? row : undefined;
  }

  function activate(row: Row | undefined = selectedRow()): void {
    if (!row) return;
    if (row.kind === 'artist') actions.openArtist(row.artist.id);
    else if (row.kind === 'album') actions.openAlbum(row.album.id);
    else if (row.kind === 'track') void actions.playTrackNow(row.track);
  }

  function queueRow(mode: 'end' | 'next', row: Row | undefined = selectedRow()): void {
    if (!row) return;
    if (row.kind === 'album') void actions.enqueueAlbum(row.album, mode);
    else if (row.kind === 'track') actions.enqueueTrack(row.track, mode);
  }

  function unfavouriteRow(row: Row | undefined = selectedRow()): void {
    if (!row) return;
    if (row.kind === 'artist') void actions.toggleArtistFavorite(row.artist);
    else if (row.kind === 'album') void actions.toggleAlbumFavorite(row.album);
    else if (row.kind === 'track') void actions.toggleTrackFavorite(row.track);
  }

  function listenLaterRow(row: Row | undefined = selectedRow()): void {
    if (!row) return;
    if (row.kind === 'album') actions.toggleListenLater(row.album);
    else if (row.kind === 'track') void actions.toggleListenLaterForTrack(row.track);
    else app.toasts.warn('listen later only applies to albums');
  }

  function openActions(row: Row | undefined = selectedRow()): void {
    if (!row) return;
    if (row.kind === 'album') actions.openAlbumActions(row.album);
    else if (row.kind === 'track') actions.openTrackActions(row.track);
    else if (row.kind === 'artist') actions.openArtistActions(row.artist);
  }

  // Starred entities are cheap to re-fetch and de-duplicated by the store.
  $effect(() => {
    void app.favorites.load();
  });

  // Never leave the cursor on a heading or an inline empty note.
  $effect(() => {
    const selectable = selectableIndices();
    if (selectable.length === 0) return;
    if (!selectable.includes(cursor.index)) {
      const next = selectable.find((index) => index > cursor.index) ?? selectable[0]!;
      cursor.set(next);
    }
  });

  onMount(() =>
    app.keyboard.registerAll([
      ...listNavigationBindings(cursor, { hint: true, onActivate: () => activate() }),
      {
        keys: ['n'],
        scope: 'page',
        group: 'favorites',
        description: 'play next',
        run: () => queueRow('next'),
      },
      {
        keys: ['a'],
        scope: 'page',
        group: 'favorites',
        description: 'add to queue',
        run: () => queueRow('end'),
      },
      {
        keys: ['f'],
        scope: 'page',
        group: 'favorites',
        description: 'unfavourite',
        run: () => unfavouriteRow(),
      },
      {
        keys: ['o'],
        scope: 'page',
        group: 'favorites',
        description: 'actions',
        run: () => openActions(),
      },
      {
        keys: ['L'],
        scope: 'page',
        group: 'favorites',
        description: 'listen later',
        run: () => listenLaterRow(),
      },
    ]),
  );
</script>

<main class="page">
  <Panel
    title="favorites"
    note={favorites.loading ? 'loading…' : total > 0 ? `${total} starred` : ''}
    active={true}
    scroll={true}
    grow={true}
  >
    {#if favorites.error}
      <StateMessage
        kind="error"
        message="could not load your favourites"
        detail={favorites.error}
        hint="press R to retry"
      />
    {:else if favorites.loading && total === 0}
      <StateMessage kind="loading" message="loading favourites" />
    {:else if total === 0}
      <StateMessage
        kind="empty"
        message="nothing starred yet — press f on a track or album"
        hint="stars live on the server; this list mirrors them"
      />
    {:else}
      <ListView
        items={rows}
        {cursor}
        keyOf={(row, index) =>
          row.kind === 'heading'
            ? `heading-${row.label}`
            : row.kind === 'none'
              ? `none-${row.label}`
              : row.kind === 'artist'
                ? row.artist.id
                : row.kind === 'album'
                  ? row.album.id
                  : `${row.track.id}-${index}`}
        ariaLabel="favorites"
        onActivate={(row) => activate(row)}
      >
        {#snippet row(entry, index)}
          {#if entry.kind === 'heading'}
            <span class="heading tui-upper">── {entry.label} ({entry.count})</span>
          {:else if entry.kind === 'none'}
            <span class="empty-note">└─ {entry.message}</span>
          {:else if entry.kind === 'artist'}
            <ArtistRow artist={entry.artist} />
          {:else if entry.kind === 'album'}
            <AlbumRow album={entry.album} />
          {:else}
            <TrackRow
              track={entry.track}
              {index}
              showAlbum={true}
              technical={app.settings.state.showTechnicalColumns}
            />
          {/if}
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
  .heading {
    color: var(--accent);
  }
  .empty-note {
    color: var(--fg-faint);
  }
</style>
