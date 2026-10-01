/**
 * The "go to" palette is the only navigation surface available on a touch device,
 * so these tests drive it the way both kinds of user do: by tapping a row and by
 * key.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import { KeyboardRouter } from '$lib/keyboard/registry.svelte';

const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

import CommandPalette from '$lib/components/CommandPalette.svelte';

function buildFakes() {
  const keyboard = new KeyboardRouter({ activeScopes: () => ['overlay', 'page', 'global'] });
  const ui = {
    state: { overlay: 'palette' as string | null },
    openOverlay: vi.fn((kind: string) => {
      ui.state.overlay = kind;
    }),
    closeOverlay: vi.fn(() => {
      ui.state.overlay = null;
    }),
  };
  const router = { navigate: vi.fn() };
  const search = { state: { query: '' } };
  const focusSearch = vi.fn();
  const app = { keyboard, ui, router, search, focusSearch };
  return { app, keyboard, ui, router, search, focusSearch };
}

type Fakes = ReturnType<typeof buildFakes>;

function install(fakes: Fakes): Fakes {
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, fakes.app);
  return fakes;
}

async function mount(): Promise<Fakes> {
  const fakes = install(buildFakes());
  render(CommandPalette);
  await tick();
  return fakes;
}

function bindingFor(fakes: Fakes, key: string) {
  const found = fakes.keyboard.bindings.find((binding) => binding.keys.includes(key));
  if (!found) throw new Error(`no binding for ${key}`);
  return found;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CommandPalette', () => {
  it('lists every destination', async () => {
    await mount();

    expect(screen.getByRole('dialog', { name: 'go to' })).toBeTruthy();
    for (const label of [
      'home',
      'albums',
      'artists',
      'playlists',
      'favourites',
      'listen later',
      'search',
      'queue',
      'keyboard help',
      'settings',
    ]) {
      expect(screen.getByRole('button', { name: `go to ${label}` })).toBeTruthy();
    }
  });

  it('navigates and closes when a row is tapped', async () => {
    const fakes = await mount();

    await fireEvent.click(screen.getByRole('button', { name: 'go to artists' }));

    expect(fakes.router.navigate).toHaveBeenCalledWith({ name: 'artists' });
    expect(fakes.ui.closeOverlay).toHaveBeenCalled();
    expect(fakes.ui.state.overlay).toBeNull();
  });

  it('opens the search field when the search row is tapped', async () => {
    const fakes = await mount();

    await fireEvent.click(screen.getByRole('button', { name: 'go to search' }));

    expect(fakes.router.navigate).toHaveBeenCalledWith({ name: 'search', query: '' });
    expect(fakes.focusSearch).toHaveBeenCalled();
  });

  it('moves the highlight with j and activates the highlighted row with enter', async () => {
    const fakes = await mount();

    // Without a cursor count this row would stay at index 0 and enter would open
    // home no matter how far the user navigated.
    fakes.keyboard.handle({ key: 'j' });
    bindingFor(fakes, 'enter').run();

    expect(fakes.router.navigate).toHaveBeenCalledWith({ name: 'albums', sort: 'newest' });
  });

  it('jumps straight to a destination from its mnemonic key', async () => {
    const fakes = await mount();

    bindingFor(fakes, 'r').run();
    expect(fakes.router.navigate).toHaveBeenCalledWith({ name: 'artists' });

    bindingFor(fakes, 's').run();
    expect(fakes.router.navigate).toHaveBeenCalledWith({ name: 'settings' });
  });

  it('re-opens another overlay from its row', async () => {
    const fakes = await mount();

    await fireEvent.click(screen.getByRole('button', { name: 'go to keyboard help' }));

    expect(fakes.ui.openOverlay).toHaveBeenCalledWith('help');
    expect(fakes.ui.state.overlay).toBe('help');
  });

  it('registers its bindings only while it is mounted', async () => {
    const baseline = 0;
    const fakes = await mount();
    expect(fakes.keyboard.bindings.length).toBeGreaterThan(baseline);

    const view = render(CommandPalette);
    await tick();
    // A second mount adds its own set; unmounting removes exactly that set.
    const afterSecond = fakes.keyboard.bindings.length;
    view.unmount();
    await tick();
    expect(fakes.keyboard.bindings.length).toBeLessThan(afterSecond);
  });
});
