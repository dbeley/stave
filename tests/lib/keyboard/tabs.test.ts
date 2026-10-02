import { describe, it, expect, vi } from 'vitest';
import { tabBindings } from '$lib/keyboard/tabs';

/**
 * The shared tab shortcut. It exists because the same gesture had two keys:
 * `tab` on the favourites sections, `z` on the album sort orders.
 */
function make(ids: string[], active: string, onSelect = vi.fn()) {
  const bindings = tabBindings({ ids, active: () => active, onSelect });
  const run = (key: string) => {
    const binding = bindings.find((candidate) => candidate.keys.includes(key));
    expect(binding, `no binding for ${key}`).toBeTruthy();
    binding?.run();
  };
  return { bindings, onSelect, run };
}

describe('tabBindings', () => {
  it('puts both directions on tab and shift+tab', () => {
    const { bindings } = make(['artists', 'albums', 'tracks'], 'artists');

    expect(bindings.map((binding) => binding.keys)).toEqual([['tab'], ['shift+tab']]);
    expect(bindings.every((binding) => binding.scope === 'page')).toBe(true);
  });

  it('advances to the next tab', () => {
    const { onSelect, run } = make(['artists', 'albums', 'tracks'], 'artists');

    run('tab');

    expect(onSelect).toHaveBeenCalledWith('albums');
  });

  it('goes back to the previous tab', () => {
    const { onSelect, run } = make(['artists', 'albums', 'tracks'], 'albums');

    run('shift+tab');

    expect(onSelect).toHaveBeenCalledWith('artists');
  });

  it('wraps at both ends', () => {
    const last = make(['a', 'b', 'c'], 'c');
    last.run('tab');
    expect(last.onSelect).toHaveBeenCalledWith('a');

    const first = make(['a', 'b', 'c'], 'a');
    first.run('shift+tab');
    expect(first.onSelect).toHaveBeenCalledWith('c');
  });

  it('treats an unknown active id as the first tab instead of doing nothing', () => {
    // The album sort comes from the route, so a hand-typed `#/albums?sort=…` can
    // name an order the strip does not know.
    const { onSelect, run } = make(['newest', 'random'], 'nonsense');

    run('tab');

    expect(onSelect).toHaveBeenCalledWith('random');
  });

  it('does nothing when there are no tabs', () => {
    const { onSelect, run } = make([], 'anything');

    run('tab');
    run('shift+tab');

    expect(onSelect).not.toHaveBeenCalled();
  });
});
