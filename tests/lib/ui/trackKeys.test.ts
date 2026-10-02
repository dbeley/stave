import { describe, it, expect, vi } from 'vitest';
import type { Track } from '$lib/domain/types';
import { ListCursor } from '$lib/keyboard/list.svelte';
import type { Binding } from '$lib/keyboard/registry.svelte';

const mocks = vi.hoisted(() => ({ actions: {} as Record<string, any> }));

vi.mock('$lib/ui/actionsRegistry.svelte', () => ({ actions: mocks.actions }));

import { trackListBindings } from '$lib/ui/trackKeys.svelte';

function track(id: string): Track {
  return { id, title: `Track ${id}`, durationSec: 100, starred: false };
}

function bindingFor(bindings: Binding[], key: string): Binding {
  const found = bindings.find((binding) => binding.keys.includes(key));
  if (!found) throw new Error(`no binding for ${key}`);
  return found;
}

describe('trackListBindings', () => {
  it('enter plays with the surrounding list, shift+enter plays the track alone', () => {
    mocks.actions.playTrackNow = vi.fn();
    const tracks = [track('t1'), track('t2')];
    const cursor = new ListCursor({ index: 1, count: tracks.length });
    const context = { tracks, index: 1, label: 'album' };
    const bindings = trackListBindings(cursor, () => tracks, { context: () => context });

    bindingFor(bindings, 'enter').run();
    expect(mocks.actions.playTrackNow).toHaveBeenCalledWith(tracks[1], context);

    bindingFor(bindings, 'shift+enter').run();
    // No context argument: the queue becomes just this track.
    expect(mocks.actions.playTrackNow).toHaveBeenCalledWith(tracks[1]);
    expect(mocks.actions.playTrackNow).toHaveBeenCalledTimes(2);
  });

  it('shift+enter still works when the list supplies an onActivate', () => {
    mocks.actions.playTrackNow = vi.fn();
    const tracks = [track('t1')];
    const cursor = new ListCursor({ index: 0, count: tracks.length });
    const onActivate = vi.fn();
    const bindings = trackListBindings(cursor, () => tracks, { onActivate });

    bindingFor(bindings, 'shift+enter').run();

    expect(onActivate).not.toHaveBeenCalled();
    expect(mocks.actions.playTrackNow).toHaveBeenCalledWith(tracks[0]);
  });
});
