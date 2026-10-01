<!-- One artist line. -->
<script lang="ts">
  import type { Artist } from '$lib/domain/types';
  import { app } from '$lib/app.svelte';
  import { countAlbums, truncate } from '$lib/utils/format';

  interface Props {
    artist: Artist;
    /** Show the A-Z index letter (only in the full index). */
    index?: string;
  }

  let { artist, index }: Props = $props();
  let starred = $derived(app.favorites.isArtistStarred(artist));
</script>

<div class="row">
  {#if index}<span class="index">{index}</span>{/if}
  <span class="name">{truncate(artist.name, 46)}</span>
  <span class="spacer"></span>
  <span class="dim count">{countAlbums(artist.albumCount)}</span>
  {#if starred}<span class="badge star" title="favourite">★</span>{/if}
</div>

<style>
  .row {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
    min-width: 0;
  }
  .index {
    flex: none;
    width: 2ch;
    color: var(--accent);
  }
  .name {
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
  .count {
    flex: none;
  }
  .badge {
    flex: none;
  }
  .star {
    color: var(--warn);
  }
</style>
