<!--
  Shared transport: previous, play/pause, next, with optional ±10s seek. One
  implementation drives every playback surface (bar, page, mini player, mobile
  screen), so a glyph or label change lands everywhere at once.
-->
<script lang="ts">
  import { app } from '$lib/app.svelte';

  interface Props {
    seek10?: boolean;
    /**
     * `compact` matches the dense now-playing bar; `button` the boxed keys on
     * the full now-playing page. Defaults to `button`.
     */
    variant?: 'compact' | 'button';
  }

  let { seek10 = false, variant = 'button' }: Props = $props();

  let player = app.player;
  let transport = $derived(
    player.state.status === 'playing' ? '||' : player.state.status === 'loading' ? '··' : '>',
  );
</script>

<span class={`transport ${variant}`}>
  <button
    class="key"
    title="previous (p)"
    aria-label="previous track"
    onclick={() => void player.previous()}
  >
    |&lt;&lt;</button
  >{#if seek10}<button
      class="key"
      title="back 10s"
      aria-label="seek back 10 seconds"
      onclick={() => player.seekBy(-10)}
    >
      &lt;&lt;10</button
    >{/if}<button
    class="key toggle"
    title="play / pause (space)"
    aria-label="play or pause"
    onclick={() => void player.toggle()}
  >
    {transport}</button
  >{#if seek10}<button
      class="key"
      title="forward 10s"
      aria-label="seek forward 10 seconds"
      onclick={() => player.seekBy(10)}
    >
      10&gt;&gt;</button
    >{/if}<button
    class="key"
    title="next (n)"
    aria-label="next track"
    onclick={() => void player.next()}
  >
    &gt;&gt;|</button
  >
</span>

<style>
  .transport {
    display: inline-flex;
    align-items: center;
    gap: 0.2em;
  }
  .key {
    font: inherit;
    background: none;
    border: none;
    padding: 0 0.15em;
    color: inherit;
    cursor: pointer;
  }
  /* Dense bar: accent-coloured glyphs. */
  .transport.compact .key {
    color: var(--accent);
  }
  .transport.compact .key:hover {
    background: var(--accent);
    color: var(--bg);
  }
  /* Full page: boxed, touch-friendly keys. */
  .transport.button {
    gap: 0.4em;
  }
  .transport.button .key {
    color: var(--fg);
    background: var(--bg-elev);
    border: 1px solid var(--border);
    padding: 0.35em 0.7em;
    min-width: 2.6em;
    min-height: 2.1em;
  }
  .transport.button .key:hover {
    border-color: var(--border-focus);
    color: var(--accent);
  }
  .transport.button .key.toggle {
    color: var(--accent);
    font-weight: 700;
  }
</style>
