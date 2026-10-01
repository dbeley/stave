<!--
  A framed pane with a title cut into the top border.

    ┌───────────────────────────┐
    ┤ library ├                 │
    │ ...                       │
    └───────────────────────────┘

  The frame is a CSS border (crisp at any size) while the title uses the
  box-drawing glyphs, which is what makes it read as a terminal window.
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title?: string;
    /** Highlight the pane, the way a focused terminal window looks. */
    active?: boolean;
    /** Right-aligned annotation in the title, e.g. a count. */
    note?: string | number;
    /** Let the body scroll instead of growing the page. */
    scroll?: boolean;
    grow?: boolean;
    children?: Snippet;
  }

  let {
    title = '',
    active = false,
    note,
    scroll = false,
    grow = false,
    children,
  }: Props = $props();
</script>

<section class="panel" class:active class:grow>
  {#if title}
    <span class="title">┤ {title} ├</span>
    {#if note}<span class="note">{note}</span>{/if}
  {/if}
  <div class="body" class:scroll class:grow>
    {@render children?.()}
  </div>
</section>

<style>
  .panel {
    position: relative;
    border: 1px solid var(--border);
    background: var(--bg);
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .panel.active {
    border-color: var(--border-focus);
  }
  .title {
    position: absolute;
    top: -0.62em;
    left: 0.55rem;
    padding: 0 0.3em;
    background: var(--bg);
    color: var(--fg-dim);
    white-space: nowrap;
    max-width: calc(100% - 1.5rem);
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .panel.active .title {
    color: var(--accent);
  }
  .note {
    position: absolute;
    top: -0.62em;
    right: 0.55rem;
    padding: 0 0.3em;
    background: var(--bg);
    color: var(--fg-faint);
    white-space: nowrap;
  }
  .body {
    /*
     * The title straddles the top border and its glyph box reaches ~10px into the
     * panel, which used to leave its lower 3px sitting on the first row — measured,
     * not guessed: titleBottom 49 vs firstTop 46. The top padding is what reserves
     * the header's space, so nothing is ever drawn under it.
     */
    padding: 0.85rem 0.4rem 0.4rem;
    min-height: 0;
  }
  .body.scroll {
    overflow-y: auto;
    overflow-x: hidden;
    /*
     * And while scrolling, `scrollIntoView({block:'nearest'})` aligns a row flush
     * with the scrollport's edge — which is *under* the title. scroll-padding keeps
     * that edge below the header, so `k` back to the top lands on a visible row.
     */
    scroll-padding-top: 0.9rem;
  }
  .body.grow {
    flex: 1;
  }
  .panel.grow {
    flex: 1;
  }
</style>
