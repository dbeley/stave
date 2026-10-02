<!--
  Album page: cover, metadata and the track list.
 *
 * Album-level actions live on capital keys (P/A/F/L) so they never collide with
 * the per-track actions underneath (enter/a/f/o/y).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import AsciiArt from '$lib/components/AsciiArt.svelte';
  import ListView from '$lib/components/ListView.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import StateMessage from '$lib/components/StateMessage.svelte';
  import TrackRow from '$lib/components/TrackRow.svelte';
  import { countTracks, formatLongDuration } from '$lib/utils/format';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import { trackListBindings } from '$lib/ui/trackKeys.svelte';
  import { actions } from '$lib/ui/actionsRegistry.svelte';
  import { coverArtUrl } from '$lib/ui/coverArt';

  let id = $derived(app.router.current.name === 'album' ? app.router.current.id : '');
  let slice = $derived(app.library.albumDetail(id));
  let album = $derived(slice.album);
  let tracks = $derived(album?.tracks ?? []);
  let cursor = new ListCursor();

  let starred = $derived(album ? app.favorites.isAlbumStarred(album) : false);
  let listenLater = $derived(album ? app.listenLater.has(album.id) : false);
  let cached = $derived(album ? app.downloads.isCached(album.id) : false);

  $effect(() => {
    void app.library.loadAlbum(id);
  });

  onMount(() =>
    app.keyboard.registerAll([
      ...listNavigationBindings(cursor, { hint: true }),
      ...trackListBindings(cursor, () => tracks, {
        context: () => (album ? { tracks, index: cursor.index, label: album.name } : undefined),
      }),
      // ---- album-level actions (capital keys, no collision with tracks) ----
      {
        keys: ['P'],
        scope: 'page',
        group: 'album',
        description: 'play the whole album',
        run: () => {
          if (album) void actions.playAlbumNow(album);
        },
      },
      {
        keys: ['A'],
        scope: 'page',
        group: 'album',
        description: 'add album to queue',
        run: () => {
          if (album) void actions.enqueueAlbum(album, 'end');
        },
      },
      {
        keys: ['F'],
        scope: 'page',
        group: 'album',
        description: 'toggle album favourite',
        run: () => {
          if (album) void actions.toggleAlbumFavorite(album);
        },
      },
      {
        keys: ['L'],
        scope: 'page',
        group: 'album',
        description: 'toggle listen later',
        run: () => {
          if (album) actions.toggleListenLater(album);
        },
      },
      {
        keys: ['o'],
        scope: 'page',
        group: 'album',
        description: 'album / track actions',
        run: () => {
          if (album) actions.openAlbumActions(album);
        },
      },
      {
        keys: ['y'],
        scope: 'page',
        group: 'album',
        description: 'go to artist',
        run: () => {
          if (album?.artistId) actions.openArtist(album.artistId);
        },
      },
    ]),
  );
</script>

<main class="page">
  {#if slice.error}
    <Panel title="album" grow={true}>
      <StateMessage
        kind="error"
        message="could not load this album"
        detail={slice.error}
        hint="press R to retry"
      />
    </Panel>
  {:else if !album}
    <Panel title="album" grow={true}>
      <StateMessage kind="loading" message="loading album" />
    </Panel>
  {:else}
    <div class="columns">
      <Panel title="cover" note={cached ? 'offline' : ''}>
        <div class="cover">
          <AsciiArt
            src={coverArtUrl(album.coverArtId, 600)}
            seed={album.id}
            columns={44}
            color={app.settings.state.asciiCoverArt}
          />
        </div>
      </Panel>

      <Panel title="metadata" grow={true}>
        <h1 class="name">{album.name}</h1>
        <dl class="meta">
          <dt>artist</dt>
          <dd>
            {#if album.artistId}
              <button class="link" onclick={() => actions.openArtist(album.artistId!)}>
                {album.artistName ?? 'unknown'}
              </button>
            {:else}
              {album.artistName ?? 'unknown'}
            {/if}
          </dd>
          {#if album.year}
            <dt>year</dt>
            <dd>{album.year}</dd>
          {/if}
          {#if album.genre}
            <dt>genre</dt>
            <dd>{album.genre}</dd>
          {/if}
          <dt>tracks</dt>
          <dd>{countTracks(album.songCount)} · {formatLongDuration(album.durationSec)}</dd>
          {#if album.playCount !== undefined}
            <dt>plays</dt>
            <dd>{album.playCount}</dd>
          {/if}
          <dt>flags</dt>
          <dd>
            <span class:on={starred}>{starred ? '★ favourite' : '☆ not favourite'}</span>
            <span class="sep">·</span>
            <span class:on={listenLater}>{listenLater ? '⌂ listen later' : 'not listen later'}</span
            >
          </dd>
        </dl>

        <div class="toolbar">
          <button class="button" onclick={() => void actions.playAlbumNow(album)}>[P] play</button>
          <button class="button" onclick={() => void actions.enqueueAlbum(album, 'end')}>
            [A] queue
          </button>
          <button class="button" onclick={() => void actions.enqueueAlbum(album, 'next')}>
            next
          </button>
          <button class="button" onclick={() => void actions.toggleAlbumFavorite(album)}>
            [F] {starred ? 'unstar' : 'star'}
          </button>
          <button class="button" onclick={() => actions.toggleListenLater(album)}>
            [L] listen later
          </button>
        </div>
      </Panel>
    </div>

    <Panel
      title="tracks"
      note={tracks.length ? `${cursor.index + 1}/${tracks.length}` : ''}
      active={true}
      scroll={true}
      grow={true}
    >
      {#if tracks.length === 0}
        <StateMessage
          kind="empty"
          message="this album reports no tracks"
          hint="the server may still be scanning"
        />
      {:else}
        <ListView
          items={tracks}
          {cursor}
          keyOf={(track) => track.id}
          ariaLabel="album tracks"
          onActivate={(track, index) =>
            void actions.playTrackNow(track, { tracks, index, label: album.name })}
          onLongPress={(track) => actions.openTrackActions(track)}
        >
          {#snippet row(track, index)}
            <TrackRow {track} {index} technical={app.settings.state.showTechnicalColumns} />
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
  .columns {
    display: grid;
    grid-template-columns: minmax(220px, 34ch) 1fr;
    gap: 0.5rem;
    align-items: start;
  }
  @media (max-width: 640px) {
    .columns {
      grid-template-columns: 1fr;
    }
  }
  .cover {
    display: flex;
    justify-content: center;
    overflow: hidden;
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
  .on {
    color: var(--accent);
  }
  .sep {
    color: var(--border-focus);
    margin: 0 0.4em;
  }
  .link {
    color: var(--accent);
    text-decoration: underline;
  }
  .toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3em;
    margin-top: 0.6rem;
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
</style>
