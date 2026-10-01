/**
 * The global key map.
 *
 * Movement and selection are page-scoped (see keyboard/list.svelte.ts); this file holds
 * the actions that work anywhere: transport, volume, seeking, navigation via
 * `g`-prefixes, and the overlays.
 */

import type { App } from '$lib/app.svelte';
import type { Binding } from './registry.svelte';
import { nextSort } from '$lib/domain/sort';

export const GROUPS = {
  transport: 'playback',
  volume: 'volume',
  seek: 'seeking',
  navigate: 'navigation',
  library: 'library',
  overlays: 'windows',
  app: 'app',
} as const;

export function createGlobalBindings(app: App): Binding[] {
  const { player, queue, ui, router, settings, toasts } = app;

  return [
    // ------------------------------------------------------------ transport
    {
      keys: ['space'],
      scope: 'global',
      group: GROUPS.transport,
      description: 'play / pause',
      hint: true,
      run: () => void player.toggle(),
    },
    {
      keys: ['n', 'N'],
      scope: 'global',
      group: GROUPS.transport,
      description: 'next track',
      hint: true,
      run: () => void player.next(),
    },
    {
      keys: ['p'],
      scope: 'global',
      group: GROUPS.transport,
      description: 'previous track',
      hint: true,
      run: () => void player.previous(),
    },
    {
      keys: ['s'],
      scope: 'global',
      group: GROUPS.transport,
      description: 'toggle shuffle',
      run: () => {
        const on = player.toggleShuffle();
        toasts.info(`shuffle ${on ? 'on' : 'off'}`);
      },
    },
    {
      keys: ['r'],
      scope: 'global',
      group: GROUPS.transport,
      description: 'cycle repeat mode',
      run: () => {
        player.cycleRepeat();
        toasts.info(`repeat: ${queue.state.repeat}`);
      },
    },
    {
      keys: ['x'],
      scope: 'global',
      group: GROUPS.transport,
      description: 'clear the queue',
      run: () => {
        queue.clear();
        toasts.info('queue cleared');
      },
    },

    // --------------------------------------------------------------- volume
    {
      keys: ['+', '='],
      scope: 'global',
      group: GROUPS.volume,
      description: 'volume up',
      hint: true,
      run: () => player.volumeBy(0.05),
    },
    {
      keys: ['-', '_'],
      scope: 'global',
      group: GROUPS.volume,
      description: 'volume down',
      hint: true,
      run: () => player.volumeBy(-0.05),
    },
    {
      keys: ['m'],
      scope: 'global',
      group: GROUPS.volume,
      description: 'mute / unmute',
      run: () => {
        player.toggleMute();
        toasts.info(player.muted ? 'muted' : 'unmuted');
      },
    },

    // -------------------------------------------------------------- seeking
    {
      keys: ['l', 'right'],
      scope: 'global',
      group: GROUPS.seek,
      description: 'seek forward 5s',
      run: () => player.seekBy(5),
    },
    {
      keys: ['h', 'left'],
      scope: 'global',
      group: GROUPS.seek,
      description: 'seek back 5s',
      run: () => player.seekBy(-5),
    },
    {
      keys: ['0'],
      scope: 'global',
      group: GROUPS.seek,
      description: 'restart track',
      run: () => player.seek(0),
    },

    // ------------------------------------------------------------ navigation
    {
      keys: ['g h'],
      scope: 'global',
      group: GROUPS.navigate,
      description: 'go home',
      hint: true,
      run: () => router.navigate({ name: 'home' }),
    },
    {
      keys: ['g a'],
      scope: 'global',
      group: GROUPS.navigate,
      description: 'go to albums',
      hint: true,
      run: () => router.navigate({ name: 'albums', sort: 'newest' }),
    },
    {
      keys: ['g r'],
      scope: 'global',
      group: GROUPS.navigate,
      description: 'go to artists',
      run: () => router.navigate({ name: 'artists' }),
    },
    {
      keys: ['g p'],
      scope: 'global',
      group: GROUPS.navigate,
      description: 'go to playlists',
      run: () => router.navigate({ name: 'playlists' }),
    },
    {
      keys: ['g f'],
      scope: 'global',
      group: GROUPS.navigate,
      description: 'go to favorites',
      run: () => router.navigate({ name: 'favorites' }),
    },
    {
      keys: ['g l'],
      scope: 'global',
      group: GROUPS.navigate,
      description: 'go to listen later',
      run: () => router.navigate({ name: 'listen-later' }),
    },
    {
      keys: ['g n'],
      scope: 'global',
      group: GROUPS.navigate,
      description: 'go to now playing',
      hint: true,
      run: () => router.navigate({ name: 'now-playing' }),
    },
    {
      keys: ['g s'],
      scope: 'global',
      group: GROUPS.navigate,
      description: 'go to settings',
      run: () => router.navigate({ name: 'settings' }),
    },
    {
      keys: ['q', 'escape'],
      scope: 'global',
      group: GROUPS.navigate,
      description: 'back / close',
      hint: true,
      run: () => {
        if (ui.anyOverlayOpen) {
          ui.closeOverlay();
          return;
        }
        if (!router.back()) toasts.info('nothing to go back to');
      },
    },

    // --------------------------------------------------------------- library
    {
      keys: ['z'],
      scope: 'global',
      group: GROUPS.library,
      description: 'next album sort order',
      run: () => {
        const current = router.current;
        const sort = current.name === 'albums' ? current.sort : 'newest';
        const next = nextSort(sort, 1);
        router.navigate({ name: 'albums', sort: next });
        toasts.info(`sort: ${next}`);
      },
    },
    {
      keys: ['R'],
      scope: 'global',
      group: GROUPS.library,
      description: 'reload the current view',
      run: () => void app.refreshCurrentView(),
    },

    // -------------------------------------------------------------- overlays
    {
      keys: ['?'],
      scope: 'global',
      group: GROUPS.overlays,
      description: 'keyboard help',
      hint: true,
      run: () => ui.toggleOverlay('help'),
    },
    {
      keys: ['Q'],
      scope: 'global',
      group: GROUPS.overlays,
      description: 'queue window',
      hint: true,
      run: () => ui.toggleOverlay('queue'),
    },
    {
      keys: [':'],
      scope: 'global',
      group: GROUPS.overlays,
      description: 'go to… (palette)',
      hint: true,
      run: () => ui.openOverlay('palette'),
    },

    {
      keys: ['/'],
      scope: 'global',
      group: GROUPS.overlays,
      description: 'search',
      hint: true,
      run: () => {
        router.navigate({ name: 'search', query: app.search.state.query });
        app.focusSearch();
      },
    },

    // ------------------------------------------------------------------- app
    {
      keys: ['T'],
      scope: 'global',
      group: GROUPS.app,
      description: 'cycle theme',
      run: () => {
        settings.cycleTheme();
        toasts.info(`theme: ${settings.state.theme}`);
      },
    },
    {
      keys: ['C'],
      scope: 'global',
      group: GROUPS.app,
      description: 'cycle accent colour',
      run: () => {
        settings.cycleAccent();
        toasts.info(`accent: ${settings.state.accent}`);
      },
    },
    {
      keys: ['D'],
      scope: 'global',
      group: GROUPS.app,
      description: 'toggle auto-dj',
      run: () => {
        settings.toggle('autoDj');
        toasts.info(`auto-dj ${settings.state.autoDj ? 'on' : 'off'}`);
      },
    },
    {
      keys: ['V'],
      scope: 'global',
      group: GROUPS.app,
      description: 'toggle CRT effects',
      run: () => {
        settings.toggle('crtEffects');
        toasts.info(`crt effects ${settings.state.crtEffects ? 'on' : 'off'}`);
      },
    },
  ];
}

/** Percent-jump bindings for `1`..`9`, generated so the table stays short. */
export function createPercentSeekBindings(app: App): Binding[] {
  return Array.from({ length: 9 }, (_, index) => ({
    keys: [String(index + 1)],
    scope: 'global' as const,
    group: GROUPS.seek,
    description: `seek to ${(index + 1) * 10}%`,
    run: () => app.player.seekFraction((index + 1) / 10),
  }));
}
