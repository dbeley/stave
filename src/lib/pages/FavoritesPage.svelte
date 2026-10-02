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
  import TrackRow from '$lib/components/TrackRow.svelte';
  import type { Album, Artist, Track } from '$lib/domain/types';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import type { Binding } from '$lib/keyboard/registry.svelte';
  import { actions } from '$lib/ui/actionsRegistry.svelte';

  /** 0 artists · 1 albums · 2 tracks — the order the sections are shown in. */
  const PANES = 3;
  const LABELS = ['artists', 'albums', 'tracks'] as const;

  let focus = $state(0);
  let artistCursor = new ListCursor();
  let albumCursor = new ListCursor();
  let trackCursor = new ListCursor();

  let favorites = $derived(app.favorites.state);
  let total = $derived(
    favorites.artists.length + favorites.albums.length + favorites.tracks.length,
  );
  let counts = $derived([favorites.artists.length, favorites.albums.length, favorites.tracks.length]);

  let cursors = [artistCursor, albumCursor, trackCursor];
  let activeCursor = $derived(cursors[focus] ?? artistCursor);

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
            keys: ['n'],
            scope: 'page',
            group: 'favorites',
            description: 'play next',
            run: () => {
              const album = albumCursor.selected(favorites.albums);
              if (album) queueAlbum('next', album);
            },
          },
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
            keys: ['n'],
            scope: 'page',
            group: 'favorites',
            description: 'play next',
            run: () => {
              const track = trackCursor.selected(favorites.tracks);
              if (track) actions.enqueueTrack(track, 'next');
            },
          },
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
      {
        keys: ['tab'],
        scope: 'page',
        group: 'navigation',
        description: 'next section',
        hint: true,
        run: () => {
          focus = (focus + 1) % PANES;
        },
      },
      {
        keys: ['shift+tab'],
        scope: 'page',
        group: 'navigation',
        description: 'previous section',
        run: () => {
          focus = (focus + PANES - 1) % PANES;
        },
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
      <!--
        The section bar doubles as the tab strip: counts on every section, so you
        can see what is where without visiting each one.
      -->
      <div class="tabs" role="tablist" aria-label="favourite sections">
        {#each LABELS as label, index (label)}
          <button
            type="button"
            class="tab"
            class:active={focus === index}
            role="tab"
            aria-selected={focus === index}
            onclick={() => (focus = index)}
            data-pane={index}
          >
            {label} <span class="count">{counts[index]}</span>
          </button>
        {/each}
        <span class="spacer"></span>
        <span class="tip dim">tab switches section</span>
      </div>

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
  .tabs {
    display: flex;
    align-items: center;
    gap: 0.4em;
    margin-bottom: 0.3rem;
    border-bottom: 1px solid var(--border);
    padding-bottom: 0.25rem;
  }
  .tab {
    background: none;
    border: none;
    border-left: 2px solid transparent;
    padding: 0.1rem 0.5rem;
    font: inherit;
    color: var(--fg-dim);
    cursor: pointer;
  }
  .tab.active {
    color: var(--accent);
    border-left-color: var(--accent);
    background: var(--bg-elev-2);
  }
  .count {
    color: var(--fg-faint);
  }
  .tab.active .count {
    color: var(--accent-dim);
  }
  .spacer {
    flex: 1;
  }
  .tip {
    font-size: 0.9em;
  }
  /* Key hints are noise where the keys do not exist. */
  @media (pointer: coarse) {
    .tip {
      display: none;
    }
  }
  .empty-note {
    color: var(--fg-faint);
  }
</style>
