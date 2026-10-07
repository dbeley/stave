import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';

const h = vi.hoisted(() => ({
  app: {} as Record<string, any>,
}));

vi.mock('$lib/app.svelte', () => ({ app: h.app, App: class {} }));

import HintBar from '$lib/components/HintBar.svelte';

const binding = (keys: string[], description: string, extra: Record<string, unknown> = {}) => ({
  keys,
  scope: 'global',
  group: 'navigation',
  description,
  run: () => {},
  ...extra,
});

type Binding = ReturnType<typeof binding>;

interface Overrides {
  hints?: Binding[];
  continuations?: Binding[];
  pending?: string;
  keyHints?: boolean;
  toast?: { kind: string; message: string } | undefined;
}

function install(overrides: Overrides = {}) {
  const app = {
    keyboard: {
      pendingSequence: overrides.pending ?? '',
      hints: () => overrides.hints ?? [],
      continuations: () => overrides.continuations ?? [],
    },
    settings: { state: { keyHints: overrides.keyHints ?? true } },
    toasts: { latest: overrides.toast },
  };
  for (const key of Object.keys(h.app)) delete h.app[key];
  Object.assign(h.app, app);
  return app;
}

async function mount(overrides: Overrides = {}) {
  const app = install(overrides);
  render(HintBar);
  await tick();
  return app;
}

/** The hints actually on screen — the hidden measuring copy is not a `.hint`. */
const visibleHints = (): string[] =>
  [...document.querySelectorAll('footer .hint')].map((node) =>
    (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
  );

beforeEach(() => {
  vi.clearAllMocks();
});

describe('HintBar', () => {
  it('renders each registry hint once, and invents none of its own', async () => {
    // BUG: the bar appended a hard-coded `[?] help` beside the registry's
    // `[?] keyboard help`, so one key was documented twice in the same row.
    await mount({
      hints: [
        binding(['j'], 'move down'),
        binding(['?'], 'keyboard help', { pinned: true }),
        binding(['n'], 'next track'),
      ],
    });

    expect(visibleHints()).toEqual(['[j] move down', '[?] keyboard help', '[n] next track']);
    expect(visibleHints().filter((text) => text.startsWith('[?]'))).toHaveLength(1);
  });

  it('measures every offered entry in a copy that is out of the row', async () => {
    await mount({ hints: [binding(['j'], 'move down'), binding(['n'], 'next track')] });

    const probe = document.querySelector('footer .probe');
    expect(probe?.getAttribute('aria-hidden')).toBe('true');
    // One entry per thing offered, whether or not the visible row had room.
    expect(probe?.querySelectorAll('.measure')).toHaveLength(2);
    // …and none of them is a `.hint`: that is the visible row's contract, and
    // anything asking the page what the bar offers must not see the copy twice.
    expect(probe?.querySelectorAll('.hint')).toHaveLength(0);
  });

  it('keeps the message in its own box beside the hints', async () => {
    // The row is nowrap and the message comes last, so its own element is what
    // the stylesheet uses to give it space instead of letting the hints push it
    // off the right edge.
    await mount({
      hints: [binding(['j'], 'move down')],
      toast: { kind: 'info', message: 'sort: random' },
    });

    const message = document.querySelector('footer .message');
    expect(message?.querySelector('.toast')?.textContent).toBe('sort: random');
    expect(message?.previousElementSibling?.classList.contains('list')).toBe(true);
  });

  it('renders no message without a toast', async () => {
    await mount({ hints: [binding(['j'], 'move down')] });
    expect(document.querySelector('footer .message .toast')).toBeNull();
  });

  it('shows where a half-typed sequence can lead, keyed by what completes it', async () => {
    await mount({
      pending: 'g',
      continuations: [binding(['g h'], 'go home'), binding(['g a'], 'go to albums')],
      hints: [binding(['j'], 'move down')],
    });

    const leader = document.querySelector('footer [aria-label="key sequence"]');
    expect(leader?.getAttribute('role')).toBe('status');
    expect(leader?.textContent?.replace(/\s+/g, ' ')).toContain('[g]');
    expect(visibleHints()).toEqual(['[h] go home', '[a] go to albums']);
  });

  it('says the hints are hidden when the setting is off', async () => {
    await mount({ keyHints: false, hints: [binding(['j'], 'move down')] });

    expect(screen.getByText('key hints hidden (settings)')).toBeTruthy();
    expect(visibleHints()).toEqual([]);
  });

  it('still leads a half-typed sequence when the hints are hidden', async () => {
    // The setting is about not naming keys in general, not about abandoning
    // someone halfway through a chord.
    await mount({ keyHints: false, pending: 'g', continuations: [binding(['g h'], 'go home')] });

    expect(visibleHints()).toEqual(['[h] go home']);
  });
});
