<!--
  The message line: the newest toast, shared by both shells so transient
  feedback is never invisible.

  On the terminal shell it is rendered inside `HintBar` as an inline span in
  the same place the toast always lived. On the touch shell `App` renders it
  with `strip`, its own bottom strip above the mini-player / bottom nav.
-->
<script lang="ts">
  import { app } from '$lib/app.svelte';

  interface Props {
    /** Render as a standalone bottom strip (touch shell) instead of an inline span. */
    strip?: boolean;
  }

  let { strip = false }: Props = $props();

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
</script>

{#if toast}
  {#if strip}
    <div class="strip" role="status">
      <span class="toast {toastClass}">{toast.message}</span>
    </div>
  {:else}
    <span class="toast {toastClass}" role="status">{toast.message}</span>
  {/if}
{/if}

<style>
  .strip {
    display: flex;
    align-items: center;
    /*
      Mirror of the status bar / hint bar: extend under the gesture bar and keep
      the message clear of it.
    */
    padding: 0.15rem calc(0.5rem + env(safe-area-inset-right, 0px))
      calc(0.15rem + env(safe-area-inset-bottom, 0px)) calc(0.5rem + env(safe-area-inset-left, 0px));
    border-top: 1px solid var(--border);
    background: var(--bg-elev);
    white-space: nowrap;
    overflow: hidden;
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
