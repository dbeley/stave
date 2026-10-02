<!--
  The app shell: status line, routed page, now-playing strip, hint bar, overlays.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import ActionMenu from '$lib/components/ActionMenu.svelte';
  import BottomNav from '$lib/components/BottomNav.svelte';
  import CommandPalette from '$lib/components/CommandPalette.svelte';
  import HelpOverlay from '$lib/components/HelpOverlay.svelte';
  import HintBar from '$lib/components/HintBar.svelte';
  import LoginOverlay from '$lib/components/LoginOverlay.svelte';
  import NowPlayingBar from '$lib/components/NowPlayingBar.svelte';
  import QueueOverlay from '$lib/components/QueueOverlay.svelte';
  import StatusBar from '$lib/components/StatusBar.svelte';
  import { applyShellToDocument } from '$lib/stores/capability.svelte';
  import { applyThemeToDocument } from '$lib/stores/settings.svelte';
  import AlbumPage from '$lib/pages/AlbumPage.svelte';
  import AlbumsPage from '$lib/pages/AlbumsPage.svelte';
  import ArtistPage from '$lib/pages/ArtistPage.svelte';
  import ArtistsPage from '$lib/pages/ArtistsPage.svelte';
  import FavoritesPage from '$lib/pages/FavoritesPage.svelte';
  import HomePage from '$lib/pages/HomePage.svelte';
  import ListenLaterPage from '$lib/pages/ListenLaterPage.svelte';
  import NowPlayingPage from '$lib/pages/NowPlayingPage.svelte';
  import PlaylistPage from '$lib/pages/PlaylistPage.svelte';
  import PlaylistsPage from '$lib/pages/PlaylistsPage.svelte';
  import SearchPage from '$lib/pages/SearchPage.svelte';
  import SettingsPage from '$lib/pages/SettingsPage.svelte';

  let route = $derived(app.router.current);
  let connection = $derived(app.connection);
  let shell = $derived(app.capability.shell);
  let needsLogin = $derived(
    !app.credentials.isComplete || (!app.isConnected && connection.status === 'error'),
  );

  // Theme tokens live on <html>; the settings store owns the values.
  $effect(() => {
    applyThemeToDocument(app.settings.state);
  });

  // The shell names the active input model on <html>, so CSS can react to it.
  $effect(() => {
    applyShellToDocument(shell);
  });

  onMount(() => {
    // Every keystroke goes through the binding registry first. If it is not
    // claimed by a binding, the browser handles it (typing in inputs, etc.).
    const onKeydown = (event: KeyboardEvent) => {
      if (app.handleKeydown(event)) {
        event.preventDefault();
      }
    };
    globalThis.addEventListener('keydown', onKeydown);
    return () => globalThis.removeEventListener('keydown', onKeydown);
  });
</script>

<div class="shell">
  <StatusBar />

  <div class="content">
    {#if route.name === 'home'}
      <HomePage />
    {:else if route.name === 'albums'}
      <AlbumsPage />
    {:else if route.name === 'album'}
      <AlbumPage />
    {:else if route.name === 'artists'}
      <ArtistsPage />
    {:else if route.name === 'artist'}
      <ArtistPage />
    {:else if route.name === 'playlists'}
      <PlaylistsPage />
    {:else if route.name === 'playlist'}
      <PlaylistPage />
    {:else if route.name === 'favorites'}
      <FavoritesPage />
    {:else if route.name === 'listen-later'}
      <ListenLaterPage />
    {:else if route.name === 'search'}
      <SearchPage />
    {:else if route.name === 'now-playing'}
      <NowPlayingPage />
    {:else if route.name === 'settings'}
      <SettingsPage />
    {/if}
  </div>

  <NowPlayingBar />
  {#if shell === 'terminal'}
    <HintBar />
  {:else if !needsLogin && app.ui.state.overlay !== 'login'}
    <BottomNav />
  {/if}
</div>

{#if app.ui.state.overlay === 'palette'}
  <CommandPalette />
{:else if app.ui.state.overlay === 'help'}
  <HelpOverlay />
{:else if app.ui.state.overlay === 'queue'}
  <QueueOverlay />
{:else if app.ui.state.overlay === 'actions'}
  <ActionMenu />
{/if}

{#if needsLogin || app.ui.state.overlay === 'login'}
  <LoginOverlay blocking={needsLogin} />
{/if}

<style>
  .shell {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .content {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
</style>
