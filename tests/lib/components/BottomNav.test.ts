import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';
import type { Route } from '$lib/stores/router.svelte';

const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

import BottomNav from '$lib/components/BottomNav.svelte';

interface InstallOverrides {
  route?: Route;
}

function install(overrides: InstallOverrides = {}) {
  const router = {
    current: overrides.route ?? ({ name: 'home' } as Route),
    navigate: vi.fn(),
  };
  const capability = { shell: 'touch' as 'touch' | 'terminal' };
  const ui = { state: { overlay: undefined }, openOverlay: vi.fn() };
  const search = { state: { query: '' } };
  const focusSearch = vi.fn();
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, { router, capability, ui, search, focusSearch });
  return { router, capability, ui, search, focusSearch };
}

async function mount(overrides: InstallOverrides = {}) {
  const fakes = install(overrides);
  render(BottomNav);
  await tick();
  return fakes;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BottomNav', () => {
  it('renders the four tabs', async () => {
    await mount();

    expect(screen.getByRole('navigation', { name: 'sections' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'go to home' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'go to albums' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'go to artists' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'go to now playing' })).toBeTruthy();
  });

  it('marks the current route active', async () => {
    await mount({ route: { name: 'album', id: 'x' } });

    expect(screen.getByRole('button', { name: 'go to albums' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(
      screen.getByRole('button', { name: 'go to home' }).getAttribute('aria-current'),
    ).toBeNull();
  });

  it('navigates on tap', async () => {
    const { router } = await mount();

    await fireEvent.click(screen.getByRole('button', { name: 'go to albums' }));

    expect(router.navigate).toHaveBeenCalledWith({ name: 'albums', sort: 'newest' });
  });

  it('activates the artists tab on an artist route', async () => {
    await mount({ route: { name: 'artist', id: 'x' } });

    expect(screen.getByRole('button', { name: 'go to artists' }).getAttribute('aria-current')).toBe(
      'page',
    );
  });
});
