<!--
  Touch mini-player: the always-there strip above the bottom nav.

  It carries the same information as the terminal `NowPlayingBar`, but at phone
  scale — a real image thumb, a two-line title/artist, and comfortable transport
  targets. The body is the tap target for the full now-playing screen while the
  transport and scrub row keep their own hit areas, so a thumb on play or on the
  progress line never opens the screen by accident.

  Rendered by `App.svelte` only under the touch shell.
-->
<script lang="ts">
  import { app } from '$lib/app.svelte';
  import CoverArt from '$lib/components/CoverArt.svelte';
  import SeekBar from '$lib/components/SeekBar.svelte';
  import TransportControls from '$lib/components/TransportControls.svelte';
  import { coverArtIdFor } from '$lib/ui/coverArt';
  import { truncate } from '$lib/utils/format';

  let player = app.player;
  let track = $derived(player.state.track);
  // Prefer the album's art, falling back to the track's own.
  let coverId = $derived(track ? coverArtIdFor(track) : undefined);
</script>

{#if track}
  <div class="mini">
    <button
      class="body"
      title="open the now playing screen"
      aria-label="open now playing"
      onclick={() => app.router.navigate({ name: 'now-playing' })}
    >
      <span class="thumb">
        <!-- Real image thumb; `columns` only sizes the no-art fallback. -->
        <CoverArt coverArtId={coverId} seed={track.id} size={80} mode="image" columns={8} />
      </span>
      <span class="meta">
        <span class="title" title={track.title}>{truncate(track.title, 30)}</span>
        <span class="artist" title={track.artistName ?? ''}
          >{truncate(track.artistName ?? 'unknown', 28)}</span
        >
      </span>
      {#if player.state.source === 'cache'}
        <span class="badge cache" title="playing from the offline cache">▣</span>
      {:else if player.state.source === 'stream'}
        <span class="badge" title="streaming from the server">≈</span>
      {/if}
    </button>

    <div class="controls">
      <TransportControls variant="compact" />
    </div>
  </div>

  <!-- The line stays thin; the padded row is the ~24px touch target. -->
  <div class="scrub">
    <SeekBar width={40} interactive />
  </div>
{/if}

<style>
  .mini {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.6rem 0.25rem;
    border-top: 1px solid var(--border);
    background: var(--bg-elev-2);
    overflow: hidden;
  }
  .body {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    flex: 1;
    min-width: 0;
    min-height: 48px;
    padding: 0.15rem 0;
    background: none;
    border: none;
    font: inherit;
    color: inherit;
    text-align: left;
    cursor: pointer;
    touch-action: manipulation;
  }
  .thumb {
    flex: none;
    width: 40px;
    height: 40px;
    overflow: hidden;
    border: 1px solid var(--border);
    background: var(--bg-elev);
  }
  .thumb :global(img) {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border: none;
  }
  .meta {
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
    line-height: 1.25;
  }
  .title {
    color: var(--fg);
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .artist {
    color: var(--fg-dim);
    font-size: 0.85em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .badge {
    flex: none;
    border: 1px solid var(--border);
    color: var(--fg-faint);
    padding: 0 0.3em;
  }
  .badge.cache {
    color: var(--ok);
    border-color: var(--ok);
  }
  .controls {
    flex: none;
    display: inline-flex;
    align-items: center;
  }
  /* Comfortable touch targets: the compact glyphs get thumb-sized padding. */
  .controls :global(.key) {
    min-width: 2.4em;
    min-height: 2.4em;
    font-size: 1.05em;
  }
  .scrub {
    display: flex;
    align-items: center;
    padding: 0.35rem 0.6rem calc(0.3rem + env(safe-area-inset-bottom, 0px));
    background: var(--bg-elev-2);
  }
</style>
