<!--
  Settings: a terminal-style form.
 *
 * j/k move, enter/space activate and h/l (or ←/→) cycle the value under the
 * cursor. `h` and `l` are registered at *page* scope on purpose: they shadow
 * the global seek bindings only while this page is focused.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '$lib/app.svelte';
  import ListView from '$lib/components/ListView.svelte';
  import Panel from '$lib/components/Panel.svelte';
  import { APP_VERSION } from '$lib/config';
  import { platformLabel } from '$lib/offline/platform';
  import { ListCursor, listNavigationBindings } from '$lib/keyboard/list.svelte';
  import { BITRATE_CHOICES, HOST_THEME } from '$lib/stores/settings.svelte';

  /** Cycle choices for the numeric rows (kept local; not user data). */
  const THRESHOLDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
  const BATCH_SIZES = [5, 10, 20, 30, 50] as const;
  const VISIBLE_PAGE_SIZES = [25, 50, 100, 200] as const;

  interface SettingRow {
    id: string;
    label: string;
    /** Rendered right-aligned; empty means "action, no value". */
    value: () => string;
    activate: () => void;
    /** Absent for action-only rows. */
    cycle?: (direction: number) => void;
  }

  let cursor = new ListCursor();
  let rows = $derived<SettingRow[]>(buildRows());

  function onOff(value: boolean): string {
    return value ? 'on' : 'off';
  }

  function bitrateLabel(value: number): string {
    return value === 0 ? 'original' : `${value} kbps`;
  }

  function cycleChoice(choices: readonly number[], current: number, direction: number): number {
    const index = choices.indexOf(current);
    const start = index < 0 ? 0 : index + direction;
    return choices[(start + choices.length) % choices.length]!;
  }

  function buildRows(): SettingRow[] {
    const s = app.settings.state;
    const list: SettingRow[] = [
      {
        id: 'theme',
        label: 'theme',
        // Name the source: "host" alone would not tell you where it comes from,
        // and this theme only exists when the deployment supplies a palette.
        value: () => (s.theme === HOST_THEME ? 'host (stylix)' : s.theme),
        activate: () => app.settings.cycleTheme(1),
        cycle: (direction) => app.settings.cycleTheme(direction),
      },
      {
        id: 'accent',
        label: 'accent colour',
        value: () => s.accent,
        activate: () => app.settings.cycleAccent(1),
        cycle: (direction) => app.settings.cycleAccent(direction),
      },
      {
        id: 'crtEffects',
        label: 'crt effects',
        value: () => onOff(s.crtEffects),
        activate: () => app.settings.toggle('crtEffects'),
        cycle: () => app.settings.toggle('crtEffects'),
      },
      {
        id: 'asciiCoverArt',
        label: 'ascii covers',
        value: () => onOff(s.asciiCoverArt),
        activate: () => app.settings.toggle('asciiCoverArt'),
        cycle: () => app.settings.toggle('asciiCoverArt'),
      },
      {
        id: 'keyHints',
        label: 'key hints',
        value: () => onOff(s.keyHints),
        activate: () => app.settings.toggle('keyHints'),
        cycle: () => app.settings.toggle('keyHints'),
      },
      {
        id: 'showTechnicalColumns',
        label: 'technical columns',
        value: () => onOff(s.showTechnicalColumns),
        activate: () => app.settings.toggle('showTechnicalColumns'),
        cycle: () => app.settings.toggle('showTechnicalColumns'),
      },
      {
        id: 'autoDj',
        label: 'auto-dj',
        value: () => onOff(s.autoDj),
        activate: () => app.settings.toggle('autoDj'),
        cycle: () => app.settings.toggle('autoDj'),
      },
      {
        id: 'autoDjThreshold',
        label: 'auto-dj refill threshold',
        value: () => String(s.autoDjThreshold),
        activate: () => cycleThreshold(1),
        cycle: (direction) => cycleThreshold(direction),
      },
      {
        id: 'autoDjBatchSize',
        label: 'auto-dj batch size',
        value: () => String(s.autoDjBatchSize),
        activate: () => cycleBatch(1),
        cycle: (direction) => cycleBatch(direction),
      },
      {
        id: 'offlineCacheEnabled',
        label: 'offline cache',
        value: () => onOff(s.offlineCacheEnabled),
        activate: () => app.setOfflineCacheEnabled(!s.offlineCacheEnabled),
        cycle: () => app.setOfflineCacheEnabled(!s.offlineCacheEnabled),
      },
      {
        id: 'clearOfflineCache',
        label: 'clear offline cache',
        value: () => String(app.resolver.cachedCount),
        activate: () => void app.clearOfflineCache(),
      },
      {
        id: 'scrobblingEnabled',
        label: 'scrobbling',
        value: () => onOff(s.scrobblingEnabled),
        activate: () => app.settings.toggle('scrobblingEnabled'),
        cycle: () => app.settings.toggle('scrobblingEnabled'),
      },
      {
        id: 'streamMaxBitRate',
        label: 'streaming quality',
        value: () => bitrateLabel(s.streamMaxBitRate),
        activate: () => cycleBitrate(1),
        cycle: (direction) => cycleBitrate(direction),
      },
      {
        id: 'pageSize',
        label: 'page size',
        value: () => String(s.pageSize),
        activate: () => cyclePageSize(1),
        cycle: (direction) => cyclePageSize(direction),
      },
      {
        id: 'credentials',
        label: 'credentials',
        value: () => '',
        activate: () => app.ui.openOverlay('login'),
      },
    ];

    if (app.isConnected) {
      list.push({
        id: 'signOut',
        label: 'sign out',
        value: () => '',
        activate: () => app.disconnect(),
      });
    }

    return list;
  }

  function cycleThreshold(direction: number): void {
    app.settings.update({
      autoDjThreshold: cycleChoice(THRESHOLDS, app.settings.state.autoDjThreshold, direction),
    });
  }

  function cycleBatch(direction: number): void {
    app.settings.update({
      autoDjBatchSize: cycleChoice(BATCH_SIZES, app.settings.state.autoDjBatchSize, direction),
    });
  }

  function cycleBitrate(direction: number): void {
    app.settings.update({
      streamMaxBitRate: cycleChoice(
        BITRATE_CHOICES,
        app.settings.state.streamMaxBitRate,
        direction,
      ),
    });
  }

  function cyclePageSize(direction: number): void {
    app.settings.update({
      pageSize: cycleChoice(VISIBLE_PAGE_SIZES, app.settings.state.pageSize, direction),
    });
  }

  function activateSelected(): void {
    cursor.selected(rows)?.activate();
  }

  function cycleSelected(direction: number): void {
    cursor.selected(rows)?.cycle?.(direction);
  }

  onMount(() =>
    app.keyboard.registerAll([
      ...listNavigationBindings(cursor, { hint: true, onActivate: () => activateSelected() }),
      // Page scope: these intentionally shadow the global h/l seek bindings.
      {
        keys: ['h', 'left'],
        scope: 'page',
        group: 'settings',
        description: 'previous value',
        hint: true,
        run: () => cycleSelected(-1),
      },
      {
        keys: ['l', 'right'],
        scope: 'page',
        group: 'settings',
        description: 'next value',
        hint: true,
        run: () => cycleSelected(1),
      },
      {
        keys: ['space'],
        scope: 'page',
        group: 'settings',
        description: 'activate',
        hint: true,
        run: () => activateSelected(),
      },
    ]),
  );
</script>

<main class="page">
  <Panel title="settings" note={rows.length} active={true} scroll={true} grow={true}>
    <ListView
      items={rows}
      {cursor}
      keyOf={(row) => row.id}
      ariaLabel="settings"
      onActivate={(row) => row.activate()}
    >
      {#snippet row(setting)}
        {@const value = setting.value()}
        <div class="setting">
          <span class="label">{setting.label}</span>
          <span class="spacer"></span>
          {#if value}<span class="value">{value}</span>{/if}
        </div>
      {/snippet}
    </ListView>
  </Panel>

  <Panel title="about">
    <dl class="info">
      <dt>version</dt>
      <dd>{APP_VERSION}</dd>
      <dt>connection</dt>
      <dd>
        {app.connection.status}{#if app.connection.serverVersion}
          · {app.connection.serverVersion}{/if}
      </dd>
      <dt>server</dt>
      <dd>{app.credentials.state.server}</dd>
      <dt>platform</dt>
      <dd>{platformLabel()}</dd>
    </dl>
    <p class="note">
      local only — your password is stored on this device only when “remember” was ticked, never on
      the server.
    </p>
  </Panel>
</main>

<style>
  .page {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    padding: 0.55rem;
    gap: 0.5rem;
  }
  .setting {
    display: flex;
    align-items: baseline;
    gap: 0.5em;
    min-width: 0;
  }
  .label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .spacer {
    flex: 1;
  }
  .value {
    flex: none;
    color: var(--accent);
  }
  /* The focused row paints itself with the accent, so a value drawn in the accent
     vanishes into it — measured in the browser, both were rgb(255,140,66). Same
     fix ListView already applies to .dim and .badge. */
  :global(.row.selected) .value {
    color: var(--bg);
  }
  .info {
    display: grid;
    grid-template-columns: 10ch 1fr;
    gap: 0.1rem 0.5rem;
    margin: 0;
  }
  /* On a phone the fixed label column leaves too little room for the value. */
  @media (max-width: 640px) {
    .info {
      grid-template-columns: 1fr;
    }
    .info dd {
      margin: 0 0 0.3rem;
    }
  }
  .info dt {
    color: var(--fg-faint);
  }
  .info dd {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .note {
    margin: 0.5rem 0 0;
    color: var(--fg-faint);
    font-size: 0.92em;
  }
</style>
