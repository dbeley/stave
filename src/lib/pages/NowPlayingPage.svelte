<!--
  Now playing: the full view of the current track — cover, metadata, progress and
  transport — with the queue underneath.

  Reachable three ways, because the three audiences differ: `g n` for keyboard
  users, the `[:]` palette for touch, and tapping the now-playing bar for both.

  The queue list is shared with the queue overlay (`QueueList`) rather than
  reimplemented, so reorder/remove/jump behave identically in both places.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import AsciiArt from '$lib/components/AsciiArt.svelte';
  import Meter from '$lib/components/Meter.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import QueueList from '$lib/components/QueueList.svelte';
  import StateMessage from '$lib/components/StateMessage.svelte';
  import { COVER_SIZE } from '$lib/config';
  import { actions } from '$lib/ui/actionsRegistry.svelte';
  import { coverArtIdFor, coverArtUrl } from '$lib/ui/coverArt';
  import { formatDuration, formatLongDuration } from '$lib/utils/format';

  const player = app.player;

  let track = $derived(player.state.track);
  let duration = $derived(player.state.duration || track?.durationSec || 0);
  let coverId = $derived(track ? coverArtIdFor(track) : undefined);
  // Same glyph vocabulary as the transport button in the bar below.
  let transport = $derived(
    player.state.status === 'playing' ? '||' : player.state.status === 'loading' ? '··' : '>',
  );
  let starred = $derived(track ? app.favorites.isTrackStarred(track) : false);
  let cached = $derived(track ? app.resolver.isCached(track.id) : false);
  let shuffle = $derived(app.queue.state.shuffle);
  let repeat = $derived(app.queue.state.repeat);
  let queueLength = $derived(app.queue.length);

  onMount(() =>
    app.keyboard.registerAll([
      {
        keys: ['o'],
        scope: 'page',
        group: 'now playing',
        description: 'track actions',
        hint: true,
        run: () => {
          if (track) actions.openTrackActions(track);
        },
      },
      {
        keys: ['f'],
        scope: 'page',
        group: 'now playing',
        description: 'toggle track favourite',
        hint: true,
        run: () => {
          if (track) void actions.toggleTrackFavorite(track);
        },
      },
      {
        keys: ['y'],
        scope: 'page',
        group: 'now playing',
        description: 'go to the artist',
        run: () => {
          if (track?.artistId) actions.openArtist(track.artistId);
        },
      },
    ]),
  );
</script>

<main class="page">
  {#if !track}
    <Panel title="now playing" grow={true}>
      <StateMessage
        kind="empty"
        message="nothing is playing"
        hint="press enter on an album or a track to start"
      />
    </Panel>
  {:else}
    <div class="columns">
      <Panel title="cover" note={cached ? 'offline' : ''}>
        <div class="cover">
          <AsciiArt
            src={coverArtUrl(coverId, COVER_SIZE.detail)}
            seed={track.albumId ?? track.id}
            columns={44}
            color={app.settings.state.asciiCoverArt}
          />
        </div>
      </Panel>

      <Panel title="now playing" grow={true}>
        <h1 class="name">{track.title}</h1>

        <dl class="meta">
          <dt>artist</dt>
          <dd>
            {#if track.artistId}
              <button class="link" onclick={() => actions.openArtist(track.artistId!)}>
                {track.artistName ?? 'unknown'}
              </button>
            {:else}
              {track.artistName ?? 'unknown'}
            {/if}
          </dd>
          {#if track.albumName}
            <dt>album</dt>
            <dd>
              {#if track.albumId}
                <button class="link" onclick={() => actions.openAlbum(track.albumId!)}>
                  {track.albumName}
                </button>
              {:else}
                {track.albumName}
              {/if}
            </dd>
          {/if}
          {#if track.year}
            <dt>year</dt>
            <dd>{track.year}</dd>
          {/if}
          {#if track.genre}
            <dt>genre</dt>
            <dd>{track.genre}</dd>
          {/if}
          {#if track.trackNumber}
            <dt>track</dt>
            <dd>
              {track.discNumber ? `${track.discNumber}.` : ''}{track.trackNumber}
            </dd>
          {/if}
          <dt>duration</dt>
          <dd>{formatLongDuration(track.durationSec)}</dd>
          {#if track.suffix}
            <dt>format</dt>
            <dd>
              {track.suffix.toUpperCase()}{#if track.bitRate}
                · {track.bitRate} kbps{/if}
            </dd>
          {/if}
          <dt>source</dt>
          <dd>
            {#if player.state.source === 'cache'}
              <span class="on">▣ offline</span>
            {:else if player.state.source === 'stream'}
              ≈ stream
            {:else}
              —
            {/if}
          </dd>
          <dt>flags</dt>
          <dd>
            <span class:on={starred}>{starred ? '★ favourite' : '☆ not favourite'}</span>
            <span class="sep">·</span>
            <span class:on={shuffle}>shuffle {shuffle ? 'on' : 'off'}</span>
            <span class="sep">·</span>
            <span>repeat {repeat}</span>
            {#if player.state.autoDjAdded > 0}
              <span class="sep">·</span>
              <span class="on">auto-dj +{player.state.autoDjAdded}</span>
            {/if}
          </dd>
        </dl>

        <div class="progress">
          <Meter value={player.progress} width={48} />
          <span class="times">
            {formatDuration(player.state.position)}/{formatDuration(duration)}
          </span>
        </div>

        <div class="controls">
          <button
            class="key"
            title="previous (p)"
            aria-label="previous track"
            onclick={() => void player.previous()}
          >
            |&lt;&lt;
          </button>
          <button
            class="key"
            title="back 10s"
            aria-label="seek back 10 seconds"
            onclick={() => player.seekBy(-10)}
          >
            &lt;&lt;10
          </button>
          <button
            class="key toggle"
            title="play / pause (space)"
            aria-label="play or pause"
            onclick={() => void player.toggle()}
          >
            {transport}
          </button>
          <button
            class="key"
            title="forward 10s"
            aria-label="seek forward 10 seconds"
            onclick={() => player.seekBy(10)}
          >
            10&gt;&gt;
          </button>
          <button
            class="key"
            title="next (n)"
            aria-label="next track"
            onclick={() => void player.next()}
          >
            &gt;&gt;|
          </button>
          <span class="spacer"></span>
          <button
            class="key"
            class:active={shuffle}
            title="shuffle (s)"
            aria-label="toggle shuffle"
            onclick={() => {
              const on = app.queue.toggleShuffle();
              app.toasts.info(`shuffle ${on ? 'on' : 'off'}`);
            }}
          >
            ⤨
          </button>
          <button
            class="key"
            title="cycle repeat (r)"
            aria-label="cycle repeat mode"
            onclick={() => app.toasts.info(`repeat ${app.queue.cycleRepeat()}`)}
          >
            ↻
          </button>
        </div>

        {#if player.state.error}
          <p class="error">└─ {player.state.error}</p>
        {/if}
      </Panel>
    </div>

    <Panel title="queue" note="{queueLength} items" grow={true} scroll={true}>
      <QueueList scope="page" />
    </Panel>
  {/if}
</main>

<style>
  .page {
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
    padding: 0.9rem 0.7rem;
    min-height: 0;
    height: 100%;
  }
  .columns {
    display: grid;
    grid-template-columns: minmax(0, 360px) minmax(0, 1fr);
    gap: 1.1rem;
    align-items: start;
  }
  @media (max-width: 820px) {
    .columns {
      grid-template-columns: minmax(0, 1fr);
    }
  }
  .cover {
    display: flex;
    justify-content: center;
  }
  .name {
    margin: 0 0 0.6rem;
    font-size: 1.3em;
    line-height: 1.25;
    word-break: break-word;
  }
  .meta {
    display: grid;
    grid-template-columns: max-content minmax(0, 1fr);
    gap: 0.15em 0.8em;
    margin: 0 0 0.8rem;
  }
  .meta dt {
    color: var(--fg-faint);
  }
  .meta dd {
    margin: 0;
    color: var(--fg);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  .on {
    color: var(--ok);
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
  .progress {
    display: flex;
    align-items: center;
    gap: 0.6em;
    margin-bottom: 0.7rem;
    color: var(--fg-dim);
  }
  .times {
    flex: none;
    font-variant-numeric: tabular-nums;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 0.4em;
    flex-wrap: wrap;
  }
  .spacer {
    flex: 1;
  }
  .key {
    font: inherit;
    color: var(--fg);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    padding: 0.35em 0.7em;
    min-width: 2.6em;
    min-height: 2.1em;
    cursor: pointer;
  }
  .key:hover {
    border-color: var(--border-focus);
    color: var(--accent);
  }
  .key.toggle {
    color: var(--accent);
    font-weight: 700;
  }
  .key.active {
    border-color: var(--accent);
    color: var(--accent);
  }
  .error {
    margin: 0.6rem 0 0;
    color: var(--danger);
  }
</style>
