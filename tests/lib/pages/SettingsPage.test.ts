import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

/**
 * `$lib/keyboard/list.svelte` runs runes outside a compiled Svelte module (it throws in
 * jsdom), so it is replaced with a plain cursor and no-op navigation bindings.
 * The settings store is faked so value changes can be asserted on the calls.
 */
const h = vi.hoisted(() => {
  const settings = {
    state: {
      theme: 'dark',
      accent: 'orange',
      crtEffects: false,
      asciiCoverArt: true,
      keyHints: true,
      showTechnicalColumns: false,
      autoDj: true,
      autoDjThreshold: 3,
      autoDjBatchSize: 10,
      offlineCacheEnabled: false,
      scrobblingEnabled: true,
      streamMaxBitRate: 0,
      volume: 0.8,
      pageSize: 50,
    },
    update: vi.fn(),
    toggle: vi.fn(),
    cycleTheme: vi.fn(),
    cycleAccent: vi.fn(),
  };

  const app = {
    settings,
    isConnected: true,
    disconnect: vi.fn(),
    clearOfflineCache: vi.fn(),
    setOfflineCacheEnabled: vi.fn(),
    ui: { openOverlay: vi.fn(), state: { overlay: null } },
    connection: {
      status: 'connected',
      error: undefined as string | undefined,
      serverVersion: '0.54.0' as string | undefined,
      openSubsonic: true,
    },
    credentials: { state: { server: 'http://music.example', username: 'dave', password: '' } },
    resolver: { cachedCount: 4 },
    toasts: { info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn() },
    keyboard: { registerAll: vi.fn(() => () => {}) },
  };

  return { settings, app };
});

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

// A partial mock: everything except the cursor stays real, so adding an export to
// the module does not silently break these tests (it did when
// `keepCursorRowVisible` arrived — the mock simply did not have it).
vi.mock('$lib/keyboard/list.svelte', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/keyboard/list.svelte')>();

  class ListCursor {
    state = { index: 0, count: 0 };
    get index() {
      return this.state.index;
    }
    get count() {
      return this.state.count;
    }
    get isEmpty() {
      return this.state.count === 0;
    }
    setCount(count: number) {
      this.state.count = Math.max(0, count);
      this.clamp();
    }
    set(index: number) {
      this.state.index = index;
    }
    move(delta: number) {
      const max = Math.max(0, this.state.count - 1);
      this.state.index = Math.min(Math.max(this.state.index + delta, 0), max);
      return this.state.index;
    }
    first() {
      this.state.index = 0;
    }
    last() {
      this.state.index = Math.max(0, this.state.count - 1);
    }
    page(direction: number) {
      return this.move(direction * 10);
    }
    selected<T>(items: readonly T[]): T | undefined {
      return items[this.state.index];
    }
    isSelected(index: number) {
      return this.state.index === index;
    }
    clamp() {
      const max = Math.max(Math.max(this.state.count, 1) - 1, 0);
      this.state.index = Math.min(Math.max(this.state.index, 0), max);
    }
    reset() {
      this.state.index = 0;
    }
  }
  return {
    ...actual,
    ListCursor,
    listNavigationBindings: () => [],
    // Nothing to scroll in jsdom; the pages only need it not to throw.
    keepCursorRowVisible: () => {},
  };
});

import SettingsPage from '$lib/pages/SettingsPage.svelte';

beforeEach(() => {
  h.app.isConnected = true;
  h.app.credentials.state.server = 'http://music.example';
  h.app.credentials.state.password = '';
  h.settings.state.theme = 'dark';
  h.settings.state.offlineCacheEnabled = false;
});

describe('SettingsPage', () => {
  it('renders the current value of each setting', async () => {
    render(SettingsPage);
    await tick();

    expect(screen.getByText('theme')).toBeTruthy();
    expect(screen.getByText('dark')).toBeTruthy();
    expect(screen.getByText('original')).toBeTruthy();
    expect(screen.getByText('50')).toBeTruthy();
  });

  it('cycles the theme when the theme row is activated', async () => {
    render(SettingsPage);
    await tick();

    const row = screen.getByText('theme').closest('[role="option"]');
    expect(row).toBeTruthy();
    await fireEvent.click(row as HTMLElement);

    expect(h.app.settings.cycleTheme).toHaveBeenCalledWith(1);
  });

  it('turns the offline cache on through app.setOfflineCacheEnabled', async () => {
    render(SettingsPage);
    await tick();

    const row = screen.getByText('offline cache').closest('[role="option"]');
    await fireEvent.click(row as HTMLElement);

    expect(h.app.setOfflineCacheEnabled).toHaveBeenCalledWith(true);
    expect(h.app.settings.toggle).not.toHaveBeenCalledWith('offlineCacheEnabled');
  });

  it('shows version, server and platform, and offers sign out when connected', async () => {
    render(SettingsPage);
    await tick();

    expect(screen.getByText('0.1.0')).toBeTruthy();
    expect(screen.getByText('http://music.example')).toBeTruthy();
    expect(screen.getByText(/connected/)).toBeTruthy();
    expect(screen.getByText(/0\.54\.0/)).toBeTruthy();
    expect(screen.getByText('web')).toBeTruthy();
    expect(screen.getByText('sign out')).toBeTruthy();
  });

  it('hides sign out when disconnected and never renders the password', async () => {
    h.app.isConnected = false;
    h.app.credentials.state.password = 'hunter2';

    render(SettingsPage);
    await tick();

    expect(screen.queryByText('sign out')).toBeNull();
    expect(screen.queryByText('hunter2')).toBeNull();
  });
});
