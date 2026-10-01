<!--
  Bottom line: the hint bar for whatever context is focused, plus the newest
  message. In a terminal UI this line is the only place transient feedback can
  live, so messages never stack up as dialogs.
-->
<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { formatChord } from '$lib/keyboard/keys';

  let hints = $derived(app.keyboard.hints().slice(0, 12));
  let toast = $derived(app.toasts.latest);
  let toastClass = $derived(
    toast?.kind === 'error'
      ? 'danger'
      : toast?.kind === 'warn'
        ? 'warn'
        : toast?.kind === 'ok'
          ? 'ok'
          : 'dim',
  );

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
</script>

<footer class="hints">
  {#if showHints}
    {#each hints as binding (binding.description)}
      <span class="hint">
        <span class="key">[{formatChord(binding.keys[0] ?? '')}]</span>
        <span class="label">{binding.description}</span>
      </span>
    {/each}
    <span class="hint">
      <span class="key">[?]</span><span class="label">help</span>
    </span>
  {:else}
    <span class="dim">key hints hidden (settings)</span>
  {/if}

  <span class="spacer"></span>

  {#if toast}
    <span class="toast {toastClass}" role="status">{toast.message}</span>
  {/if}
</footer>

<style>
  .hints {
    display: flex;
    align-items: center;
    gap: 0.9em;
    padding: 0.15rem 0.5rem;
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
    white-space: nowrap;
    overflow: hidden;
  }
  .hint {
    display: inline-flex;
    gap: 0.25em;
  }
  .key {
    color: var(--accent);
  }
  .label {
    color: var(--fg-dim);
  }
  .spacer {
    flex: 1;
  }
  .toast {
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 60ch;
  }
  .ok {
    color: var(--ok);
  }
  .warn {
    color: var(--warn);
  }
  .danger {
    color: var(--danger);
  }
  .dim {
    color: var(--fg-dim);
  }
</style>
