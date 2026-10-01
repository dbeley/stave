<!-- One album line, in the form every album list uses. -->
<script lang="ts">
  import type { Album } from '$lib/domain/types';
  import { app } from '$lib/app.svelte';
  import { truncate } from '$lib/utils/format';

  interface Props {
    album: Album;
    selected?: boolean;
    /** Show the artist column (off inside an artist page). */
    showArtist?: boolean;
  }

  let { album, showArtist = true }: Props = $props();

  let starred = $derived(app.favorites.isAlbumStarred(album));
  let listenLater = $derived(app.listenLater.has(album.id));
  let caching = $derived(app.settings.state.offlineCacheEnabled && listenLater);
  let cached = $derived(app.downloads.isCached(album.id));
</script>

<div class="row">
  <span class="name">{truncate(album.name, 46)}</span>
  {#if showArtist && album.artistName}
    <span class="dim artist">{truncate(album.artistName, 24)}</span>
  {/if}
  <span class="spacer"></span>
  {#if album.year}<span class="dim year">{album.year}</span>{/if}
  {#if album.songCount}<span class="dim count">{album.songCount}♫</span>{/if}
  {#if starred}<span class="badge star" title="favourite">★</span>{/if}
  {#if listenLater}
    <span class="badge later" title={caching ? 'listen later (caching)' : 'listen later'}>
      {caching ? '⇣' : '⌂'}
    </span>
  {/if}
  {#if cached}<span class="badge cached" title="available offline">▣</span>{/if}
</div>

<style>
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
  .artist {
    flex: none;
    max-width: 26ch;
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
  .year,
  .count {
    flex: none;
  }
  .badge {
    flex: none;
  }
  .star {
    color: var(--warn);
  }
  .later {
    color: var(--accent);
  }
  .cached {
    color: var(--ok);
  }
</style>
