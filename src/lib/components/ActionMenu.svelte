<!--
  The album/track/artist action menu (the `o` key, or a long-press on touch).
  Every row is also a single-key shortcut, so the menu teaches the keyboard
  rather than hiding it behind a mouse-only affordance.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import Overlay from '$lib/components/Overlay.svelte';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import { actions } from '$lib/ui/actionsRegistry.svelte';

  interface MenuItem {
    key: string;
    label: string;
    detail?: string;
    run: () => void | Promise<void>;
  }

  const HOTKEYS = ['p', 'n', 'a', 'f', 'L', 'o', 'y'];

  let cursor = new ListCursor();
  let target = $derived(app.ui.state.actionTarget);
  let items = $derived<MenuItem[]>(buildItems());

  // The menu renders its own rows, so it owns the cursor count: without this
  // move() clamps against 0, j/k do nothing, and Enter always activates the
  // first item regardless of how far the user navigated.
  $effect(() => cursor.setCount(items.length));

  /** Pure: builds the rows for whatever the menu is pointing at. */
  function buildItems(): MenuItem[] {
    if (!target) return [];
    const rows: MenuItem[] = [];
    const close = () => app.ui.closeActions();

    if (target.kind === 'album' && target.album) {
      const album = target.album;
      rows.push(
        {
          key: 'p',
          label: 'play album now',
          detail: 'replaces the queue',
          run: () => actions.playAlbumNow(album),
        },
        {
          key: 'n',
          label: 'play next',
          detail: 'right after the current track',
          run: () => actions.enqueueAlbum(album, 'next'),
        },
        {
          key: 'a',
          label: 'add to end of queue',
          run: () => actions.enqueueAlbum(album, 'end'),
        },
        {
          key: 'f',
          label: 'toggle favourite',
          detail: app.favorites.isAlbumStarred(album) ? 'starred' : 'not starred',
          run: () => actions.toggleAlbumFavorite(album),
        },
        {
          key: 'L',
          label: 'toggle listen later',
          detail: app.listenLater.has(album.id) ? 'in list' : 'not in list',
          run: () => {
            actions.toggleListenLater(album);
          },
        },
        { key: 'o', label: 'open album page', run: () => actions.openAlbum(album.id) },
      );
      if (album.artistId) {
        rows.push({
          key: 'y',
          label: 'go to artist',
          run: () => actions.openArtist(album.artistId!),
        });
      }
    } else if (target.kind === 'track' && target.track) {
      const track = target.track;
      rows.push(
        {
          key: 'p',
          label: 'play now',
          detail: 'replaces the queue',
          run: () => actions.playTrackNow(track),
        },
        { key: 'n', label: 'play next', run: () => actions.enqueueTrack(track, 'next') },
        { key: 'a', label: 'add to end of queue', run: () => actions.enqueueTrack(track, 'end') },
        {
          key: 'f',
          label: 'toggle favourite',
          detail: app.favorites.isTrackStarred(track) ? 'starred' : 'not starred',
          run: () => actions.toggleTrackFavorite(track),
        },
        {
          key: 'L',
          label: 'listen later (its album)',
          run: () => actions.toggleListenLaterForTrack(track),
        },
      );
      if (track.albumId) {
        rows.push({
          key: 'o',
          label: 'open album page',
          run: () => actions.openAlbum(track.albumId!),
        });
      }
      if (track.artistId) {
        rows.push({
          key: 'y',
          label: 'go to artist',
          run: () => actions.openArtist(track.artistId!),
        });
      }
    } else if (target.kind === 'artist' && target.artist) {
      const artist = target.artist;
      rows.push(
        { key: 'p', label: 'play artist', run: () => actions.playArtistNow(artist) },
        {
          key: 'f',
          label: 'toggle favourite',
          detail: app.favorites.isArtistStarred(artist) ? 'starred' : 'not starred',
          run: () => actions.toggleArtistFavorite(artist),
        },
        { key: 'o', label: 'open artist page', run: () => actions.openArtist(artist.id) },
      );
    }

    rows.push({ key: 'escape', label: 'cancel', run: close });
    return rows;
  }

  function choose(item: MenuItem | undefined): void {
    if (!item) return;
    void item.run();
    if (item.key !== 'escape') app.ui.closeActions();
  }

  onMount(() => {
    const shortcutBindings = HOTKEYS.map((key) => ({
      keys: [key],
      scope: 'overlay' as const,
      group: 'actions',
      description: `actions: ${key}`,
      when: () => app.ui.state.overlay === 'actions',
      run: () => choose(items.find((item) => item.key === key)),
    }));

    return app.keyboard.registerAll([
      ...listNavigationBindings(cursor, {
        scope: 'overlay',
        hint: false,
        onActivate: () => choose(items[cursor.index]),
      }),
      ...shortcutBindings,
    ]);
  });
</script>

<Overlay
  title="actions"
  note={target ? `${target.kind}: ${target.title}` : ''}
  width="min(92vw, 66ch)"
>
  {#each items as item, index (item.key)}
    <!--
      Tappable, not just keyboard-driven. The rows carried only key bindings, so on
      a phone — where this menu is the *only* way to reach these actions — tapping a
      row did nothing at all. The queue list next door already binds clicks on its
      rows; this is the same thing.
    -->
    <div
      class="row"
      class:selected={cursor.isSelected(index)}
      role="button"
      tabindex="-1"
      data-command={item.key}
      onclick={() => choose(item)}
      onkeydown={(event) => {
        if (event.key === 'Enter') choose(item);
      }}
      onmouseenter={() => cursor.set(index)}
    >
      {#if app.capability.shell !== 'touch'}<span class="key">[{item.key}]</span>{/if}
      <span class="label">{item.label}</span>
      {#if item.detail}<span class="detail">{item.detail}</span>{/if}
    </div>
  {/each}
</Overlay>

<style>
  .row {
    display: flex;
    align-items: baseline;
    gap: 0.6em;
    padding: 0 0.3rem;
    cursor: pointer;
  }
  :global([data-shell='touch']) .row {
    align-items: center;
    min-height: 44px;
  }
  .row.selected {
    background: var(--accent);
    color: var(--bg);
  }
  .key {
    color: var(--accent);
    min-width: 6ch;
    flex: none;
  }
  .row.selected .key {
    color: var(--bg);
    font-weight: 700;
  }
  .label {
    flex: 1;
  }
  .detail {
    color: var(--fg-faint);
  }
  .row.selected .detail {
    color: var(--bg);
    opacity: 0.8;
  }
</style>
