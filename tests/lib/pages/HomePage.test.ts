import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Album } from '$lib/domain/types';

const mocks = vi.hoisted(() => {
  // `$lib/keyboard/list.svelte.ts` uses runes; emulate the compiler's globals the
  // same way the other page tests do.
  const identity = (value: unknown) => value;
  Object.defineProperty(globalThis, '$derived', {
    configurable: true,
    writable: true,
    value: identity,
  });
  Object.defineProperty(globalThis, '$effect', {
    configurable: true,
    writable: true,
    value: () => () => {},
  });
  return {
    app: {} as Record<string, any>,
    actions: {} as Record<string, any>,
  };
});

vi.mock('$lib/app.svelte', () => ({ app: mocks.app }));
vi.mock('$lib/ui/actionsRegistry.svelte', () => ({ actions: mocks.actions }));

import HomePage from '$lib/pages/HomePage.svelte';

function album(id: string, name: string): Album {
  return {
    id,
    name,
    artistId: 'ar1',
    artistName: 'Aurelia Vance',
    songCount: 4,
    durationSec: 900,
    starred: false,
  };
}

function slice(items: Album[], over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    items,
    loading: false,
    error: undefined,
    offset: items.length,
    hasMore: false,
    loadedAt: 1,
    ...over,
  };
}

function makeApp(random: unknown, recent: unknown): Record<string, any> {
  return {
    library: {
      list: vi.fn((sort: string) => (sort === 'random' ? random : recent)),
      loadAlbumList: vi.fn().mockResolvedValue(undefined),
    },
    favorites: { isAlbumStarred: () => false },
    listenLater: { has: () => false },
    downloads: { isCached: () => false },
    settings: { state: { offlineCacheEnabled: false, showTechnicalColumns: false } },
    keyboard: { registerAll: vi.fn(() => () => {}) },
    toasts: { info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
}

function install(app: Record<string, unknown>): void {
  for (const key of Object.keys(mocks.app)) delete mocks.app[key];
  Object.assign(mocks.app, app);
}

/** Every binding the page has ever registered. */
function allBindings(): any[] {
  return mocks.app.keyboard.registerAll.mock.calls.flatMap((call: any[]) => call[0]);
}

/** The bindings from the most recent registerAll call (the active set). */
function currentBindings(): any[] {
  const calls = mocks.app.keyboard.registerAll.mock.calls;
  return (calls[calls.length - 1]?.[0] ?? []) as any[];
}

function binding(key: string, list: any[]): any {
  return list.find((b) => b.keys.includes(key));
}

beforeEach(() => {
  for (const key of Object.keys(mocks.actions)) delete mocks.actions[key];
  Object.assign(mocks.actions, { openAlbum: vi.fn() });
});

describe('HomePage', () => {
  it('loads and renders both panes', async () => {
    install(
      makeApp(
        slice([album('r1', 'Random One'), album('r2', 'Random Two')]),
        slice([album('n1', 'Recent One')]),
      ),
    );

    render(HomePage);
    await tick();

    expect(screen.getByText(/random/)).toBeTruthy();
    expect(screen.getByText(/recently added/)).toBeTruthy();
    expect(screen.getByText('Random One')).toBeTruthy();
    expect(screen.getByText('Random Two')).toBeTruthy();
    expect(screen.getByText('Recent One')).toBeTruthy();
    expect(mocks.app.library.loadAlbumList).toHaveBeenCalledWith('random');
    expect(mocks.app.library.loadAlbumList).toHaveBeenCalledWith('newest');
  });

  it('shows a per-pane error and empty state', async () => {
    install(makeApp(slice([], { error: 'kaboom' }), slice([])));

    render(HomePage);
    await tick();

    expect(screen.getByText(/could not load random albums/i)).toBeTruthy();
    expect(screen.getByText(/kaboom/)).toBeTruthy();
    expect(screen.getByText(/no albums yet/i)).toBeTruthy();
  });

  it('routes j/enter to the focused pane and switches pane with Tab', async () => {
    install(
      makeApp(
        slice([album('r1', 'Random One'), album('r2', 'Random Two')]),
        slice([album('n1', 'Recent One'), album('n2', 'Recent Two')]),
      ),
    );

    render(HomePage);
    await tick();

    const tab = binding('tab', allBindings());
    expect(tab).toBeTruthy();

    // Focus 0: the list bindings drive the random pane.
    binding('j', currentBindings()).run();
    binding('enter', currentBindings()).run();
    expect(mocks.actions.openAlbum).toHaveBeenLastCalledWith('r2');

    // Tab flips focus to the recently-added pane...
    tab.run();
    await tick();

    // ...and the freshly registered bindings follow it: j now moves the recent
    // cursor (a regression guard — registering once in onMount pinned the cursor).
    binding('j', currentBindings()).run();
    binding('enter', currentBindings()).run();
    expect(mocks.actions.openAlbum).toHaveBeenLastCalledWith('n2');
  });

  it('re-registers the list bindings when the focused pane changes', async () => {
    install(makeApp(slice([album('r1', 'Random One')]), slice([album('n1', 'Recent One')])));

    render(HomePage);
    await tick();

    const before = mocks.app.keyboard.registerAll.mock.calls.length;
    binding('tab', allBindings()).run();
    await tick();

    expect(mocks.app.keyboard.registerAll.mock.calls.length).toBeGreaterThan(before);
    binding('enter', currentBindings()).run();
    expect(mocks.actions.openAlbum).toHaveBeenLastCalledWith('n1');
  });
});
