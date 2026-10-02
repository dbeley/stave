<!--
  Search: artists, albums and tracks in one navigable list.
 *
 * Clicking a row behaves as specified: a track replaces the queue and plays, an
 * album opens its page, an artist opens theirs. Every result also carries
 * explicit "queue" buttons so the same actions are reachable by mouse, and the
 * keyboard shortcut (a = append) works on the selected row.
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
    | { kind: 'artist'; artist: Artist }
    | { kind: 'album'; album: Album }
    | { kind: 'track'; track: Track; index: number };

  let cursor = new ListCursor();
  let input: HTMLInputElement | undefined = $state();
  // Starts at 0, not at the current counter: the page can mount *after* the `/`
  // shortcut already incremented it (navigate + focus in the same tick), so the
  // effect below would otherwise see "no change" and never focus.
  let lastFocusRequest = 0;
  let query = $derived(app.search.state.query);

  let rows = $derived<Row[]>(buildRows());

  function buildRows(): Row[] {
    const results = app.search.state.results;
    const out: Row[] = [];
    if (results.artists.length > 0) {
      out.push({ kind: 'heading', label: 'artists', count: results.artists.length });
      for (const artist of results.artists) out.push({ kind: 'artist', artist });
    }
    if (results.albums.length > 0) {
      out.push({ kind: 'heading', label: 'albums', count: results.albums.length });
      for (const album of results.albums) out.push({ kind: 'album', album });
    }
    if (results.tracks.length > 0) {
      out.push({ kind: 'heading', label: 'tracks', count: results.tracks.length });
      results.tracks.forEach((track, index) => out.push({ kind: 'track', track, index }));
    }
    return out;
  }

  /** Rows the cursor can land on (headings are skipped). */
  function selectableIndices(): number[] {
    return rows.map((row, index) => (row.kind === 'heading' ? -1 : index)).filter((i) => i >= 0);
  }

  function selectedRow(): Row | undefined {
    const row = rows[cursor.index];
    return row && row.kind !== 'heading' ? row : undefined;
  }

  function activate(row: Row | undefined = selectedRow()): void {
    if (!row) return;
    switch (row.kind) {
      case 'artist':
        actions.openArtist(row.artist.id);
        break;
      case 'album':
        actions.openAlbum(row.album.id);
        break;
      case 'track':
        // Clicking a track overwrites the queue and plays it.
        void actions.playTrackNow(row.track);
        break;
      default:
        break;
    }
  }

  function queueRow(mode: 'end' | 'next', row: Row | undefined = selectedRow()): void {
    if (!row) return;
    if (row.kind === 'album') {
      void actions.enqueueAlbum(row.album, mode);
      return;
    }
    if (row.kind === 'track') {
      actions.enqueueTrack(row.track, mode);
    }
  }

  function favouriteRow(row: Row | undefined = selectedRow()): void {
    if (!row) return;
    if (row.kind === 'album') void actions.toggleAlbumFavorite(row.album);
    else if (row.kind === 'track') void actions.toggleTrackFavorite(row.track);
    else if (row.kind === 'artist') void actions.toggleArtistFavorite(row.artist);
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

  // The `/` shortcut asks for focus; skipping headings keeps navigation sane.
  $effect(() => {
    if (app.focusRequests.search !== lastFocusRequest) {
      lastFocusRequest = app.focusRequests.search;
      input?.focus();
      input?.select();
    }
  });

  /**
   * Never leave the cursor on a heading — but which way to skip depends on where
   * the cursor came from.
   *
   * Always skipping forwards pinned the cursor to the first row of each
   * sub-category: pressing `k` from the first album landed on the "albums"
   * heading, which was then "corrected" straight back down onto that same album,
   * so there was no way up out of a section.
   */
  let lastSelectable = $state(0);

  $effect(() => {
    const index = cursor.index;
    const row = rows[index];
    if (row && row.kind !== 'heading') {
      lastSelectable = index;
      return;
    }
    const selectable = selectableIndices();
    if (selectable.length === 0) return;
    const forward = selectable.find((candidate) => candidate > index);
    const backward = [...selectable].reverse().find((candidate) => candidate < index);
    const next =
      index > lastSelectable
        ? (forward ?? selectable[selectable.length - 1])
        : (backward ?? selectable[0]);
    if (next !== undefined) cursor.set(next);
  });

  // A new result set starts at the top, so Enter drops you onto the first result.
  let lastResultsFor = '';
  $effect(() => {
    const resultsFor = app.search.state.resultsFor;
    if (resultsFor === lastResultsFor) return;
    lastResultsFor = resultsFor;
    cursor.set(0);
  });

  onMount(() =>
    app.keyboard.registerAll([
      ...listNavigationBindings(cursor, { hint: true, onActivate: () => activate() }),
      {
        keys: ['a'],
        scope: 'page',
        group: 'search',
        description: 'add to queue',
        run: () => queueRow('end'),
      },
      {
        keys: ['f'],
        scope: 'page',
        group: 'search',
        description: 'toggle favourite',
        run: () => favouriteRow(),
      },
      {
        keys: ['L'],
        scope: 'page',
        group: 'search',
        description: 'toggle listen later',
        run: () => listenLaterRow(),
      },
      {
        keys: ['o'],
        scope: 'page',
        group: 'search',
        description: 'actions',
        run: () => openActions(),
      },
      {
        keys: ['escape'],
        scope: 'page',
        group: 'search',
        description: 'leave the search field',
        when: () => document.activeElement === input,
        run: () => input?.blur(),
      },
    ]),
  );
</script>

<main class="page">
  <input
    class="search"
    type="search"
    bind:this={input}
    value={query}
    placeholder="search artists, albums, tracks…   (/ to focus, enter to search and jump to the results)"
    aria-label="search"
    oninput={(event) => app.search.setQuery((event.currentTarget as HTMLInputElement).value)}
    onkeydown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void app.search.submit();
        /*
         * Enter means "run it, then go and look at the results". Leaving focus in
         * the field swallowed every navigation key — the router ignores keys typed
         * into a text input — so the results were only reachable by pressing tab
         * repeatedly. An empty query has nothing to jump to, so focus stays put.
         */
        if (app.search.hasQuery) input?.blur();
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        input?.blur();
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        input?.blur();
        cursor.move(1);
      }
    }}
  />

  <Panel
    title="results"
    note={app.search.state.loading
      ? 'searching…'
      : app.search.state.total > 0
        ? `${app.search.state.total} for "${app.search.state.resultsFor}"`
        : ''}
    active={true}
    scroll={true}
    grow={true}
  >
    {#if app.search.state.error}
      <StateMessage kind="error" message="search failed" detail={app.search.state.error} />
    {:else if !app.search.hasQuery}
      <StateMessage
        kind="info"
        message="type to search"
        hint="enter on a track replaces the queue and plays · a appends"
      />
    {:else if app.search.state.loading && rows.length === 0}
      <StateMessage kind="loading" message="searching" />
    {:else if rows.length === 0}
      <StateMessage kind="empty" message="no results" hint="try a different spelling" />
    {:else}
      <ListView
        items={rows}
        {cursor}
        keyOf={(row, index) =>
          row.kind === 'heading'
            ? `heading-${row.label}`
            : row.kind === 'artist'
              ? row.artist.id
              : row.kind === 'album'
                ? row.album.id
                : `${row.track.id}-${index}`}
        ariaLabel="search results"
        onActivate={(row) => activate(row)}
        onLongPress={(row) => openActions(row)}
      >
        {#snippet row(entry, index)}
          {#if entry.kind === 'heading'}
            <span class="heading tui-upper">── {entry.label} ({entry.count})</span>
          {:else if entry.kind === 'artist'}
            <div class="result">
              <ArtistRow artist={entry.artist} />
              <span class="buttons">
                <button
                  class="mini"
                  title="queue the artist's loaded tracks"
                  onclick={(event) => {
                    event.stopPropagation();
                    void actions.playArtistNow(entry.artist);
                  }}>play</button
                >
                <button
                  class="mini"
                  title="favourite"
                  onclick={(event) => {
                    event.stopPropagation();
                    void actions.toggleArtistFavorite(entry.artist);
                  }}>★</button
                >
              </span>
            </div>
          {:else if entry.kind === 'album'}
            <div class="result">
              <AlbumRow album={entry.album} />
              <span class="buttons">
                <button
                  class="mini"
                  title="play album now"
                  onclick={(event) => {
                    event.stopPropagation();
                    void actions.playAlbumNow(entry.album);
                  }}>play</button
                >
                <button
                  class="mini"
                  title="add album to the end of the queue"
                  onclick={(event) => {
                    event.stopPropagation();
                    void actions.enqueueAlbum(entry.album, 'end');
                  }}>+end</button
                >
                <button
                  class="mini"
                  title="play album next"
                  onclick={(event) => {
                    event.stopPropagation();
                    void actions.enqueueAlbum(entry.album, 'next');
                  }}>next</button
                >
              </span>
            </div>
          {:else}
            <div class="result" class:playing={app.player.state.track?.id === entry.track.id}>
              <TrackRow track={entry.track} {index} showAlbum={true} />
              <span class="buttons">
                <button
                  class="mini"
                  title="add to the end of the queue"
                  onclick={(event) => {
                    event.stopPropagation();
                    actions.enqueueTrack(entry.track, 'end');
                  }}>+end</button
                >
                <button
                  class="mini"
                  title="play next"
                  onclick={(event) => {
                    event.stopPropagation();
                    actions.enqueueTrack(entry.track, 'next');
                  }}>next</button
                >
                <button
                  class="mini"
                  title="favourite"
                  onclick={(event) => {
                    event.stopPropagation();
                    void actions.toggleTrackFavorite(entry.track);
                  }}>★</button
                >
              </span>
            </div>
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
  .search {
    background: var(--bg-elev);
    border: 1px solid var(--border);
    padding: 0.25rem 0.5rem;
    color: var(--fg);
  }
  .search:focus {
    border-color: var(--accent);
  }
  .heading {
    color: var(--accent);
  }
  .result {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
  }
  .result.playing {
    color: var(--ok);
  }
  .buttons {
    display: inline-flex;
    gap: 0.25em;
    flex: none;
  }
  .mini {
    border: 1px solid var(--border);
    color: var(--fg-dim);
    padding: 0 0.3em;
    font-size: 0.9em;
  }
  .mini:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
</style>
