<!--
  Playback progress, shared by every playback surface. Read-only it is exactly
  `Meter`; interactive it becomes a touch slider mapping pointer x to a seek
  fraction, keeping the block-character appearance.
-->
<script lang="ts">
  import { app } from '$lib/app.svelte';
  import Meter from '$lib/components/Meter.svelte';
  import { formatDuration } from '$lib/utils/format';

  interface Props {
    /** Width in characters. */
    width?: number;
    /** Render the `position/duration` time pair next to the bar. */
    showTimes?: boolean;
    label?: string;
    /** Make the bar seekable by pointer. Defaults to read-only. */
    interactive?: boolean;
  }

  let { width = 24, showTimes = false, label, interactive = false }: Props = $props();

  let player = app.player;
  let position = $derived(player.state.position);
  // The bar has always shown the track's duration when the player has not
  // reported one yet; keep that fallback so a known track never reads a phantom
  // "0:00/--:--".
  let duration = $derived(player.state.duration || player.state.track?.durationSec || 0);
  let progress = $derived(player.progress);

  const FULL = '█';
  const EMPTY = '░';

  let clamped = $derived(Number.isFinite(progress) ? Math.min(Math.max(progress, 0), 1) : 0);
  let filled = $derived(Math.round(clamped * width));
  let bar = $derived(FULL.repeat(filled) + EMPTY.repeat(Math.max(0, width - filled)));

  let dragging = $state(false);

  function fractionAt(event: PointerEvent): number {
    const el = event.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(Math.max((event.clientX - rect.left) / rect.width, 0), 1);
  }

  function seekAt(event: PointerEvent): void {
    if (duration <= 0) return;
    player.seekFraction(fractionAt(event));
  }

  function onPointerDown(event: PointerEvent): void {
    dragging = true;
    seekAt(event);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!dragging) return;
    seekAt(event);
  }

  function onPointerUp(event: PointerEvent): void {
    if (dragging) seekAt(event);
    dragging = false;
  }
</script>

{#if interactive}
  <span
    class="seek"
    role="slider"
    tabindex="0"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(clamped * 100)}
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
  >
    {#if label}<span class="label">{label}</span>{/if}<span class="filled"
      >{bar.slice(0, filled)}</span
    ><span class="empty">{bar.slice(filled)}</span>
  </span>
{:else}
  <Meter value={progress} {width} {label} />
{/if}
{#if showTimes}
  <span class="times">{formatDuration(position)}/{formatDuration(duration)}</span>
{/if}

<style>
  .seek {
    font-family: var(--font-mono);
    white-space: nowrap;
    letter-spacing: -0.05em;
    cursor: pointer;
    touch-action: none;
  }
  .filled {
    color: var(--accent);
  }
  .empty {
    color: var(--fg-faint);
  }
  .label {
    margin-right: 0.5em;
    color: var(--fg-dim);
  }
  .times {
    flex: none;
    color: var(--fg-dim);
    font-variant-numeric: tabular-nums;
  }
</style>
