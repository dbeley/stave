import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { KeyboardRouter } from '$lib/keyboard/registry.svelte';

/**
 * The help overlay is generated from the live binding registry, so these tests
 * drive a real `KeyboardRouter`: register some bindings, render, and assert the
 * overlay documents exactly those entries.
 */
const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

import HelpOverlay from '$lib/components/HelpOverlay.svelte';

function install(keyboard: KeyboardRouter) {
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, { keyboard });
  return keyboard;
}

function makeKeyboard(): KeyboardRouter {
  const keyboard = new KeyboardRouter({ activeScopes: () => ['global'] });
  keyboard.register({
    keys: ['ctrl+alt+z'],
    scope: 'global',
    group: 'custom',
    description: 'do a custom thing',
    run: () => {},
  });
  return keyboard;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HelpOverlay', () => {
  it('documents the registered bindings, grouped by their group label', async () => {
    const keyboard = install(makeKeyboard());
    keyboard.register({
      keys: ['g g'],
      scope: 'global',
      group: 'custom',
      description: 'custom double g',
      run: () => {},
    });
    render(HelpOverlay);
    await tick();

    expect(screen.getByRole('dialog', { name: 'keyboard' })).toBeTruthy();
    expect(screen.getByText('── custom')).toBeTruthy();
    expect(screen.getByText('do a custom thing')).toBeTruthy();
    expect(screen.getByText('custom double g')).toBeTruthy();
  });

  it('renders each chord through formatChord and labels the scope', async () => {
    const keyboard = install(makeKeyboard());
    keyboard.register({
      keys: ['/'],
      scope: 'page',
      group: 'custom',
      description: 'search from a page',
      run: () => {},
    });
    render(HelpOverlay);
    await tick();

    // ctrl+alt+z -> ^alt+z ; slash is untouched.
    expect(screen.getByText('^alt+z')).toBeTruthy();
    // The menu's own overlay bindings also render a '/' separator, so allow >1.
    expect(screen.getAllByText('/').length).toBeGreaterThan(0);
    expect(screen.getAllByText('global').length).toBeGreaterThan(0);
    expect(screen.getAllByText('page').length).toBeGreaterThan(0);
  });

  it('hides bindings whose `when` guard is false', async () => {
    const keyboard = install(makeKeyboard());
    keyboard.register({
      keys: ['u'],
      scope: 'global',
      group: 'custom',
      description: 'invisible binding',
      when: () => false,
      run: () => {},
    });
    render(HelpOverlay);
    await tick();

    expect(screen.queryByText('invisible binding')).toBeNull();
    // The visible one is still there.
    expect(screen.getByText('do a custom thing')).toBeTruthy();
  });

  it('counts the rendered rows in the header note', async () => {
    install(makeKeyboard());
    render(HelpOverlay);
    await tick();

    const note = screen.getByText(/^\d+ bindings$/);
    expect(note.textContent).toMatch(/^\d+ bindings$/);
  });

  it('updates when a new binding is registered after mount', async () => {
    const keyboard = install(makeKeyboard());
    render(HelpOverlay);
    await tick();

    expect(screen.queryByText('late binding')).toBeNull();
    keyboard.register({
      keys: ['L'],
      scope: 'global',
      group: 'custom',
      description: 'late binding',
      run: () => {},
    });
    await tick();

    expect(screen.getByText('late binding')).toBeTruthy();
  });

  it('does not accumulate keybindings when re-mounted', async () => {
    const keyboard = install(makeKeyboard());
    const baseline = keyboard.bindings.length;

    const first = render(HelpOverlay);
    await tick();
    const registered = keyboard.bindings.length - baseline;
    expect(registered).toBeGreaterThan(0);

    first.unmount();
    expect(keyboard.bindings.length).toBe(baseline);

    render(HelpOverlay);
    await tick();
    expect(keyboard.bindings.length - baseline).toBe(registered);
  });
});
