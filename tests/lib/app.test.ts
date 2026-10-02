import { describe, it, expect, vi } from 'vitest';
import { App } from '$lib/app.svelte';
import type { Binding } from '$lib/keyboard/registry.svelte';

function makeApp(): App {
  // `native: true` avoids the Capacitor blob-store probe; everything else the
  // constructor needs is present in jsdom + fake-indexeddb.
  return new App({ native: true });
}

function binding(over: Partial<Binding>): Binding {
  return {
    keys: ['A'],
    scope: 'page',
    group: 'test',
    description: 'test',
    run: () => {},
    ...over,
  };
}

const key = (k: string) => new KeyboardEvent('keydown', { key: k });

describe('overlay scope isolation', () => {
  it('ignores page bindings while an overlay is open, and restores them after', () => {
    const app = makeApp();
    const pageRun = vi.fn();
    const overlayRun = vi.fn();
    app.keyboard.register(binding({ keys: ['A'], scope: 'page', run: pageRun }));
    app.keyboard.register(binding({ keys: ['z'], scope: 'overlay', run: overlayRun }));

    app.ui.openOverlay('queue');

    // The page's `A` (e.g. "add album to queue") must not fire behind the modal.
    expect(app.handleKeydown(key('A'))).toBe(false);
    expect(pageRun).not.toHaveBeenCalled();

    // The overlay's own bindings still work.
    expect(app.handleKeydown(key('z'))).toBe(true);
    expect(overlayRun).toHaveBeenCalledTimes(1);

    app.ui.closeOverlay();
    expect(app.handleKeydown(key('A'))).toBe(true);
    expect(pageRun).toHaveBeenCalledTimes(1);
  });

  it('keeps global bindings live while an overlay is open', () => {
    const app = makeApp();
    app.ui.openOverlay('queue');
    const before = app.settings.state.volume;

    expect(app.handleKeydown(key('+'))).toBe(true);
    expect(app.settings.state.volume).toBeGreaterThan(before);
  });
});
