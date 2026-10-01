import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet, tick } from 'svelte';

/**
 * `Overlay` is the shared modal frame. It reads the UI store only to close
 * itself; everything else is props. Tests assert the dialog contract and the
 * backdrop behaviour, not the markup.
 */
const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

import Overlay from '$lib/components/Overlay.svelte';

function installUi() {
  const ui = { closeOverlay: vi.fn() };
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, { ui });
  return ui;
}

const children = createRawSnippet(() => ({ render: () => '<p>overlay body</p>' }));
const footer = createRawSnippet(() => ({ render: () => '<p>overlay footer</p>' }));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Overlay', () => {
  it('renders an accessible modal dialog with its title and note', async () => {
    installUi();
    render(Overlay, {
      props: { title: 'keyboard', note: '42 bindings', children: children as never },
    });
    await tick();

    const dialog = screen.getByRole('dialog', { name: 'keyboard' });
    expect(dialog).toBeTruthy();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('══ keyboard ══')).toBeTruthy();
    expect(screen.getByText('42 bindings')).toBeTruthy();
    expect(screen.getByText('overlay body')).toBeTruthy();
  });

  it('renders a footer snippet when one is supplied', async () => {
    installUi();
    render(Overlay, {
      props: { title: 'queue', children: children as never, footer: footer as never },
    });
    await tick();

    expect(screen.getByText('overlay footer')).toBeTruthy();
  });

  it('closes when the backdrop itself is clicked', async () => {
    const ui = installUi();
    render(Overlay, { props: { title: 'help', children: children as never } });
    await tick();

    const dialog = screen.getByRole('dialog', { name: 'help' });
    dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ui.closeOverlay).not.toHaveBeenCalled();

    const backdrop = dialog.parentElement as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ui.closeOverlay).toHaveBeenCalledTimes(1);
  });

  it('ignores backdrop clicks when closeOnBackdrop is false', async () => {
    const ui = installUi();
    render(Overlay, {
      props: { title: 'login', closeOnBackdrop: false, children: children as never },
    });
    await tick();

    const dialog = screen.getByRole('dialog', { name: 'login' });
    const backdrop = dialog.parentElement as HTMLElement;
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(ui.closeOverlay).not.toHaveBeenCalled();
  });
});
