/**
 * Regression guard for a real performance bug.
 *
 * Registering keyboard bindings from inside an `$effect` used to re-trigger that
 * same effect, forever: `registerAll` reads `bindings` in order to append to it
 * and then writes it, so an effect that registered bindings depended on its own
 * output and re-ran until Svelte's update-depth guard tripped.
 *
 * Measured on the home page before the fix: 12 keystrokes caused ~8,000
 * registrations and ~112,000 unregistrations (the home page re-registers its list
 * bindings when Tab switches panes, so its registration lives in an effect while
 * every other page does it in onMount). The cost showed up as ~20ms of latency
 * per keystroke, 26ms of garbage collection in a 12-key burst, and a cold page
 * render roughly 1.7x slower. Reading that state untracked removed the loop: the
 * effect now runs exactly once per dependency change.
 *
 * The counterpart (that Tab still re-registers) is covered end-to-end by
 * `e2e/smoke.spec.ts > tab moves the focused pane, and j/k follow it`.
 */
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { KeyboardRouter } from '$lib/keyboard/registry.svelte';
import RegisterInEffect from './fixtures/RegisterInEffect.svelte';

describe('KeyboardRouter: registering from an effect', () => {
  it('does not re-trigger the effect that did the registering', async () => {
    const keyboard = new KeyboardRouter({ activeScopes: () => ['page', 'global'] });
    let runs = 0;

    render(RegisterInEffect, {
      props: {
        keyboard,
        onRun: () => {
          runs += 1;
        },
      },
    });
    await tick();
    await tick();

    expect(runs).toBe(1);
    expect(keyboard.bindings).toHaveLength(1);
  });

  it('registers the bindings so they are usable', async () => {
    const keyboard = new KeyboardRouter({ activeScopes: () => ['page', 'global'] });

    const { unmount } = render(RegisterInEffect, {
      props: { keyboard, onRun: () => {} },
    });
    await tick();

    keyboard.handle({ key: 'j' });
    const handled = keyboard.bindings.filter((binding) => binding.keys.includes('j')).length;
    expect(handled).toBe(1);

    // Unmounting releases them again.
    unmount();
    await tick();
    expect(keyboard.bindings).toHaveLength(0);
  });
});
