<!--
  Album list: random, recently added, A-Z and friends.
 *
 * The sort is part of the route (`#/albums?sort=…`) so it is linkable and the
 * browser back button behaves. `z` / `Z` cycle the sort from the keyboard.
 -->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import AlbumRow from '$lib/components/AlbumRow.svelte';
  import ListView from '$lib/components/ListView.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import StateMessage from '$lib/components/StateMessage.svelte';
  import { SORT_OPTIONS, nextSort, sortOption } from '$lib/domain/sort';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import { albumListBindings } from '$lib/ui/albumKeys.svelte';
  import { actions } from '$lib/ui/actionsRegistry.svelte';

  let route = $derived(app.router.current);
  let sort = $derived(route.name === 'albums' ? route.sort : 'newest');
  let slice = $derived(app.library.list(sort));
  let option = $derived(sortOption(sort));
  let cursor = new ListCursor();

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
      {
        keys: ['z'],
        scope: 'page',
        group: 'album',
        description: 'next sort order',
        run: () => app.router.navigate({ name: 'albums', sort: nextSort(sort, 1) }),
      },
      {
        keys: ['Z'],
        scope: 'page',
        group: 'album',
        description: 'previous sort order',
        run: () => app.router.navigate({ name: 'albums', sort: nextSort(sort, -1) }),
      },
    ]),
  );
</script>

<main class="page">
  <nav class="tabs" aria-label="sort order">
    {#each SORT_OPTIONS as tab (tab.id)}
      <button
        class="tab"
        class:active={tab.id === sort}
        title="{tab.label} ({tab.hint})"
        onclick={() => app.router.navigate({ name: 'albums', sort: tab.id })}
      >
        {tab.label}
      </button>
    {/each}
    <span class="spacer"></span>
    <span class="dim"
      >{slice.items.length} loaded{#if slice.loading}
        · loading…{/if}</span
    >
  </nav>

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
        hint="press z to try another sort, or check the server library"
      />
    {:else}
      <ListView
        items={slice.items}
        {cursor}
        keyOf={(album) => album.id}
        ariaLabel="albums"
        onActivate={(album) => actions.openAlbum(album.id)}
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
  .tabs {
    display: flex;
    align-items: center;
    gap: 0.3em;
    flex-wrap: wrap;
  }
  .tab {
    border: 1px solid var(--border);
    padding: 0.1rem 0.5rem;
    color: var(--fg-dim);
  }
  .tab:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .tab.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
    font-weight: 700;
  }
  .spacer {
    flex: 1;
  }
  .dim {
    color: var(--fg-faint);
  }
  .more {
    margin: 0.4rem 0 0;
    color: var(--fg-faint);
  }
</style>
