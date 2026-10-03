<!--
  Favorites: everything the server reports as starred.

  Three sections, one per entity kind, switched with tab/shift+tab exactly like
  the artist page's panes. Being separate panes rather than one flat list means
  each keeps its own cursor, so `j`/`k` never walk you across a section boundary
  into a different kind of row — and the counts stay visible in the heading bar.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import AlbumRow from '$lib/components/AlbumRow.svelte';
  import ArtistRow from '$lib/components/ArtistRow.svelte';
  import ListView from '$lib/components/ListView.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import StateMessage from '$lib/components/StateMessage.svelte';
  import TabStrip from '$lib/components/TabStrip.svelte';
  import TrackRow from '$lib/components/TrackRow.svelte';
  import type { Album, Artist, Track } from '$lib/domain/types';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import { tabBindings } from '$lib/keyboard/tabs';
  import type { Binding } from '$lib/keyboard/registry.svelte';
  import { actions } from '$lib/ui/actionsRegistry.svelte';

  /** 0 artists · 1 albums · 2 tracks — the order the sections are shown in. */
  const SECTIONS = [
    { id: 'artists', label: 'artists' },
    { id: 'albums', label: 'albums' },
    { id: 'tracks', label: 'tracks' },
  ] as const;
  const SECTION_IDS: string[] = SECTIONS.map((section) => section.id);

  // Still numeric: every pane's bindings are guarded with `when: () => focus === n`.
  let focus = $state(0);

  function selectSection(id: string): void {
    const index = SECTION_IDS.indexOf(id);
    if (index >= 0) focus = index;
  }
  let artistCursor = new ListCursor();
  let albumCursor = new ListCursor();
  let trackCursor = new ListCursor();

  let favorites = $derived(app.favorites.state);
  let total = $derived(
    favorites.artists.length + favorites.albums.length + favorites.tracks.length,
  );
  let counts = $derived([
    favorites.artists.length,
    favorites.albums.length,
    favorites.tracks.length,
  ]);
  /** The strip's view of the sections: one entry per section, with its count. */
  let tabs = $derived(SECTIONS.map((section, index) => ({ ...section, count: counts[index] })));

  function openArtist(artist: Artist): void {
    actions.openArtist(artist.id);
  }

  function openAlbum(album: Album): void {
    actions.openAlbum(album.id);
  }

  /**
   * Only the focused pane's bindings are live, so keys never cross sections.
   *
   * The parameter is generic and returns the same element type: widening to
   * `Binding[]` would erase the item type `listNavigationBindings` carries for
   * `onActivate`, which is what produced "implicitly has an 'any' type" errors.
   */
  function guarded<B extends Binding>(bindings: B[], pane: number): B[] {
    return bindings.map((binding) => ({ ...binding, when: () => focus === pane }));
  }

  function queueAlbum(mode: 'end' | 'next', album: Album): void {
    void actions.enqueueAlbum(album, mode);
  }

  // Starred entities are cheap to re-fetch and de-duplicated by the store.
  $effect(() => {
    void app.favorites.load();
  });

  onMount(() =>
    app.keyboard.registerAll([
      // ---- artists (pane 0) ----
      ...guarded(
        [
          ...listNavigationBindings(artistCursor, {
            hint: true,
            onActivate: (artist: Artist) => openArtist(artist),
          }),
          {
            keys: ['f'],
            scope: 'page',
            group: 'favorites',
            description: 'unfavourite',
            run: () => {
              const artist = artistCursor.selected(favorites.artists);
              if (artist) void actions.toggleArtistFavorite(artist);
            },
          },
          {
            keys: ['o'],
            scope: 'page',
            group: 'favorites',
            description: 'actions',
            run: () => {
              const artist = artistCursor.selected(favorites.artists);
              if (artist) actions.openArtistActions(artist);
            },
          },
        ],
        0,
      ),
      // ---- albums (pane 1) ----
      ...guarded(
        [
          ...listNavigationBindings(albumCursor, {
            hint: true,
            onActivate: (album: Album) => openAlbum(album),
          }),
          {
            keys: ['a'],
            scope: 'page',
            group: 'favorites',
            description: 'add to queue',
            run: () => {
              const album = albumCursor.selected(favorites.albums);
              if (album) queueAlbum('end', album);
            },
          },
          {
            keys: ['f'],
            scope: 'page',
            group: 'favorites',
            description: 'unfavourite',
            run: () => {
              const album = albumCursor.selected(favorites.albums);
              if (album) void actions.toggleAlbumFavorite(album);
            },
          },
          {
            keys: ['L'],
            scope: 'page',
            group: 'favorites',
            description: 'listen later',
            run: () => {
              const album = albumCursor.selected(favorites.albums);
              if (album) actions.toggleListenLater(album);
            },
          },
          {
            keys: ['o'],
            scope: 'page',
            group: 'favorites',
            description: 'actions',
            run: () => {
              const album = albumCursor.selected(favorites.albums);
              if (album) actions.openAlbumActions(album);
            },
          },
        ],
        1,
      ),
      // ---- tracks (pane 2) ----
      ...guarded(
        [
          ...listNavigationBindings(trackCursor, {
            hint: true,
            onActivate: (track: Track, index: number) => {
              void actions.playTrackNow(track, {
                tracks: favorites.tracks,
                index,
                label: 'favourites',
              });
            },
          }),
          {
            keys: ['a'],
            scope: 'page',
            group: 'favorites',
            description: 'add to queue',
            run: () => {
              const track = trackCursor.selected(favorites.tracks);
              if (track) actions.enqueueTrack(track, 'end');
            },
          },
          {
            keys: ['f'],
            scope: 'page',
            group: 'favorites',
            description: 'unfavourite',
            run: () => {
              const track = trackCursor.selected(favorites.tracks);
              if (track) void actions.toggleTrackFavorite(track);
            },
          },
          {
            keys: ['L'],
            scope: 'page',
            group: 'favorites',
            description: 'listen later',
            run: () => {
              const track = trackCursor.selected(favorites.tracks);
              if (track) void actions.toggleListenLaterForTrack(track);
            },
          },
          {
            keys: ['o'],
            scope: 'page',
            group: 'favorites',
            description: 'actions',
            run: () => {
              const track = trackCursor.selected(favorites.tracks);
              if (track) actions.openTrackActions(track);
            },
          },
        ],
        2,
      ),
      // ---- pane switching ----
      ...tabBindings({
        ids: SECTION_IDS,
        active: () => SECTION_IDS[focus] ?? 'artists',
        onSelect: selectSection,
      }),
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
      <!--
        The section bar is the tab strip: counts on every section, so you can see
        what is where without visiting each one.
      -->
      <TabStrip
        {tabs}
        active={SECTION_IDS[focus] ?? 'artists'}
        onSelect={selectSection}
        ariaLabel="favourite sections"
        tip="tab switches section"
      />

      {#if focus === 0}
        {#if favorites.artists.length === 0}
          <p class="empty-note">└─ no starred artists</p>
        {:else}
          <ListView
            items={favorites.artists}
            cursor={artistCursor}
            keyOf={(artist) => artist.id}
            ariaLabel="favourite artists"
            onActivate={(artist) => openArtist(artist)}
            onLongPress={(artist) => actions.openArtistActions(artist)}
          >
            {#snippet row(artist)}
              <ArtistRow {artist} />
            {/snippet}
          </ListView>
        {/if}
      {:else if focus === 1}
        {#if favorites.albums.length === 0}
          <p class="empty-note">└─ no starred albums</p>
        {:else}
          <ListView
            items={favorites.albums}
            cursor={albumCursor}
            keyOf={(album) => album.id}
            ariaLabel="favourite albums"
            onActivate={(album) => openAlbum(album)}
            onLongPress={(album) => actions.openAlbumActions(album)}
          >
            {#snippet row(album)}
              <AlbumRow {album} />
            {/snippet}
          </ListView>
        {/if}
      {:else if favorites.tracks.length === 0}
        <p class="empty-note">└─ no starred tracks</p>
      {:else}
        <ListView
          items={favorites.tracks}
          cursor={trackCursor}
          keyOf={(track, index) => `${track.id}-${index}`}
          ariaLabel="favourite tracks"
          onActivate={(track, index) =>
            void actions.playTrackNow(track, {
              tracks: favorites.tracks,
              index,
              label: 'favourites',
            })}
          onLongPress={(track) => actions.openTrackActions(track)}
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
  .empty-note {
    color: var(--fg-faint);
  }
</style>
