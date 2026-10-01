<!--
  A block-character progress bar, the kind you would draw in a terminal.
  `████████░░░░░░░░`
-->
<script lang="ts">
  interface Props {
    value: number;
    /** Width in characters. */
    width?: number;
    showPercent?: boolean;
    label?: string;
  }

  let { value, width = 24, showPercent = false, label }: Props = $props();

  const FULL = '█';
  const EMPTY = '░';

  let clamped = $derived(Number.isFinite(value) ? Math.min(Math.max(value, 0), 1) : 0);
  let filled = $derived(Math.round(clamped * width));
  let bar = $derived(FULL.repeat(filled) + EMPTY.repeat(Math.max(0, width - filled)));
  let percent = $derived(`${Math.round(clamped * 100)}%`);
</script>

<span
  class="meter"
  role="progressbar"
  aria-valuemin="0"
  aria-valuemax="100"
  aria-valuenow={Math.round(clamped * 100)}
>
  {#if label}<span class="label">{label}</span>{/if}<span class="filled"
    >{bar.slice(0, filled)}</span
  ><span class="empty">{bar.slice(filled)}</span>{#if showPercent}<span class="percent"
      >{percent}</span
    >{/if}
</span>

<style>
  .meter {
    font-family: var(--font-mono);
    white-space: nowrap;
    letter-spacing: -0.05em;
  }
  .filled {
    color: var(--accent);
  }
  .empty {
    color: var(--fg-faint);
  }
  .percent {
    margin-left: 0.5em;
    color: var(--fg-dim);
  }
  .label {
    margin-right: 0.5em;
    color: var(--fg-dim);
  }
</style>
