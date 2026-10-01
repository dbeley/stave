<!--
  "go to" palette: every destination in the app, as a tappable list.

  Two reasons this exists. Keyboard users get a vim-style `:` that lists
  everything instead of memorising `g`-chords. Touch users get the *only* way to
  navigate at all: a phone has no keyboard, so without this the app could only
  descend from wherever it started (home -> album -> artist) and search,
  playlists, favourites, listen later and settings were unreachable.

  It is generated from one table, so the on-screen list, the mnemonics and the
  registered bindings cannot drift apart.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import Overlay from '$lib/components/Overlay.svelte';
  import {
    ListCursor,
    keepCursorRowVisible,
    listNavigationBindings,
  } from '$lib/keyboard/list.svelte';
  import type { Binding } from '$lib/keyboard/registry.svelte';

  interface Destination {
    /** Single key that also jumps straight there, and is shown on the row. */
    key: string;
    label: string;
    hint: string;
    run: () => void;
  }

  // The mnemonics deliberately match the `g`-chord suffixes (g h, g a, g r ...),
  // so muscle memory carries over in both directions.
  const DESTINATIONS: Destination[] = [
    {
      key: 'h',
      label: 'home',
      hint: 'random picks + recently added',
      run: () => app.router.navigate({ name: 'home' }),
    },
    {
      key: 'a',
      label: 'albums',
      hint: 'newest, random or A-Z',
      run: () => app.router.navigate({ name: 'albums', sort: 'newest' }),
    },
    {
      key: 'r',
      label: 'artists',
      hint: 'the A-Z index',
      run: () => app.router.navigate({ name: 'artists' }),
    },
    {
      key: 'p',
      label: 'playlists',
      hint: 'server-side playlists',
      run: () => app.router.navigate({ name: 'playlists' }),
    },
    {
      key: 'f',
      label: 'favourites',
      hint: 'starred albums, artists, tracks',
      run: () => app.router.navigate({ name: 'favorites' }),
    },
    {
      key: 'l',
      label: 'listen later',
      hint: 'albums kept for offline',
      run: () => app.router.navigate({ name: 'listen-later' }),
    },
    {
      key: '/',
      label: 'search',
      hint: 'tracks, albums, artists',
      run: () => {
        app.router.navigate({ name: 'search', query: app.search.state.query });
        app.focusSearch();
      },
    },
    {
      key: 'n',
      label: 'now playing',
      hint: 'cover, metadata, queue',
      run: () => app.router.navigate({ name: 'now-playing' }),
    },
    {
      key: 'Q',
      label: 'queue',
      hint: 'what plays next, reorder it',
      run: () => app.ui.openOverlay('queue'),
    },
    {
      key: '?',
      label: 'keyboard help',
      hint: 'every binding, generated live',
      run: () => app.ui.openOverlay('help'),
    },
    {
      key: 's',
      label: 'settings',
      hint: 'theme, credentials, auto-dj, offline',
      run: () => app.router.navigate({ name: 'settings' }),
    },
  ];

  let cursor = new ListCursor();
  let container: HTMLDivElement | undefined = $state();

  // This overlay renders its own rows, so it owns the cursor count: without this
  // move() clamps against 0 and navigation is silently inert.
  $effect(() => cursor.setCount(DESTINATIONS.length));

  keepCursorRowVisible(
    () => container,
    () => cursor.index,
  );

  /** Close first, then act: a destination may open another overlay (queue/help). */
  function choose(destination: Destination): void {
    app.ui.closeOverlay();
    destination.run();
  }

  const bindings: Binding[] = [
    ...listNavigationBindings(cursor, {
      scope: 'overlay',
      hint: false,
      onActivate: () => {
        const destination = DESTINATIONS[cursor.index];
        if (destination) choose(destination);
      },
    }),
    ...DESTINATIONS.map((destination) => ({
      keys: [destination.key],
      scope: 'overlay' as const,
      group: 'go to',
      description: destination.label,
      run: () => choose(destination),
    })),
  ];

  onMount(() => app.keyboard.registerAll(bindings));
</script>

<Overlay title="go to" note="{DESTINATIONS.length} places" width="min(94vw, 64ch)">
  <div class="rows" bind:this={container}>
    {#each DESTINATIONS as destination, index (destination.label)}
      <button
        type="button"
        class="row"
        class:selected={cursor.isSelected(index)}
        data-row={index}
        aria-label="go to {destination.label}"
        onclick={() => choose(destination)}
        onmouseenter={() => cursor.set(index)}
        onfocus={() => cursor.set(index)}
      >
        <span class="key">[{destination.key}]</span>
        <span class="label">{destination.label}</span>
        <span class="hint">{destination.hint}</span>
      </button>
    {/each}
  </div>
</Overlay>

<style>
  .rows {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 0.6em;
    /* Generous hit area: on a phone this is the primary navigation surface. */
    min-height: 2.1em;
    padding: 0.25em 0.45em;
    border: 1px solid transparent;
    background: transparent;
    color: var(--fg);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .row.selected {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .row.selected .hint {
    color: var(--bg);
    opacity: 0.75;
  }
  .key {
    flex: none;
    color: var(--accent);
  }
  .row.selected .key {
    color: var(--bg);
  }
  .label {
    flex: none;
    min-width: 12ch;
  }
  .hint {
    flex: 1;
    min-width: 0;
    color: var(--fg-faint);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
