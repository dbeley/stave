import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_TOAST_MS, ToastStore } from '$lib/stores/toast.svelte';

/** Capture scheduled expiries instead of waiting for them. */
function scheduler() {
  const callbacks: { fn: () => void; ms: number }[] = [];
  return {
    callbacks,
    schedule: (fn: () => void, ms: number) => {
      callbacks.push({ fn, ms });
      return callbacks.length;
    },
  };
}

describe('ToastStore', () => {
  it('starts empty', () => {
    const store = new ToastStore({ schedule: scheduler().schedule });
    expect(store.state.items).toEqual([]);
    expect(store.latest).toBeUndefined();
  });

  it('pushes and exposes the newest message', () => {
    const store = new ToastStore({ now: () => 1000, schedule: scheduler().schedule });
    store.info('first');
    store.ok('second');

    expect(store.state.items.map((toast) => toast.message)).toEqual(['first', 'second']);
    expect(store.latest?.message).toBe('second');
    expect(store.latest?.kind).toBe('ok');
    expect(store.latest?.at).toBe(1000);
  });

  it('gives each toast a unique id', () => {
    const store = new ToastStore({ schedule: scheduler().schedule });
    const a = store.info('a');
    const b = store.info('b');
    expect(a.id).not.toBe(b.id);
  });

  it('schedules dismissal after the default lifetime', () => {
    const s = scheduler();
    const store = new ToastStore({ schedule: s.schedule });
    store.info('fades');
    expect(s.callbacks[0]?.ms).toBe(DEFAULT_TOAST_MS);

    s.callbacks[0]!.fn();
    expect(store.state.items).toEqual([]);
  });

  it('lets errors linger longer than info messages', () => {
    const s = scheduler();
    const store = new ToastStore({ schedule: s.schedule });
    store.info('quick');
    store.error('important');

    const [infoDelay, errorDelay] = s.callbacks.map((entry) => entry.ms);
    expect(errorDelay).toBeGreaterThan(infoDelay!);
  });

  it('can push a toast that never expires', () => {
    const s = scheduler();
    const store = new ToastStore({ schedule: s.schedule });
    store.push('info', 'sticky', 0);
    expect(s.callbacks).toHaveLength(0);
    expect(store.state.items).toHaveLength(1);
  });

  it('dismisses a specific toast and ignores unknown ids', () => {
    const store = new ToastStore({ schedule: scheduler().schedule });
    const first = store.info('one');
    store.info('two');

    store.dismiss(first.id);
    store.dismiss(9999);

    expect(store.state.items.map((toast) => toast.message)).toEqual(['two']);
  });

  it('clear() removes everything', () => {
    const store = new ToastStore({ schedule: scheduler().schedule });
    store.info('a');
    store.warn('b');
    store.clear();
    expect(store.state.items).toEqual([]);
    expect(store.latest).toBeUndefined();
  });
});
