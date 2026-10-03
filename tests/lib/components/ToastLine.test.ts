import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

import ToastLine from '$lib/components/ToastLine.svelte';

function install(latest: { kind: string; message: string } | undefined): void {
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, { toasts: { latest } });
}

async function mount(props: Record<string, any> = {}): Promise<void> {
  render(ToastLine, { props });
  await tick();
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ToastLine', () => {
  it('renders nothing without a toast', async () => {
    install(undefined);
    await mount();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders an inline message with the kind mapped to a class', async () => {
    install({ kind: 'info', message: 'hello' });
    await mount();

    const status = screen.getByRole('status');
    expect(status.textContent).toBe('hello');
    expect(status.classList.contains('toast')).toBe(true);
    expect(status.classList.contains('dim')).toBe(true);
  });

  it('maps error to danger', async () => {
    install({ kind: 'error', message: 'boom' });
    await mount();
    expect(screen.getByRole('status').classList.contains('danger')).toBe(true);
  });

  it('maps warn to warn', async () => {
    install({ kind: 'warn', message: 'careful' });
    await mount();
    expect(screen.getByRole('status').classList.contains('warn')).toBe(true);
  });

  it('maps ok to ok', async () => {
    install({ kind: 'ok', message: 'saved' });
    await mount();
    expect(screen.getByRole('status').classList.contains('ok')).toBe(true);
  });

  it('renders a standalone strip for the touch shell', async () => {
    install({ kind: 'ok', message: 'connected' });
    await mount({ strip: true });

    const strip = screen.getByRole('status');
    expect(strip.classList.contains('strip')).toBe(true);
    expect(strip.querySelector('.toast')?.textContent).toBe('connected');
    expect(strip.querySelector('.toast')?.classList.contains('ok')).toBe(true);
  });
});
