<!--
  The tab strip for every tabbed view.

  One component, because there used to be two: the favourites sections were
  borderless text with a left accent bar and the album sort orders were bordered
  chips, so the same gesture looked different depending on the page. This is that
  chip look, which matches the app's other buttons, plus the counts the favourites
  bar contributed.

  It renders only. The `tab` / `shift+tab` shortcuts come from `tabBindings()` and
  are registered by the page, so markup and keys stay separable and testable.
-->
<script lang="ts">
  export interface Tab {
    id: string;
    label: string;
    /** Shown after the label when the caller has something to count. */
    count?: number;
    /** Tooltip suffix, e.g. the shortcut or the meaning of the sort. */
    hint?: string;
  }

  interface Props {
    tabs: Tab[];
    /** Id of the tab shown now. */
    active: string;
    onSelect: (id: string) => void;
    ariaLabel?: string;
    /** Right-aligned keyboard reminder. Hidden on coarse pointers. */
    tip?: string;
    /** Right-aligned status text, e.g. how many rows are loaded. */
    note?: string;
  }

  let { tabs, active, onSelect, ariaLabel = 'tabs', tip = '', note = '' }: Props = $props();
</script>

<div class="tabs" role="tablist" aria-label={ariaLabel}>
  {#each tabs as tab (tab.id)}
    <button
      type="button"
      class="tab"
      class:active={tab.id === active}
      role="tab"
      aria-selected={tab.id === active}
      title={tab.hint ? `${tab.label} (${tab.hint})` : tab.label}
      onclick={() => onSelect(tab.id)}
      data-tab={tab.id}
    >
      {tab.label}{#if tab.count !== undefined}<span class="count">{tab.count}</span>{/if}
    </button>
  {/each}
  <span class="spacer"></span>
  {#if note}<span class="note dim">{note}</span>{/if}
  {#if tip}<span class="tip dim">{tip}</span>{/if}
</div>

<style>
  .tabs {
    display: flex;
    align-items: center;
    gap: 0.3em;
    flex-wrap: wrap;
  }
  .tab {
    border: 1px solid var(--border);
    background: none;
    padding: 0.1rem 0.5rem;
    font: inherit;
    color: var(--fg-dim);
    cursor: pointer;
  }
  .tab:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  .tab.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
    font-weight: 700;
  }
  .count {
    margin-left: 0.35em;
    color: var(--fg-faint);
  }
  .tab.active .count {
    color: var(--bg);
    opacity: 0.75;
  }
  .spacer {
    flex: 1;
  }
  .note {
    margin-left: 0.4em;
  }
  .tip {
    margin-left: 0.6em;
    font-size: 0.9em;
  }
  /* Key hints are noise where the keys do not exist. */
  @media (pointer: coarse) {
    .tip {
      display: none;
    }
  }
</style>
