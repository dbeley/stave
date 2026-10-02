<script lang="ts">
  import type { FavoritesStore } from '$lib/stores/favorites.svelte';
  import type { Album, Track } from '$lib/domain/types';

  interface Props {
    store: FavoritesStore;
    track?: Track;
    album?: Album;
  }
  let { store, track, album }: Props = $props();

  let trackStar = $derived(track ? store.isTrackStarred(track) : false);
  let albumStar = $derived(album ? store.isAlbumStarred(album) : false);
</script>

<span data-testid="track">{trackStar ? 'starred' : 'plain'}</span>
<span data-testid="album">{albumStar ? 'starred' : 'plain'}</span>
