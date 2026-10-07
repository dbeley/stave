<!--
  Bottom line: the hint bar for whatever context is focused, plus the newest
  message. In a terminal UI this line is the only place transient feedback can
  live, so messages never stack up as dialogs.

  Two things this row has to get right, and used to get wrong:

  - The message keeps its own space. As one flat `nowrap` row the hints
    overflowed it, and the message — which came last — was pushed past the right
    edge and became invisible exactly when there was something to say. The hints
    now live in their own shrinking box and are measured against what is left.
  - An entry that does not fit is dropped whole, never clipped mid-label: a
    half-drawn `[q] back / clos` reads like a broken key rather than a full row.
    Which ones fit is measured rather than guessed, because the width of a label
    depends on the theme's font. `?` is pinned (see `globalBindings`), so the way
    to see everything else always stays on screen.

  The bar itself renders no binding of its own: it used to append a second,
  differently-labelled `[?]` beside the one from the registry, which is how the
  same key ended up documented twice in a single row.
-->
<script lang="ts">
  import { app } from '$lib/app.svelte';
  import ToastLine from '$lib/components/ToastLine.svelte';
  import { formatChord } from '$lib/keyboard/keys';
  import type { Binding } from '$lib/keyboard/registry.svelte';
  import { fittedIndexes } from '$lib/utils/fit';

  interface Entry {
    binding: Binding;
    /** Already formatted for display, without the brackets. */
    key: string;
    label: string;
  }

  let pending = $derived(app.keyboard.pendingSequence);
  /** Where the half-typed prefix can lead, in registry order. */
  let leader = $derived(app.keyboard.continuations());

  /*
   * Key hints are noise on a touch device: they name keys that do not exist
   * there. The message line stays, because in this UI it is the only place
   * transient feedback lives. Navigation on touch goes through the status bar's
   * `[:]` chip instead.
   */
  const coarsePointer =
    typeof globalThis.matchMedia === 'function' &&
    globalThis.matchMedia('(pointer: coarse)').matches;
  let showHints = $derived(app.settings.state.keyHints && !coarsePointer);

  /**
   * A half-typed sequence shows where it leads instead of the ordinary context
   * hints: the whole point of a leader is that you may not remember what follows
   * it. The prefix itself is already on the status bar, so it is not repeated.
   */
  let leaderMode = $derived(Boolean(pending) && leader.length > 0);
  let hiddenMode = $derived(!leaderMode && !showHints);

  function tailOf(key: string): string {
    return formatChord(key.slice(pending.length + 1));
  }

  const offered = $derived<Entry[]>(
    leaderMode
      ? leader.map((binding) => ({
          binding,
          key: tailOf(binding.keys[0] ?? ''),
          label: binding.description,
        }))
      : hiddenMode
        ? []
        : app.keyboard.hints().map((binding) => ({
            binding,
            key: formatChord(binding.keys[0] ?? ''),
            label: binding.description,
          })),
  );

  let listEl: HTMLElement | undefined = $state();
  /** A second, hidden copy of the full row: never clipped, so always measurable. */
  let probeEl: HTMLElement | undefined = $state();

  /** Indexes to render, or null while the layout is still unknown. */
  let fitted = $state<number[] | null>(null);
  let shown = $derived.by(() => {
    const keep = fitted;
    return keep === null ? offered : offered.filter((_, index) => keep.includes(index));
  });

  $effect(() => {
    const probe = probeEl;
    const list = listEl;
    if (!probe || !list) return;

    const measure = () => {
      fitted = fittedIndexes(
        offered.map((entry, index) => ({
          width: widthAt(probe, index),
          pinned: entry.binding.pinned === true,
        })),
        list.clientWidth,
        gapOf(probe),
      );
    };

    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  });

  /** Natural width of the `index`-th probe entry. */
  function widthAt(probe: HTMLElement, index: number): number {
    const node = probe.children[index];
    return node ? node.getBoundingClientRect().width : 0;
  }

  /** The row's gap, as the browser resolved it, so it cannot drift from the CSS. */
  function gapOf(probe: HTMLElement): number {
    return Number.parseFloat(globalThis.getComputedStyle(probe).columnGap) || 0;
  }
</script>

<footer class="hints">
  {#if hiddenMode}
    <span class="dim">key hints hidden (settings)</span>
  {:else}
    <span
      class="list"
      class:leader={leaderMode}
      bind:this={listEl}
      role={leaderMode ? 'status' : undefined}
      aria-label={leaderMode ? 'key sequence' : undefined}
    >
      {#if leaderMode}
        <span class="key pending">[{pending}]</span>
      {/if}
      {#each shown as entry (entry.binding)}
        {@render hint(entry, false)}
      {/each}
    </span>
  {/if}

  <span class="message"><ToastLine /></span>

  <!--
    The same entries again, out of the row's flow and under their own class:
    `visibility: hidden` still lays an element out, so the natural width of every
    label can be read even though the visible copy has already dropped the ones
    that did not fit. Deliberately not `.hint` — that is the visible row's
    contract, and a second, invisible match under it would break anything asking
    the page what the bar is offering.
  -->
  <span class="probe" class:leader={leaderMode} aria-hidden="true" bind:this={probeEl}>
    {#each offered as entry (entry.binding)}
      {@render hint(entry, true)}
    {/each}
  </span>
</footer>

{#snippet hint(entry: Entry, measured: boolean)}
  <span class={measured ? 'measure' : 'hint'}>
    <span class="key">[{entry.key}]</span>
    <span class="label">{entry.label}</span>
  </span>
{/snippet}

<style>
  .hints {
    display: flex;
    align-items: center;
    gap: 0.9em;
    /*
      Mirror of the status bar: extend the footer under the navigation /
      gesture bar and keep its content clear of it.
    */
    padding: 0.15rem calc(0.5rem + env(safe-area-inset-right, 0px))
      calc(0.15rem + env(safe-area-inset-bottom, 0px)) calc(0.5rem + env(safe-area-inset-left, 0px));
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
    white-space: nowrap;
    overflow: hidden;
  }
  /*
    `flex: 1 1 auto` + `min-width: 0` is what gives the message its space: the
    hints take the row and then shrink to whatever the message does not need,
    instead of overflowing it.
  */
  .list,
  .probe {
    display: flex;
    align-items: center;
    gap: 0.9em;
  }
  .list {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
  }
  .probe {
    position: absolute;
    top: 0;
    left: 0;
    width: 0;
    height: 0;
    overflow: hidden;
    visibility: hidden;
    pointer-events: none;
  }
  .message {
    flex: none;
    margin-left: auto;
  }
  .hint,
  .measure {
    display: inline-flex;
    gap: 0.25em;
    /* Never squeezed: a shrunken item would overlap its neighbour rather than
       report the width the row is fitted against. */
    flex: none;
  }
  .key {
    color: var(--accent);
  }
  /* While a sequence is half-typed the prefix carries the emphasis. */
  .leader .key {
    font-weight: 700;
  }
  .label {
    color: var(--fg-dim);
  }
  .dim {
    color: var(--fg-dim);
  }
</style>
