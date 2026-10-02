/**
 * Android hardware back button.
 *
 * Capacitor is only present on the native shell, so `@capacitor/app` is
 * imported lazily (same pattern as the offline blob store): nothing in the web
 * bundle or the test suite depends on the native runtime being there. On the
 * web/jsdom path the import or plugin lookup fails and this degrades to a
 * no-op teardown, leaving PWA behaviour untouched.
 */

export interface BackButtonOptions {
  /**
   * Handle a back gesture. Return `true` when the app consumed it (closed an
   * overlay, walked in-app history); return `false` to let the OS exit.
   */
  onBack: () => boolean;
}

/** Minimal shape of the parts of the plugin we actually use. */
interface AppPluginLike {
  addListener(
    eventName: 'backButton',
    listenerFunc: () => void,
  ): Promise<{ remove: () => Promise<void> }>;
  exitApp(): Promise<void>;
}

/**
 * Wire the hardware back button to `opts.onBack`.
 *
 * Resolves to a teardown function that removes the listener. If the plugin is
 * unavailable (web, tests) it resolves to a no-op.
 */
export async function registerBackButton(opts: BackButtonOptions): Promise<() => void> {
  let plugin: AppPluginLike;
  try {
    const mod = (await import('@capacitor/app')) as unknown as { App?: AppPluginLike };
    if (!mod.App) return () => {};
    plugin = mod.App;
  } catch {
    return () => {};
  }

  try {
    const handle = await plugin.addListener('backButton', () => {
      if (!opts.onBack()) void plugin.exitApp();
    });
    return () => {
      void handle.remove();
    };
  } catch {
    return () => {};
  }
}
