<!--
  Keyboard help. Generated from the binding registry, so it can never fall out of
  date with the keys that actually work.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import Overlay from '$lib/components/Overlay.svelte';
  import {
    ListCursor,
    keepCursorRowVisible,
    listNavigationBindings,
  } from '$lib/keyboard/list.svelte';
  import { formatChord } from '$lib/keyboard/keys';
  import type { Binding } from '$lib/keyboard/registry.svelte';

  let cursor = new ListCursor();
  let container: HTMLDivElement | undefined = $state();
  let groups = $derived(app.keyboard.grouped());
  /** Flattened rows: a heading followed by its bindings. */
  let rows = $derived(
    groups.flatMap((group) => [
      { kind: 'heading' as const, label: group.group, binding: undefined as Binding | undefined },
      ...group.bindings.map((binding) => ({
        kind: 'binding' as const,
        label: binding.description,
        binding,
      })),
    ]),
  );

  // This overlay renders its own rows, so it owns the cursor count: without this
  // move() clamps against 0 and navigation is silently inert.
  $effect(() => cursor.setCount(rows.length));

  // …and having rendered its own rows it must scroll them itself too. The help
  // list is the longest in the app, so it was the most obvious place this was
  // missing: `j` walked the selection past the bottom edge and the list stayed.
  keepCursorRowVisible(
    () => container,
    () => cursor.index,
  );

  onMount(() =>
    app.keyboard.registerAll(listNavigationBindings(cursor, { scope: 'overlay', hint: false })),
  );
</script>

<Overlay title="keyboard" note="{rows.length} bindings" width="min(94vw, 84ch)">
  <div class="rows" bind:this={container}>
    {#each rows as row, index (index)}
      <div
        class="row"
        class:selected={cursor.isSelected(index)}
        class:heading={row.kind === 'heading'}
        data-row={index}
      >
        {#if row.kind === 'heading'}
          <span class="group tui-upper">── {row.label}</span>
        {:else if row.binding}
          <span class="keys">
            {#each row.binding.keys as key, keyIndex (key)}<span class="key">
                {formatChord(key)}{#if keyIndex < row.binding.keys.length - 1}<span class="or"
                    >/</span
                  >{/if}</span
              >{/each}
          </span>
          <span class="desc">{row.label}</span>
          <span class="scope">{row.binding.scope}</span>
        {/if}
      </div>
    {/each}
  </div>
</Overlay>

<style>
  .rows {
    display: flex;
    flex-direction: column;
  }
  .row {
    display: flex;
    align-items: baseline;
    gap: 0.6em;
    padding: 0 0.3em;
  }
  .row.selected {
    background: var(--accent);
    color: var(--bg);
  }
  .row.selected :global(.scope) {
    color: var(--bg);
  }
  .heading {
    margin-top: 0.5em;
    color: var(--accent);
  }
  .group {
    color: inherit;
  }
  .keys {
    flex: none;
    min-width: 12ch;
    color: var(--accent);
  }
  .row.selected .keys {
    color: var(--bg);
    font-weight: 700;
  }
  .key {
    white-space: nowrap;
  }
  .or {
    color: var(--fg-faint);
  }
  .desc {
    flex: 1;
    color: var(--fg);
  }
  .scope {
    color: var(--fg-faint);
    font-size: 0.9em;
  }
</style>
