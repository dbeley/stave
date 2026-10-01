<!--
  Home: two panes side by side — random picks and recently added.
  Tab (or a click) moves the focus between them; j/k navigate the focused pane.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import AlbumRow from '$lib/components/AlbumRow.svelte';
  import ListView from '$lib/components/ListView.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import StateMessage from '$lib/components/StateMessage.svelte';
  import type { Album } from '$lib/domain/types';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import { albumListBindings } from '$lib/ui/albumKeys.svelte';
  import { actions } from '$lib/ui/actionsRegistry.svelte';

  const RANDOM = 'random';
  const RECENT = 'newest';

  let focus = $state(0);
  let randomCursor = new ListCursor();
  let recentCursor = new ListCursor();

  let randomSlice = $derived(app.library.list(RANDOM));
  let recentSlice = $derived(app.library.list(RECENT));

  let cursors = [randomCursor, recentCursor];
  let activeCursor = $derived(cursors[focus] ?? randomCursor);
  let activeAlbums = $derived<Album[]>(focus === 0 ? randomSlice.items : recentSlice.items);

  $effect(() => {
    void app.library.loadAlbumList(RANDOM);
    void app.library.loadAlbumList(RECENT);
  });

  onMount(() =>
    app.keyboard.registerAll([
      ...listNavigationBindings(activeCursor, { hint: true }),
      ...albumListBindings(activeCursor, () => activeAlbums),
      {
        keys: ['tab'],
        scope: 'page',
        group: 'navigation',
        description: 'switch pane',
        hint: true,
        run: () => {
          focus = (focus + 1) % cursors.length;
        },
      },
      {
        keys: ['r'],
        scope: 'page',
        group: 'navigation',
        description: 'reshuffle random picks',
        run: () => {
          void app.library.loadAlbumList(RANDOM, { refresh: true });
          app.toasts.info('reshuffled');
        },
      },
    ]),
  );
</script>

<main class="page">
  <Panel
    title="random"
    note={randomSlice.items.length}
    active={focus === 0}
    scroll={true}
    grow={true}
  >
    {#if randomSlice.items.length === 0 && randomSlice.loading}
      <StateMessage kind="loading" message="picking random albums" />
    {:else if randomSlice.error}
      <StateMessage
        kind="error"
        message="could not load random albums"
        detail={randomSlice.error}
      />
    {:else if randomSlice.items.length === 0}
      <StateMessage
        kind="empty"
        message="the library looks empty"
        hint="check the server's music folder"
      />
    {:else}
      <ListView
        items={randomSlice.items}
        cursor={randomCursor}
        keyOf={(album) => album.id}
        ariaLabel="random albums"
        onActivate={(album) => actions.openAlbum(album.id)}
      >
        {#snippet row(album)}
          <AlbumRow {album} />
        {/snippet}
      </ListView>
    {/if}
  </Panel>

  <Panel
    title="recently added"
    note={recentSlice.items.length}
    active={focus === 1}
    scroll={true}
    grow={true}
  >
    {#if recentSlice.items.length === 0 && recentSlice.loading}
      <StateMessage kind="loading" message="loading recently added" />
    {:else if recentSlice.error}
      <StateMessage
        kind="error"
        message="could not load recent albums"
        detail={recentSlice.error}
      />
    {:else if recentSlice.items.length === 0}
      <StateMessage
        kind="empty"
        message="no albums yet"
        hint="add music to the server and rescan"
      />
    {:else}
      <ListView
        items={recentSlice.items}
        cursor={recentCursor}
        keyOf={(album) => album.id}
        ariaLabel="recently added albums"
        onActivate={(album) => actions.openAlbum(album.id)}
      >
        {#snippet row(album)}
          <AlbumRow {album} />
        {/snippet}
      </ListView>
    {/if}
  </Panel>
</main>

<style>
  .page {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.55rem;
    flex: 1;
    min-height: 0;
    padding: 0.55rem;
  }
  @media (max-width: 720px) {
    .page {
      grid-template-columns: 1fr;
    }
  }
</style>
