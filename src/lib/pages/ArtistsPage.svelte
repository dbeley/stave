<!--
  Artists: the A-Z index.
 *
 * The server returns the artists bucketed by index letter. The page flattens
 * that into one navigable list — a heading row per letter, then its artists —
 * and skips the headings when moving the cursor (same trick as SearchPage).
 * Typing a letter jumps straight to that bucket.
 *
 * The list is virtualised: a real library can hold thousands of artists, and
 * rendering every row costs seconds of paint and makes each cursor move re-render
 * the lot. Only the rows near the viewport are built; the A-Z index still jumps,
 * because the cursor moves and the window follows it.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import ArtistRow from '$lib/components/ArtistRow.svelte';
  import ListView from '$lib/components/ListView.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import StateMessage from '$lib/components/StateMessage.svelte';
  import type { Artist } from '$lib/domain/types';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import { actions } from '$lib/ui/actionsRegistry.svelte';

  type Row =
    | { kind: 'heading'; label: string; count: number }
    | { kind: 'artist'; artist: Artist; letter: string; first: boolean };

  // Letters already claimed by navigation/actions; the cursor must win there.
  const RESERVED = new Set(['g', 'j', 'k', 'f', 'p', 'o']);
  const JUMP_LETTERS = 'abcdefghijklmnopqrstuvwxyz'
    .split('')
    .filter((letter) => !RESERVED.has(letter));

  let cursor = new ListCursor();
  let slice = $derived(app.library.artists);
  let rows = $derived<Row[]>(buildRows());

  function buildRows(): Row[] {
    const out: Row[] = [];
    for (const group of slice.listing?.indexes ?? []) {
      if (group.artists.length === 0) continue;
      out.push({ kind: 'heading', label: group.name, count: group.artists.length });
      group.artists.forEach((artist, index) => {
        out.push({ kind: 'artist', artist, letter: group.name, first: index === 0 });
      });
    }
    return out;
  }

  /** Rows the cursor can land on (headings are skipped). */
  function selectableIndices(): number[] {
    return rows.map((row, index) => (row.kind === 'heading' ? -1 : index)).filter((i) => i >= 0);
  }

  function selectedArtist(): Artist | undefined {
    const row = rows[cursor.index];
    return row?.kind === 'artist' ? row.artist : undefined;
  }

  function openSelected(): void {
    const artist = selectedArtist();
    if (artist) actions.openArtist(artist.id);
  }

  function jumpToLetter(letter: string): void {
    const index = rows.findIndex(
      (row) => row.kind === 'artist' && row.letter.toLowerCase() === letter,
    );
    if (index >= 0) cursor.set(index);
    else app.toasts.info(`no artists under "${letter.toUpperCase()}"`);
  }

  // Load on first visit; the store caches, so re-running is cheap.
  $effect(() => {
    void app.library.loadArtistsList();
  });

  // Never leave the cursor on a heading.
  $effect(() => {
    const selectable = selectableIndices();
    if (selectable.length === 0) return;
    if (!selectable.includes(cursor.index)) {
      const next = selectable.find((index) => index > cursor.index) ?? selectable[0]!;
      cursor.set(next);
    }
  });

  onMount(() =>
    app.keyboard.registerAll([
      ...listNavigationBindings(cursor, { hint: true, onActivate: openSelected }),
      {
        keys: ['p'],
        scope: 'page',
        group: 'artist',
        description: 'play artist now',
        run: () => {
          const artist = selectedArtist();
          if (artist) void actions.playArtistNow(artist);
        },
      },
      {
        keys: ['f'],
        scope: 'page',
        group: 'artist',
        description: 'toggle favourite',
        run: () => {
          const artist = selectedArtist();
          if (artist) void actions.toggleArtistFavorite(artist);
        },
      },
      {
        keys: ['o'],
        scope: 'page',
        group: 'artist',
        description: 'artist actions',
        run: () => {
          const artist = selectedArtist();
          if (artist) actions.openArtistActions(artist);
        },
      },
      // One binding per free letter: jump to that index bucket.
      ...JUMP_LETTERS.map((letter) => ({
        keys: [letter],
        scope: 'page' as const,
        group: 'index',
        description: `jump to ${letter.toUpperCase()}`,
        run: () => jumpToLetter(letter),
      })),
    ]),
  );
</script>

<main class="page">
  <Panel
    title="artists"
    note={slice.listing ? slice.listing.artists.length : ''}
    active={true}
    scroll={true}
    grow={true}
  >
    {#if slice.error}
      <StateMessage
        kind="error"
        message="could not load artists"
        detail={slice.error}
        hint="press R to retry"
      />
    {:else if !slice.listing && slice.loading}
      <StateMessage kind="loading" message="loading artists" />
    {:else if rows.length === 0}
      <StateMessage
        kind="empty"
        message="no artists yet"
        hint="add music to the server and rescan"
      />
    {:else}
      <ListView
        items={rows}
        {cursor}
        keyOf={(row) =>
          row.kind === 'heading' ? `heading-${row.label}` : `artist-${row.artist.id}`}
        ariaLabel="artists"
        onActivate={() => openSelected()}
        virtualise={true}
      >
        {#snippet row(entry)}
          {#if entry.kind === 'heading'}
            <span class="heading tui-upper">── {entry.label} ({entry.count})</span>
          {:else}
            <ArtistRow artist={entry.artist} index={entry.first ? entry.letter : undefined} />
          {/if}
        {/snippet}
      </ListView>
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
  .heading {
    color: var(--accent);
  }
</style>
