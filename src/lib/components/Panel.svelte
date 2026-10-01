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
    padding: 0.55rem 0.4rem 0.4rem;
    min-height: 0;
  }
  .body.scroll {
    overflow-y: auto;
    overflow-x: hidden;
  }
  .body.grow {
    flex: 1;
  }
  .panel.grow {
    flex: 1;
  }
</style>
