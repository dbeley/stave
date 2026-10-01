<!-- One track line. Used by album pages, playlists, search and the queue. -->
<script lang="ts">
  import type { Track } from '$lib/domain/types';
  import { app } from '$lib/app.svelte';
  import { formatDuration, truncate } from '$lib/utils/format';

  interface Props {
    track: Track;
    index?: number;
    /** Show the album column (search results do, album pages do not). */
    showAlbum?: boolean;
    /** Show bitrate/format columns (settings → technical columns). */
    technical?: boolean;
  }

  let { track, index, showAlbum = false, technical = false }: Props = $props();

  let starred = $derived(app.favorites.isTrackStarred(track));
  let cached = $derived(app.resolver.isCached(track.id));
  let playing = $derived(app.player.state.track?.id === track.id);
</script>

<div class="row">
  {#if index !== undefined}
    <span class="number">{track.trackNumber ?? index + 1}</span>
  {/if}
  <span class="indicator" title={playing ? 'now playing' : ''}>{playing ? '▶' : ''}</span>
  <span class="title">{truncate(track.title, 44)}</span>
  {#if showAlbum && track.albumName}
    <span class="dim album">{truncate(track.albumName, 24)}</span>
  {/if}
  <span class="spacer"></span>
  {#if technical}
    <span class="dim tech">
      {track.suffix?.toUpperCase() ?? '?'}{#if track.bitRate}
        {track.bitRate}k{/if}
    </span>
  {/if}
  {#if starred}<span class="badge star" title="favourite">★</span>{/if}
  {#if cached}<span class="badge cached" title="available offline">▣</span>{/if}
  <span class="duration">{formatDuration(track.durationSec)}</span>
</div>

<style>
  .row {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
    min-width: 0;
  }
  .number {
    flex: none;
    width: 3ch;
    text-align: right;
    color: var(--fg-faint);
  }
  .indicator {
    flex: none;
    width: 1.2em;
    color: var(--ok);
  }
  .title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .album {
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
  .tech {
    flex: none;
  }
  .badge {
    flex: none;
  }
  .star {
    color: var(--warn);
  }
  .cached {
    color: var(--ok);
  }
  .duration {
    flex: none;
    color: var(--fg-dim);
  }
</style>
