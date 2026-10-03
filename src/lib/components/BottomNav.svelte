<!--
  Touch bottom navigation.

  Generated from the shared destination table so its tabs, labels and targets
  cannot drift from the `:` palette. App.svelte mounts it only under the touch
  shell, so the desktop keeps its keyboard-driven terminal layout untouched.
-->
<script lang="ts">
  import { app } from '$lib/app.svelte';
  import { NAV_DESTINATIONS } from '$lib/ui/destinations';
</script>

<nav class="bottom-nav" aria-label="sections">
  {#each NAV_DESTINATIONS as destination (destination.key)}
    {@const active = destination.nav!.activeOn.includes(app.router.current.name)}
    <button
      class="tab"
      class:active
      aria-label="go to {destination.label}"
      aria-current={active ? 'page' : undefined}
      onclick={() => destination.run()}
    >
      {destination.label}
    </button>
  {/each}
</nav>

<style>
  .bottom-nav {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    border-top: 1px solid var(--border);
    background: var(--bg-elev-2);
    /* Keep the tabs clear of the Android gesture bar. */
    padding-bottom: calc(0.35rem + env(safe-area-inset-bottom, 0px));
  }
  .tab {
    flex: 1;
    min-height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.3em;
    padding: 0 0.4rem;
    background: none;
    border: none;
    border-left: 1px solid var(--border);
    color: var(--fg-dim);
    font: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    touch-action: manipulation;
  }
  .tab:first-child {
    border-left: none;
  }
  .tab.active {
    background: var(--accent);
    color: var(--bg);
    font-weight: 700;
  }
</style>
