<!--
  A centred modal, framed the way a terminal dialog is framed. Used by the help,
  queue, action and login overlays so they all share one visual contract.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import { app } from '$lib/app.svelte';

  interface Props {
    title: string;
    note?: string;
    width?: string;
    /** Allow the backdrop to close the overlay. */
    closeOnBackdrop?: boolean;
    children?: Snippet;
    footer?: Snippet;
  }

  let {
    title,
    note,
    width = 'min(92vw, 78ch)',
    closeOnBackdrop = true,
    children,
    footer,
  }: Props = $props();
</script>

<div
  class="backdrop"
  role="presentation"
  onclick={(event) => {
    if (closeOnBackdrop && event.target === event.currentTarget) app.ui.closeOverlay();
  }}
>
  <div class="dialog" role="dialog" aria-modal="true" aria-label={title} style="width: {width}">
    <div class="head">
      <span class="title">══ {title} ══</span>
      {#if note}<span class="note">{note}</span>{/if}
    </div>
    <div class="body">{@render children?.()}</div>
    {#if footer}
      <div class="foot">{@render footer()}</div>
    {/if}
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 800;
    /* Keep a tall dialog clear of the system bars in edge-to-edge (Android). */
    padding: calc(1rem + env(safe-area-inset-top, 0px)) calc(1rem + env(safe-area-inset-right, 0px))
      calc(1rem + env(safe-area-inset-bottom, 0px)) calc(1rem + env(safe-area-inset-left, 0px));
    animation: tui-fade-in 0.12s ease-out;
  }
  .dialog {
    background: var(--bg-elev);
    border: 1px solid var(--accent-dim);
    box-shadow: 0 12px 40px var(--shadow);
    max-height: 86vh;
    display: flex;
    flex-direction: column;
    animation: tui-slide-up 0.14s ease-out;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.3rem 0.6rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev-2);
  }
  .title {
    color: var(--accent);
    text-transform: uppercase;
    letter-spacing: 0.1em;
  }
  .note {
    margin-left: auto;
    color: var(--fg-faint);
  }
  .body {
    padding: 0.6rem;
    overflow-y: auto;
    min-height: 0;
  }
  .foot {
    border-top: 1px solid var(--border);
    padding: 0.3rem 0.6rem;
    color: var(--fg-dim);
  }
</style>
