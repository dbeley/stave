import { describe, expect, it } from 'vitest';
import {
  CapabilityStore,
  applyShellToDocument,
  type MediaQueryLike,
} from '$lib/stores/capability.svelte';

function fakeQuery(matches: boolean) {
  const listeners: (() => void)[] = [];
  const query: MediaQueryLike = {
    matches,
    addEventListener: (_t, l) => listeners.push(l),
    removeEventListener: () => {},
  };
  return {
    query,
    fire: () => {
      query.matches = !query.matches;
      listeners.forEach((l) => l());
    },
  };
}

describe('CapabilityStore', () => {
  it('is touch when the coarse-pointer query matches', () => {
    const { query } = fakeQuery(true);
    expect(new CapabilityStore({ matchMedia: () => query }).shell).toBe('touch');
  });

  it('is terminal when the query does not match', () => {
    const { query } = fakeQuery(false);
    expect(new CapabilityStore({ matchMedia: () => query }).shell).toBe('terminal');
  });

  it('is terminal when matchMedia is unavailable', () => {
    expect(new CapabilityStore({ matchMedia: () => null }).shell).toBe('terminal');
  });

  it('flips when the query changes', () => {
    const { query, fire } = fakeQuery(false);
    const store = new CapabilityStore({ matchMedia: () => query });
    fire();
    expect(store.shell).toBe('touch');
  });

  it('writes data-shell onto the document element', () => {
    const root = document.createElement('html');
    applyShellToDocument('touch', root);
    expect(root.dataset.shell).toBe('touch');
    applyShellToDocument('terminal', root);
    expect(root.dataset.shell).toBe('terminal');
  });
});
