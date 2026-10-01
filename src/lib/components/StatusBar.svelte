<!--
  Header line: who we are, where we are, and what the player is doing.
  Reads like a terminal's status bar.
-->
<script lang="ts">
  import { APP_NAME, APP_VERSION } from '$lib/config';
  import { app } from '$lib/app.svelte';
  import { routeTitle } from '$lib/stores/router.svelte';

  let now = $state(new Date());

  $effect(() => {
    const timer = setInterval(() => {
      now = new Date();
    }, 1000);
    return () => clearInterval(timer);
  });

  let clock = $derived(
    `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`,
  );

  let connection = $derived(app.connection);
  let statusGlyph = $derived(
    connection.status === 'connected' ? '●' : connection.status === 'connecting' ? '○' : '✕',
  );
  let statusClass = $derived(
    connection.status === 'connected' ? 'ok' : connection.status === 'error' ? 'danger' : 'dim',
  );

  let pending = $derived(app.keyboard.pendingSequence);

  let offline = $derived({
    enabled: app.settings.state.offlineCacheEnabled,
    cached: app.resolver.cachedCount,
    downloading: app.downloads.entries.filter((entry) => entry.status === 'downloading').length,
  });
</script>

<header class="status">
  <span class="brand tui-upper">{APP_NAME}</span>
  <span class="dim narrow-hide">v{APP_VERSION}</span>
  <span class="sep narrow-hide">│</span>
  <span class="route">{routeTitle(app.router.current)}</span>

  <!--
    Touch entry point for navigation. A phone has no keyboard and every
    destination is a `g`-chord, so this chip is the only way to reach the other
    sections. It sits in the left cluster so a narrow screen cannot clip it.
  -->
  <button
    class="palette"
    type="button"
    title="go to ( : )"
    aria-label="open the go-to palette"
    onclick={() => app.ui.openOverlay('palette')}
  >
    [:]
  </button>

  <span class="spacer"></span>

  {#if pending}
    <span class="pending" title="waiting for the rest of the key sequence">[{pending}]</span>
  {/if}

  {#if app.settings.state.autoDj}
    <span class="badge" title="auto-dj is on">dj</span>
  {/if}
  {#if offline.enabled}
    <span class="badge" title="offline cache">
      ⌂{offline.cached}{#if offline.downloading > 0}↓{offline.downloading}{/if}
    </span>
  {/if}
  {#if app.queue.length > 0}
    <span class="badge" title="queue length">≡{app.queue.length}</span>
  {/if}

  <span class="sep">│</span>
  <span class={statusClass} title={connection.error ?? connection.serverVersion ?? ''}>
    {statusGlyph}
    {#if connection.status === 'connected'}
      {connection.serverVersion ?? 'ok'}
    {:else if connection.status === 'connecting'}
      connecting
    {:else if connection.status === 'error'}
      offline
    {:else}
      not connected
    {/if}
  </span>
  <span class="sep narrow-hide">│</span>
  <span class="dim narrow-hide">{clock}</span>
</header>

<style>
  .status {
    display: flex;
    align-items: center;
    gap: 0.5em;
    padding: 0.15rem 0.5rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg-elev);
    white-space: nowrap;
    overflow: hidden;
  }
  .brand {
    color: var(--accent);
    font-weight: 700;
  }
  .route {
    color: var(--fg);
  }
  .spacer {
    flex: 1;
  }
  .sep {
    color: var(--border-focus);
  }
  .dim {
    color: var(--fg-dim);
  }
  .ok {
    color: var(--ok);
  }
  .danger {
    color: var(--danger);
  }
  .badge {
    border: 1px solid var(--border);
    padding: 0 0.3em;
    color: var(--fg-dim);
  }
  .pending {
    color: var(--accent);
  }
  .palette {
    flex: none;
    border: 1px solid var(--border-focus);
    padding: 0 0.35em;
    background: transparent;
    color: var(--accent);
    font: inherit;
    cursor: pointer;
  }
  .palette:hover {
    background: var(--accent-dim);
    color: var(--bg);
  }
  /*
    Phones: drop the least useful columns (version, clock) so the route and the
    palette chip survive the header's `overflow: hidden`.
  */
  @media (max-width: 640px) {
    .narrow-hide {
      display: none;
    }
  }
</style>
