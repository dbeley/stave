<!--
  Now-playing strip: track identity, transport, position, queue context.
  Deliberately dense — this is the line you look at 90% of the time.
-->
<script lang="ts">
  import { app } from '$lib/app.svelte';
  import Meter from '$lib/components/Meter.svelte';
  import { formatDuration, truncate } from '$lib/utils/format';

  let player = app.player;
  let track = $derived(player.state.track);
  let status = $derived(player.state.status);
  let transport = $derived(status === 'playing' ? '||' : status === 'loading' ? '··' : '>');
  let position = $derived(player.state.position);
  let duration = $derived(player.state.duration || track?.durationSec || 0);

  let volumeBar = $derived(
    `vol ${'▮'.repeat(Math.round(player.volume * 10))}${'▯'.repeat(10 - Math.round(player.volume * 10))}`,
  );
</script>

<div class="bar">
  <!-- id="now-playing-bar" is the hook the e2e suite uses to assert playback. -->
  <div class="transport" id="now-playing-bar">
    <button
      class="key"
      title="previous (p)"
      aria-label="previous track"
      onclick={() => void player.previous()}
    >
      |&lt;&lt;</button
    ><button
      class="key"
      title="play/pause (space)"
      aria-label="play or pause"
      onclick={() => void player.toggle()}
    >
      {transport}</button
    ><button
      class="key"
      title="next (n)"
      aria-label="next track"
      onclick={() => void player.next()}
    >
      &gt;&gt;|
    </button>
  </div>

  {#if track}
    <!-- Tapping the identity opens the now-playing page: on a phone this is the
         natural gesture, and the bar is already the most-tapped surface. -->
    <button
      class="identity"
      title="open the now playing page (g n)"
      aria-label="open now playing"
      onclick={() => app.router.navigate({ name: 'now-playing' })}
    >
      <span class="title" title={track.title}>{truncate(track.title, 34)}</span>
      <span class="dim">·</span>
      <span class="dim" title={track.artistName ?? ''}
        >{truncate(track.artistName ?? 'unknown', 20)}</span
      >
      <span class="dim">·</span>
      <span class="dim" title={track.albumName ?? ''}>{truncate(track.albumName ?? '—', 22)}</span>
    </button>
  {:else}
    <span class="dim">nothing playing — press enter on a track, or / to search</span>
  {/if}

  <span class="spacer"></span>

  {#if app.queue.state.shuffle}<span class="badge">shuffle</span>{/if}
  {#if app.queue.state.repeat !== 'off'}<span class="badge">repeat:{app.queue.state.repeat}</span
    >{/if}
  {#if player.state.source === 'cache'}
    <span class="badge cache" title="playing from the offline cache">▣ local</span>
  {:else if player.state.source === 'stream'}
    <span class="badge" title="streaming from the server">≈ stream</span>
  {/if}

  <!--
    Only once something is loaded: with an empty player the position/duration pair
    rendered "0:00/--:--", a phantom time for a track that does not exist. The
    transport controls stay visible so the bar keeps its shape.
  -->
  {#if track}
    <span class="position">
      {formatDuration(position)}/{formatDuration(duration)}
    </span>
    <Meter value={player.progress} width={16} />
  {/if}
  <span class="dim vol">{volumeBar}</span>
</div>

{#if player.state.error}
  <div class="error">└─ {player.state.error}</div>
{/if}

<style>
  .bar {
    display: flex;
    align-items: center;
    gap: 0.55em;
    padding: 0.15rem 0.5rem;
    border-top: 1px solid var(--border);
    background: var(--bg-elev-2);
    white-space: nowrap;
    overflow: hidden;
  }
  .transport {
    display: inline-flex;
    gap: 0.2em;
  }
  .key {
    color: var(--accent);
    padding: 0 0.15em;
  }
  .key:hover {
    background: var(--accent);
    color: var(--bg);
  }
  .identity {
    display: flex;
    align-items: baseline;
    gap: 0.35em;
    min-width: 0;
    overflow: hidden;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }
  .identity:hover .title {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .title {
    color: var(--fg);
    font-weight: 700;
  }
  .dim {
    color: var(--fg-dim);
  }
  .spacer {
    flex: 1;
  }
  .badge {
    border: 1px solid var(--border);
    color: var(--fg-faint);
    padding: 0 0.3em;
  }
  .badge.cache {
    color: var(--ok);
    border-color: var(--ok);
  }
  .position {
    color: var(--fg-dim);
  }
  .vol {
    letter-spacing: -0.08em;
  }
  .error {
    padding: 0 0.5rem;
    color: var(--danger);
  }
</style>
