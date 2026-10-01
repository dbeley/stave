import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

import StatusBar from '$lib/components/StatusBar.svelte';

interface Overrides {
  status?: string;
  serverVersion?: string;
  error?: string;
  autoDj?: boolean;
  offlineCacheEnabled?: boolean;
  cachedCount?: number;
  downloading?: number;
  queueLength?: number;
  pending?: string | null;
  route?: Record<string, unknown>;
}

function install(overrides: Overrides = {}) {
  const app = {
    connection: {
      status: overrides.status ?? 'connected',
      serverVersion: overrides.serverVersion ?? '1.16.1',
      error: overrides.error,
      openSubsonic: false,
    },
    keyboard: { pendingSequence: overrides.pending ?? null },
    settings: {
      state: {
        autoDj: overrides.autoDj ?? false,
        offlineCacheEnabled: overrides.offlineCacheEnabled ?? false,
      },
    },
    resolver: { cachedCount: overrides.cachedCount ?? 0 },
    downloads: {
      entries: Array.from({ length: overrides.downloading ?? 0 }, () => ({
        status: 'downloading',
      })),
    },
    queue: { length: overrides.queueLength ?? 0 },
    router: { current: overrides.route ?? { name: 'albums', sort: 'newest' } },
    ui: { openOverlay: vi.fn() },
  };
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, app);
  return app;
}

async function mount(overrides: Overrides = {}) {
  const app = install(overrides);
  render(StatusBar);
  await tick();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('StatusBar', () => {
  it('renders the brand, version and current route title', async () => {
    await mount();

    expect(screen.getByText('stave')).toBeTruthy();
    expect(screen.getByText('v0.1.0')).toBeTruthy();
    expect(screen.getByText('albums (newest)')).toBeTruthy();
  });

  it('shows a filled dot and the server version when connected', async () => {
    await mount({ status: 'connected', serverVersion: '1.16.1' });

    const status = screen.getByText(/1\.16\.1/);
    expect(status.textContent).toContain('●');
  });

  it('shows a hollow dot while connecting', async () => {
    await mount({ status: 'connecting' });

    expect(screen.getByText(/connecting/).textContent).toContain('○');
  });

  it('shows a cross and "offline" on error', async () => {
    await mount({ status: 'error', error: 'timeout' });

    const status = screen.getByText(/offline/);
    expect(status.textContent).toContain('✕');
  });

  it('says "not connected" when there is no server', async () => {
    await mount({ status: 'disconnected' });

    expect(screen.getByText(/not connected/)).toBeTruthy();
  });

  it('badges auto-dj when it is on', async () => {
    await mount({ autoDj: true });

    expect(screen.getByTitle('auto-dj is on')).toBeTruthy();
  });

  it('badges the offline cache with counts while downloading', async () => {
    await mount({ offlineCacheEnabled: true, cachedCount: 5, downloading: 2 });

    const badge = screen.getByTitle('offline cache');
    expect(badge.textContent).toContain('⌂5');
    expect(badge.textContent).toContain('↓2');
  });

  it('omits the offline badge when caching is disabled', async () => {
    await mount({ offlineCacheEnabled: false });

    expect(screen.queryByTitle('offline cache')).toBeNull();
  });

  it('badges the queue length', async () => {
    await mount({ queueLength: 4 });

    expect(screen.getByTitle('queue length').textContent).toContain('≡4');
  });

  it('shows a pending key sequence', async () => {
    await mount({ pending: 'g' });

    expect(screen.getByTitle('waiting for the rest of the key sequence').textContent).toContain(
      '[g]',
    );
  });

  it('offers a tappable entry point for navigation, the only one on touch', async () => {
    const app = await mount();

    const chip = screen.getByRole('button', { name: 'open the go-to palette' });
    expect(chip.textContent).toContain('[:]');

    await fireEvent.click(chip);
    expect(app.ui.openOverlay).toHaveBeenCalledWith('palette');
  });
});

describe('StatusBar clock', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 2, 9, 8, 7));
  });

  it('renders the current time and ticks every second', async () => {
    install();
    render(StatusBar);
    await tick();

    expect(screen.getByText('09:08:07')).toBeTruthy();

    vi.advanceTimersByTime(1000);
    await tick();
    expect(screen.getByText('09:08:08')).toBeTruthy();
  });
});
