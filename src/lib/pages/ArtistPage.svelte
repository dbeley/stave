<!--
  Artist page: overview, discography, top tracks, biography, similar artists.
 *
 * Three lists share the pane, so focus (Tab) decides whose cursor moves: each
 * list's bindings carry a `when` guard on `focus`. Artist-level actions live on
 * capital keys (P/F) so they never collide with the per-item actions, exactly
 * as the album page does.
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
  import { countAlbums } from '$lib/utils/format';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import type { Binding } from '$lib/keyboard/registry.svelte';
  import { albumListBindings } from '$lib/ui/albumKeys.svelte';
  import { actions } from '$lib/ui/actionsRegistry.svelte';
  import { trackListBindings } from '$lib/ui/trackKeys.svelte';

  const PANES = 3; // 0 albums · 1 top tracks · 2 similar artists

  let id = $derived(app.router.current.name === 'artist' ? app.router.current.id : '');
  let slice = $derived(app.library.artistDetail(id));
  let artist = $derived(slice.artist);
  let albums = $derived(slice.albums);
  let topSongs = $derived(slice.topSongs);
  let bio = $derived(slice.bio);
  let similar = $derived(bio?.similarArtists ?? []);
  let starred = $derived(artist ? app.favorites.isArtistStarred(artist) : false);

  let focus = $state(0);
  let albumCursor = new ListCursor();
  let trackCursor = new ListCursor();
  let similarCursor = new ListCursor();

  /** Only the focused pane's bindings are live. */
  function guarded(bindings: Binding[], pane: number): Binding[] {
    return bindings.map((binding) => ({ ...binding, when: () => focus === pane }));
  }

  function openSimilar(): void {
    const next = similarCursor.selected(similar);
    if (next) actions.openArtist(next.id);
  }

  $effect(() => {
    void app.library.loadArtist(id);
  });

  onMount(() =>
    app.keyboard.registerAll([
      // ---- albums (pane 0) ----
      ...guarded(
        [
          ...listNavigationBindings(albumCursor, { hint: true }),
          ...albumListBindings(albumCursor, () => albums),
        ],
        0,
      ),
      // ---- top tracks (pane 1) ----
      ...guarded(
        [
          ...listNavigationBindings(trackCursor, { hint: true }),
          ...trackListBindings(trackCursor, () => topSongs, {
            context: () =>
              artist
                ? { tracks: topSongs, index: trackCursor.index, label: artist.name }
                : undefined,
          }),
        ],
        1,
      ),
      // ---- similar artists (pane 2) ----
      ...guarded(listNavigationBindings(similarCursor, { hint: true, onActivate: openSimilar }), 2),
      // …and the similar pane owns `o`/`f` for the artist under its cursor. The
      // page-level `o` further down is for the artist being viewed; without this
      // it swallowed the key here, so hovering a similar artist and asking for
      // actions got you the page's artist instead.
      ...guarded(
        [
          {
            keys: ['o'],
            scope: 'page' as const,
            group: 'similar artist',
            description: 'artist actions',
            run: () => {
              const next = similarCursor.selected(similar);
              if (next) actions.openArtistActions(next);
            },
          },
          {
            keys: ['f'],
            scope: 'page' as const,
            group: 'similar artist',
            description: 'toggle favourite',
            run: () => {
              const next = similarCursor.selected(similar);
              if (next) void actions.toggleArtistFavorite(next);
            },
          },
        ],
        2,
      ),
      {
        keys: ['tab'],
        scope: 'page',
        group: 'navigation',
        description: 'switch pane',
        hint: true,
        run: () => {
          focus = (focus + 1) % PANES;
        },
      },
      // ---- artist-level actions (capital keys) ----
      {
        keys: ['P'],
        scope: 'page',
        group: 'artist',
        description: 'play the whole artist',
        run: () => {
          if (artist) void actions.playArtistNow(artist);
        },
      },
      {
        keys: ['F'],
        scope: 'page',
        group: 'artist',
        description: 'toggle artist favourite',
        run: () => {
          if (artist) void actions.toggleArtistFavorite(artist);
        },
      },
      {
        keys: ['o'],
        scope: 'page',
        group: 'artist',
        description: 'artist actions',
        run: () => {
          if (artist) actions.openArtistActions(artist);
        },
      },
    ]),
  );
</script>

<main class="page">
  {#if slice.error}
    <Panel title="artist" grow={true}>
      <StateMessage
        kind="error"
        message="could not load this artist"
        detail={slice.error}
        hint="press R to retry"
      />
    </Panel>
  {:else if !artist}
    <Panel title="artist" grow={true}>
      <StateMessage kind="loading" message="loading artist" />
    </Panel>
  {:else}
    <Panel title="artist" note={`${countAlbums(artist.albumCount)}`}>
      <h1 class="name">{artist.name}</h1>
      <div class="flags">
        <span class:on={starred}>{starred ? '★ favourite' : '☆ not favourite'}</span>
      </div>
      <div class="toolbar">
        <button class="button" onclick={() => void actions.playArtistNow(artist)}>[P] play</button>
        <button class="button" onclick={() => void actions.toggleArtistFavorite(artist)}>
          [F] {starred ? 'unstar' : 'star'}
        </button>
      </div>
    </Panel>

    <div class="columns">
      <Panel title="albums" note={albums.length} active={focus === 0} scroll={true} grow={true}>
        {#if albums.length === 0}
          <StateMessage kind="empty" message="no albums for this artist" />
        {:else}
          <ListView
            items={albums}
            cursor={albumCursor}
            keyOf={(album) => album.id}
            ariaLabel="artist albums"
            onActivate={(album) => actions.openAlbum(album.id)}
          >
            {#snippet row(album)}
              <AlbumRow {album} />
            {/snippet}
          </ListView>
        {/if}
      </Panel>

      <Panel
        title="top tracks"
        note={topSongs.length}
        active={focus === 1}
        scroll={true}
        grow={true}
      >
        {#if topSongs.length === 0}
          <StateMessage
            kind="empty"
            message="no top tracks"
            hint="this server did not return any"
          />
        {:else}
          <ListView
            items={topSongs}
            cursor={trackCursor}
            keyOf={(track) => track.id}
            ariaLabel="artist top tracks"
            onActivate={(track, index) =>
              void actions.playTrackNow(track, {
                tracks: topSongs,
                index,
                label: artist.name,
              })}
          >
            {#snippet row(track, index)}
              <TrackRow {track} {index} technical={app.settings.state.showTechnicalColumns} />
            {/snippet}
          </ListView>
        {/if}
      </Panel>

      <Panel title="biography" scroll={true} grow={true}>
        {#if slice.bioUnavailable || !bio?.biography}
          <StateMessage
            kind="info"
            message="no biography available"
            hint="this server has no Last.fm artist metadata configured"
          />
        {:else}
          <p class="bio">{bio.biography}</p>
        {/if}
      </Panel>

      <Panel
        title="similar artists"
        note={similar.length}
        active={focus === 2}
        scroll={true}
        grow={true}
      >
        {#if similar.length === 0}
          <StateMessage kind="empty" message="no similar artists" />
        {:else}
          <ListView
            items={similar}
            cursor={similarCursor}
            keyOf={(entry) => entry.id}
            ariaLabel="similar artists"
            onActivate={(entry) => actions.openArtist(entry.id)}
          >
            {#snippet row(entry)}
              <ArtistRow artist={entry} />
            {/snippet}
          </ListView>
        {/if}
      </Panel>
    </div>
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
  .columns {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-auto-rows: minmax(8rem, 1fr);
    gap: 0.5rem;
    flex: 1;
    min-height: 0;
  }
  @media (max-width: 720px) {
    .columns {
      grid-template-columns: 1fr;
    }
  }
  .name {
    margin: 0 0 0.3rem;
    font-size: 1.15rem;
    color: var(--accent);
  }
  .flags {
    color: var(--fg-dim);
  }
  .on {
    color: var(--accent);
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3em;
    margin-top: 0.5rem;
  }
  .button {
    border: 1px solid var(--border);
    padding: 0.1rem 0.45rem;
    color: var(--fg-dim);
  }
  .button:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .bio {
    margin: 0;
    white-space: pre-wrap;
    color: var(--fg-dim);
  }
</style>
