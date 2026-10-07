import { describe, it, expect, vi } from 'vitest';
import { KeyboardRouter, type Binding, type Scope } from '$lib/keyboard/registry.svelte';
import type { KeyEventLike } from '$lib/keyboard/keys';

interface BindingInput {
  keys: string[];
  scope?: Scope;
  group?: string;
  description?: string;
  hint?: boolean;
  pinned?: boolean;
  when?: () => boolean;
  run?: () => void;
}

function makeBinding(input: BindingInput): Binding {
  return {
    scope: 'global',
    group: 'navigation',
    description: 'test',
    run: () => {},
    ...input,
  };
}

function makeTimerSpy() {
  const callbacks: Array<() => void> = [];
  const setTimer = vi.fn((fn: () => void, _ms: number) => {
    callbacks.push(fn);
    return callbacks.length;
  });
  const clearTimer = vi.fn();
  return { callbacks, setTimer, clearTimer };
}

function makeRouter(scopes: Scope[] = ['global'], extra: Record<string, unknown> = {}) {
  const router = new KeyboardRouter({ activeScopes: () => scopes, ...extra });
  return router;
}

const key = (event: KeyEventLike): KeyEventLike => event;

describe('register / unregister', () => {
  it('runs an exact chord match and consumes the event', () => {
    const run = vi.fn();
    const router = makeRouter();
    router.register(makeBinding({ keys: ['j'], run }));

    expect(router.handle({ key: 'j' })).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('returns false when nothing matches', () => {
    const router = makeRouter();
    router.register(makeBinding({ keys: ['j'], run: vi.fn() }));
    expect(router.handle({ key: 'q' })).toBe(false);
  });

  it('unregister() removes a binding so its chord no longer matches', () => {
    const run = vi.fn();
    const router = makeRouter();
    const off = router.register(makeBinding({ keys: ['j'], run }));
    expect(router.handle({ key: 'j' })).toBe(true);

    off();
    expect(router.handle({ key: 'j' })).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('registerAll() returns a cleanup that removes every added binding', () => {
    const runA = vi.fn();
    const runB = vi.fn();
    const router = makeRouter();
    const off = router.registerAll([
      makeBinding({ keys: ['j'], run: runA }),
      makeBinding({ keys: ['k'], run: runB }),
    ]);
    expect(router.handle({ key: 'j' })).toBe(true);
    expect(router.handle({ key: 'k' })).toBe(true);

    off();
    expect(router.handle({ key: 'j' })).toBe(false);
    expect(router.handle({ key: 'k' })).toBe(false);
  });

  it('normalises binding keys so written specs match real events', () => {
    const run = vi.fn();
    const router = makeRouter();
    router.register(makeBinding({ keys: ['DOWN'], run }));
    expect(router.handle({ key: 'ArrowDown' })).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('ignores a binding whose when() is false', () => {
    const run = vi.fn();
    const router = makeRouter();
    router.register(makeBinding({ keys: ['j'], when: () => false, run }));
    expect(router.handle({ key: 'j' })).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('scope precedence', () => {
  it('the highest-priority scope wins and only it runs', () => {
    const pageRun = vi.fn();
    const globalRun = vi.fn();
    const router = makeRouter(['page', 'global']);
    router.register(makeBinding({ keys: ['j'], scope: 'page', run: pageRun }));
    router.register(makeBinding({ keys: ['j'], scope: 'global', run: globalRun }));

    expect(router.handle({ key: 'j' })).toBe(true);
    expect(pageRun).toHaveBeenCalledTimes(1);
    expect(globalRun).not.toHaveBeenCalled();
  });

  it('falls through to a lower scope when the higher one has no match there', () => {
    const globalRun = vi.fn();
    const router = makeRouter(['page', 'global']);
    router.register(makeBinding({ keys: ['j'], scope: 'global', run: globalRun }));
    expect(router.handle({ key: 'j' })).toBe(true);
    expect(globalRun).toHaveBeenCalledTimes(1);
  });

  it('skips a whole scope whose only bindings are disabled by when()', () => {
    const pageRun = vi.fn();
    const router = makeRouter(['page', 'global']);
    router.register(makeBinding({ keys: ['j'], scope: 'page', when: () => false, run: vi.fn() }));
    router.register(makeBinding({ keys: ['j'], scope: 'global', run: pageRun }));
    expect(router.handle({ key: 'j' })).toBe(true);
    expect(pageRun).toHaveBeenCalledTimes(1);
  });
});

describe('multi-key sequences', () => {
  it('a prefix key is consumed, sets pendingSequence and runs nothing yet', () => {
    const run = vi.fn();
    const onPendingChange = vi.fn();
    const timers = makeTimerSpy();
    const router = makeRouter(['global'], {
      onPendingChange,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    router.register(makeBinding({ keys: ['g g'], run }));

    expect(router.handle({ key: 'g' })).toBe(true);
    expect(router.pendingSequence).toBe('g');
    expect(run).not.toHaveBeenCalled();
    expect(onPendingChange).toHaveBeenLastCalledWith('g');
  });

  it('the follow-up key completes the sequence and runs it', () => {
    const run = vi.fn();
    const onPendingChange = vi.fn();
    const timers = makeTimerSpy();
    const router = makeRouter(['global'], {
      onPendingChange,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    router.register(makeBinding({ keys: ['g g'], run }));

    router.handle({ key: 'g' });
    expect(router.handle({ key: 'g' })).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(router.pendingSequence).toBe('');
    expect(onPendingChange).toHaveBeenLastCalledWith(null);
  });

  it('a pending sequence whose next key matches nothing is re-evaluated on its own', () => {
    const runX = vi.fn();
    const runGg = vi.fn();
    const timers = makeTimerSpy();
    const router = makeRouter(['global'], {
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    router.register(makeBinding({ keys: ['g g'], run: runGg }));
    router.register(makeBinding({ keys: ['x'], run: runX }));

    expect(router.handle({ key: 'g' })).toBe(true);
    expect(router.pendingSequence).toBe('g');

    expect(router.handle({ key: 'x' })).toBe(true);
    expect(runX).toHaveBeenCalledTimes(1);
    expect(runGg).not.toHaveBeenCalled();
    expect(router.pendingSequence).toBe('');
  });

  it('the injected timeout callback clears a pending sequence', () => {
    const onPendingChange = vi.fn();
    const timers = makeTimerSpy();
    const router = makeRouter(['global'], {
      onPendingChange,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    router.register(makeBinding({ keys: ['g g'], run: vi.fn() }));

    router.handle({ key: 'g' });
    expect(timers.callbacks).toHaveLength(1);
    expect(onPendingChange).toHaveBeenLastCalledWith('g');

    timers.callbacks[0]!();
    expect(router.pendingSequence).toBe('');
    expect(onPendingChange).toHaveBeenLastCalledWith(null);
  });

  it('clearPending() is a no-op and silent when nothing is pending', () => {
    const onPendingChange = vi.fn();
    const router = makeRouter(['global'], { onPendingChange });
    router.clearPending();
    expect(onPendingChange).not.toHaveBeenCalled();
    expect(router.pendingSequence).toBe('');
  });

  it('does not report a null pending when a sequence never started', () => {
    const onPendingChange = vi.fn();
    const timers = makeTimerSpy();
    const router = makeRouter(['global'], {
      onPendingChange,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    router.register(makeBinding({ keys: ['j'], run: vi.fn() }));
    router.handle({ key: 'j' });
    expect(onPendingChange).not.toHaveBeenCalled();
  });
});

describe('editable fields', () => {
  it('blocks normal chords while typing but still allows escape', () => {
    const runJ = vi.fn();
    const runEscape = vi.fn();
    const router = makeRouter(['global']);
    router.register(makeBinding({ keys: ['j'], run: runJ }));
    router.register(makeBinding({ keys: ['escape'], run: runEscape }));

    expect(router.handle({ key: 'j' }, { editable: true })).toBe(false);
    expect(runJ).not.toHaveBeenCalled();

    expect(router.handle({ key: 'Escape' }, { editable: true })).toBe(true);
    expect(runEscape).toHaveBeenCalledTimes(1);
  });

  it('allowWhileEditable lets chords through', () => {
    const runJ = vi.fn();
    const router = makeRouter(['global']);
    router.register(makeBinding({ keys: ['j'], run: runJ }));

    expect(router.handle({ key: 'j' }, { editable: true, allowWhileEditable: true })).toBe(true);
    expect(runJ).toHaveBeenCalledTimes(1);
  });
});

describe('grouped()', () => {
  it('groups visible bindings by their group label and skips disabled ones', () => {
    const router = makeRouter();
    const a = makeBinding({ keys: ['j'], group: 'navigation', run: vi.fn() });
    const b = makeBinding({ keys: ['k'], group: 'navigation', run: vi.fn() });
    const c = makeBinding({ keys: ['s'], group: 'playback', run: vi.fn() });
    const hidden = makeBinding({
      keys: ['x'],
      group: 'navigation',
      when: () => false,
      run: vi.fn(),
    });
    router.registerAll([a, b, c, hidden]);

    const grouped = router.grouped();
    expect(grouped.map((entry) => entry.group)).toEqual(['navigation', 'playback']);
    expect(grouped[0]!.bindings).toHaveLength(2);
    expect(grouped[1]!.bindings).toHaveLength(1);
    expect(grouped.flatMap((entry) => entry.bindings)).not.toContain(hidden);
  });
});

describe('hints()', () => {
  it('returns only hint bindings whose scope is active and whose when() passes', () => {
    const scopes: Scope[] = ['page', 'global'];
    const router = makeRouter(scopes);
    const hintedPage = makeBinding({
      keys: ['j'],
      scope: 'page',
      hint: true,
      run: vi.fn(),
    });
    const notHinted = makeBinding({ keys: ['k'], scope: 'page', hint: false, run: vi.fn() });
    const hintedGlobal = makeBinding({ keys: ['?'], scope: 'global', hint: true, run: vi.fn() });
    const overlayHint = makeBinding({ keys: ['q'], scope: 'overlay', hint: true, run: vi.fn() });
    const disabled = makeBinding({
      keys: ['z'],
      scope: 'page',
      hint: true,
      when: () => false,
      run: vi.fn(),
    });
    router.registerAll([hintedPage, notHinted, hintedGlobal, overlayHint, disabled]);

    const hints = router.hints();
    expect(hints).toContain(hintedPage);
    expect(hints).toContain(hintedGlobal);
    expect(hints).not.toContain(notHinted);
    expect(hints).not.toContain(overlayHint);
    expect(hints).not.toContain(disabled);
  });

  it('tracks the active scopes dynamically', () => {
    const scopes: Scope[] = ['global'];
    const router = makeRouter(scopes);
    const overlayHint = makeBinding({ keys: ['q'], scope: 'overlay', hint: true, run: vi.fn() });
    router.register(overlayHint);
    expect(router.hints()).toHaveLength(0);
    scopes.unshift('overlay');
    expect(router.hints()).toContain(overlayHint);
  });

  it('orders hints by scope priority, not registration order', () => {
    // The hint bar truncates to a dozen; globals are registered first, so a
    // registration-order list would push an open overlay's own hints off the end.
    const router = makeRouter(['overlay', 'queue', 'global']);
    const globalHint = makeBinding({ keys: ['g'], scope: 'global', hint: true, run: vi.fn() });
    const queueHint = makeBinding({ keys: ['x'], scope: 'queue', hint: true, run: vi.fn() });
    const overlayHint = makeBinding({ keys: ['j'], scope: 'overlay', hint: true, run: vi.fn() });
    router.registerAll([globalHint, overlayHint, queueHint]);

    expect(router.hints().map((binding) => binding.scope)).toEqual(['overlay', 'queue', 'global']);
  });

  it('offers a chord once, to the binding that would actually run it', () => {
    // The settings page binds `space` to "activate" and the global layer binds
    // it to "play / pause". The page wins when routing keys, so the global one
    // is dead: offering both (as the bar did) documents a key that cannot fire.
    const router = makeRouter(['page', 'global']);
    const pageSpace = makeBinding({
      keys: ['space'],
      scope: 'page',
      description: 'activate',
      hint: true,
      run: vi.fn(),
    });
    const globalSpace = makeBinding({
      keys: ['space'],
      scope: 'global',
      description: 'play / pause',
      hint: true,
      run: vi.fn(),
    });
    const globalNext = makeBinding({ keys: ['n'], hint: true, run: vi.fn() });
    router.registerAll([globalSpace, globalNext, pageSpace]);

    expect(router.hints()).toEqual([pageSpace, globalNext]);
  });

  it('claims a binding whole, so its aliases are not offered again', () => {
    // The page answers to `=` as well as `+`, so the global binding that
    // displays `=` is dead — even though it is a different chord on screen.
    const router = makeRouter(['page', 'global']);
    const pageVolume = makeBinding({
      keys: ['+', '='],
      scope: 'page',
      description: 'louder',
      hint: true,
      run: vi.fn(),
    });
    const globalEquals = makeBinding({ keys: ['='], hint: true, run: vi.fn() });
    router.registerAll([globalEquals, pageVolume]);

    expect(router.hints()).toEqual([pageVolume]);
  });

  it('passes a pinned hint through untouched', () => {
    const router = makeRouter(['page', 'global']);
    const pinned = makeBinding({
      keys: ['?'],
      description: 'keyboard help',
      hint: true,
      pinned: true,
      run: vi.fn(),
    });
    router.register(pinned);

    expect(router.hints()).toEqual([pinned]);
    expect(router.hints()[0]?.pinned).toBe(true);
  });
});

describe('handle() return contract', () => {
  it('returns true exactly when it consumes a key', () => {
    const router = makeRouter(['global']);
    router.register(makeBinding({ keys: ['j'], run: vi.fn() }));
    expect(router.handle({ key: 'j' })).toBe(true);
    expect(router.handle({ key: 'q' })).toBe(false);
    expect(router.handle(key({ key: 'Escape' }))).toBe(false);
  });
});

describe('rune support', () => {
  // Regression guard: the registry and the list helpers must live in
  // `.svelte.ts` modules for their `$state` to be compiled. A plain `.ts` module
  // throws `rune_outside_svelte` (and a ReferenceError in a production build),
  // which is why the test suite used to install a global `$state` shim.
  it('constructs a router without any global rune shim', () => {
    // Constructing (and using) a router only works if `$state` was compiled
    // into the module — a plain `.ts` file would throw `rune_outside_svelte`.
    expect(() => new KeyboardRouter({ activeScopes: () => ['global'] })).not.toThrow();
    const router = new KeyboardRouter({ activeScopes: () => ['global'] });
    const run = vi.fn();
    router.register(makeBinding({ keys: ['j'], run }));
    expect(router.handle({ key: 'j' })).toBe(true);
    expect(run).toHaveBeenCalledOnce();
  });
});
