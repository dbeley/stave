<!--
  Album list: random, recently added, A-Z and friends.

  The sort is part of the route (`#/albums?sort=…`) so it is linkable and the
  browser back button behaves.

  The sort orders are tabs and answer to `tab` / `shift+tab`, the same keys as
  every other tabbed view — they used to be on `z` / `Z`. `z` still cycles to the
  next order from anywhere: that is a global shortcut, and the toast it shows
  makes it read as a command rather than a tab move.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import AlbumRow from '$lib/components/AlbumRow.svelte';
  import ListView from '$lib/components/ListView.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import StateMessage from '$lib/components/StateMessage.svelte';
  import TabStrip from '$lib/components/TabStrip.svelte';
  import { SORT_OPTIONS, sortOption, type AlbumListSort } from '$lib/domain/sort';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import { tabBindings } from '$lib/keyboard/tabs';
  import { albumListBindings } from '$lib/ui/albumKeys.svelte';
  import { actions } from '$lib/ui/actionsRegistry.svelte';

  let route = $derived(app.router.current);
  let sort = $derived(route.name === 'albums' ? route.sort : 'newest');
  let slice = $derived(app.library.list(sort));
  let option = $derived(sortOption(sort));
  let cursor = new ListCursor();

  const SORT_IDS: string[] = SORT_OPTIONS.map((entry) => entry.id);
  const SORT_TABS = SORT_OPTIONS.map((entry) => ({ id: entry.id, label: entry.label }));

  /** Selecting a tab is a navigation, because the sort lives in the route. */
  function selectSort(id: string): void {
    // Ids come from SORT_OPTIONS, so this is the route's own sort type.
    app.router.navigate({ name: 'albums', sort: id as AlbumListSort });
  }

  // Load on first visit or when the sort changes.
  $effect(() => {
    void app.library.loadAlbumList(sort);
  });

  // Fetch the next page when the cursor reaches the end of a paginated list.
  $effect(() => {
    if (!option.paginated) return;
    if (cursor.index >= slice.items.length - 2 && slice.hasMore && !slice.loading) {
      void app.library.loadMoreAlbums(sort);
    }
  });

  onMount(() =>
    app.keyboard.registerAll([
      ...listNavigationBindings(cursor, { hint: true }),
      ...albumListBindings(cursor, () => slice.items, {
        onOpen: (album) => actions.openAlbum(album.id),
      }),
      ...tabBindings({ ids: SORT_IDS, active: () => sort, onSelect: selectSort }),
    ]),
  );
</script>

<main class="page">
  <TabStrip
    tabs={SORT_TABS}
    active={sort}
    onSelect={selectSort}
    ariaLabel="sort order"
    note="{slice.items.length} loaded{slice.loading ? ' · loading…' : ''}"
    tip="tab switches sort"
  />

  <Panel
    title="albums"
    note="{option.label}{slice.items.length ? ` · ${slice.items.length}` : ''}"
    active={true}
    scroll={true}
    grow={true}
  >
    {#if slice.error}
      <StateMessage
        kind="error"
        message="could not load albums"
        detail={slice.error}
        hint="press R to retry"
      />
    {:else if slice.items.length === 0 && slice.loading}
      <StateMessage kind="loading" message="loading albums" />
    {:else if slice.items.length === 0}
      <StateMessage
        kind="empty"
        message="no albums for this sort order"
        hint="press tab for another sort order, or check the server library"
      />
    {:else}
      <ListView
        items={slice.items}
        {cursor}
        keyOf={(album) => album.id}
        ariaLabel="albums"
        onActivate={(album) => actions.openAlbum(album.id)}
        onLongPress={(album) => actions.openAlbumActions(album)}
      >
        {#snippet row(album)}
          <AlbumRow {album} />
        {/snippet}
      </ListView>
      {#if slice.hasMore && !slice.loading}
        <p class="more">… more below (scroll past the end to load)</p>
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
  .more {
    margin: 0.4rem 0 0;
    color: var(--fg-faint);
  }
</style>
