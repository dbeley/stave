<!--
  Touch now-playing: a full-height screen with a `[now playing | queue]`
  segmented control. The info segment shows the hero cover, transport, seek and
  flags; the queue segment shows the shared QueueList.

  Rendered by `App.svelte` only under the touch shell — the terminal keeps the
  two-column `NowPlayingPage`, so the queue is never squeezed off-screen on a
  phone.
-->
<script lang="ts">
  import { app } from '$lib/app.svelte';
  import CoverArt from '$lib/components/CoverArt.svelte';
  import QueueList from '$lib/components/QueueList.svelte';
  import SeekBar from '$lib/components/SeekBar.svelte';
  import StateMessage from '$lib/components/StateMessage.svelte';
  import TransportControls from '$lib/components/TransportControls.svelte';
  import { COVER_SIZE } from '$lib/config';
  import { actions } from '$lib/ui/actionsRegistry.svelte';
  import { coverArtIdFor } from '$lib/ui/coverArt';

  const player = app.player;

  let track = $derived(player.state.track);
  let coverId = $derived(track ? coverArtIdFor(track) : undefined);
  let starred = $derived(track ? app.favorites.isTrackStarred(track) : false);
  let cached = $derived(track ? app.resolver.isCached(track.id) : false);
  let shuffle = $derived(app.queue.state.shuffle);
  let repeat = $derived(app.queue.state.repeat);
  let tab = $derived(app.ui.state.nowPlayingTab);
</script>

<main class="screen">
  <div class="segments" role="tablist" aria-label="now playing views">
    <button
      type="button"
      role="tab"
      aria-selected={tab === 'info'}
      class:active={tab === 'info'}
      onclick={() => app.ui.showNowPlayingTab('info')}
    >
      now playing
    </button>
    <button
      type="button"
      role="tab"
      aria-selected={tab === 'queue'}
      class:active={tab === 'queue'}
      onclick={() => app.ui.showNowPlayingTab('queue')}
    >
      queue
    </button>
  </div>

  {#if tab === 'queue'}
    <div class="queue">
      <QueueList scope="page" />
    </div>
  {:else if !track}
    <StateMessage
      kind="empty"
      message="nothing is playing"
      hint="press enter on an album or a track to start"
    />
  {:else}
    <div class="info">
      <div class="hero">
        <!-- The hero keeps ASCII art (respecting the setting) at a small column
             count; a real image is used only when ASCII is off. -->
        <CoverArt
          coverArtId={coverId}
          seed={track.albumId ?? track.id}
          size={COVER_SIZE.detail}
          columns={32}
          mode="auto"
          ascii={app.settings.state.asciiCoverArt}
        />
      </div>

      <h1 class="name">{track.title}</h1>

      <p class="byline">
        {#if track.artistId}
          <button class="link" onclick={() => actions.openArtist(track.artistId!)}>
            {track.artistName ?? 'unknown'}
          </button>
        {:else}
          {track.artistName ?? 'unknown'}
        {/if}
        {#if track.albumName}
          <span class="sep">·</span>
          {#if track.albumId}
            <button class="link" onclick={() => actions.openAlbum(track.albumId!)}>
              {track.albumName}
            </button>
          {:else}
            {track.albumName}
          {/if}
        {/if}
      </p>

      <div class="seek">
        <SeekBar width={40} showTimes interactive />
      </div>

      <div class="controls">
        <TransportControls variant="button" seek10 />
      </div>

      <p class="flags">
        {#if cached}
          <span class="on">▣ offline</span>
          <span class="sep">·</span>
        {/if}
        <span class:on={starred}>{starred ? '★ favourite' : '☆ not favourite'}</span>
        <span class="sep">·</span>
        <span class:on={shuffle}>shuffle {shuffle ? 'on' : 'off'}</span>
        <span class="sep">·</span>
        <span>repeat {repeat}</span>
        {#if player.state.autoDjAdded > 0}
          <span class="sep">·</span>
          <span class="on">auto-dj +{player.state.autoDjAdded}</span>
        {/if}
      </p>
    </div>
  {/if}
</main>

<style>
  .screen {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 0.6rem 0.7rem;
    gap: 0.8rem;
    overflow-y: auto;
  }
  .segments {
    flex: none;
    display: flex;
    border: 1px solid var(--border);
    background: var(--bg-elev);
  }
  .segments button {
    flex: 1;
    font: inherit;
    color: var(--fg-dim);
    background: none;
    border: none;
    padding: 0.55em 0;
    min-height: 44px;
    cursor: pointer;
    touch-action: manipulation;
  }
  .segments button + button {
    border-left: 1px solid var(--border);
  }
  .segments button.active {
    color: var(--bg);
    background: var(--accent);
  }
  .queue {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
  }
  .info {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.6rem;
  }
  .hero {
    display: flex;
    justify-content: center;
  }
  .name {
    margin: 0;
    font-size: 1.35em;
    line-height: 1.25;
    text-align: center;
    word-break: break-word;
  }
  .byline {
    margin: 0;
    text-align: center;
    color: var(--fg-dim);
    overflow-wrap: anywhere;
  }
  .sep {
    color: var(--fg-faint);
    padding: 0 0.4em;
  }
  .link {
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: var(--info);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .link:hover {
    color: var(--accent);
  }
  .seek {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.6em;
    color: var(--fg-dim);
  }
  .controls {
    display: flex;
    justify-content: center;
  }
  .flags {
    margin: 0;
    text-align: center;
    color: var(--fg-dim);
  }
  .on {
    color: var(--ok);
  }
</style>
