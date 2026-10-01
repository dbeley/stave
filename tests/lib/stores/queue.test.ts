import { describe, it, expect } from 'vitest';
import { QueueStore } from '$lib/stores/queue.svelte';
import type { Track } from '$lib/domain/types';

function track(id: string, over: Partial<Track> = {}): Track {
  return { id, title: `Track ${id}`, durationSec: 180, starred: false, ...over };
}

function seeded(ids: string[] = ['a', 'b', 'c', 'd'], startIndex = 0, random?: () => number) {
  const queue = new QueueStore({ storage: null, ...(random ? { random } : {}) });
  queue.set(
    ids.map((id) => track(id)),
    startIndex,
  );
  return queue;
}

describe('construction and persistence', () => {
  it('starts empty and persists nothing when storage is null', () => {
    const queue = new QueueStore({ storage: null });
    expect(queue.isEmpty).toBe(true);
    expect(queue.length).toBe(0);
    expect(queue.state.index).toBe(-1);
    expect(queue.tracks).toEqual([]);
  });

  it('can be built without persistence', () => {
    const queue = new QueueStore({ persist: false });
    expect(queue.isEmpty).toBe(true);
  });
});

describe('set()', () => {
  it('replaces the queue and selects startIndex', () => {
    const queue = seeded(['a', 'b', 'c'], 1);
    expect(queue.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(queue.state.index).toBe(1);
    expect(queue.state.cursor).toBe(1);
    expect(queue.currentTrack?.id).toBe('b');
    expect(queue.upcoming.map((item) => item.track.id)).toEqual(['c']);
  });

  it('clamps an out-of-range startIndex', () => {
    expect(seeded(['a', 'b', 'c'], 99).state.index).toBe(2);
    expect(seeded(['a', 'b', 'c'], -5).state.index).toBe(0);
  });

  it('empties to index -1', () => {
    const queue = seeded(['a', 'b']);
    queue.set([], 0);
    expect(queue.state.index).toBe(-1);
    expect(queue.currentTrack).toBeUndefined();
    expect(queue.isEmpty).toBe(true);
  });
});

describe('append() / insertAfterCurrent() / insertAt()', () => {
  it('append() returns the index of the first inserted item', () => {
    const queue = seeded(['a', 'b']);
    expect(queue.append([track('c'), track('d')])).toBe(2);
    expect(queue.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(queue.append([])).toBe(-1);
  });

  it('append() starts playback on an empty queue', () => {
    const queue = new QueueStore({ storage: null });
    expect(queue.append([track('a')])).toBe(0);
    expect(queue.state.index).toBe(0);
  });

  it('insertAfterCurrent() inserts directly after the playing item', () => {
    const queue = seeded(['a', 'b', 'c'], 1);
    expect(queue.insertAfterCurrent([track('x')])).toBe(2);
    expect(queue.tracks.map((t) => t.id)).toEqual(['a', 'b', 'x', 'c']);
    expect(queue.state.index).toBe(1);
    expect(queue.currentTrack?.id).toBe('b');
  });

  it('insertAt() shifts the playing index when inserting before it', () => {
    const queue = seeded(['a', 'b', 'c'], 2);
    queue.insertAt(0, [track('x'), track('y')]);
    expect(queue.tracks.map((t) => t.id)).toEqual(['x', 'y', 'a', 'b', 'c']);
    expect(queue.state.index).toBe(4);
    expect(queue.currentTrack?.id).toBe('c');
  });

  it('insertAt() keeps the playing index when inserting after it', () => {
    const queue = seeded(['a', 'b', 'c'], 1);
    queue.insertAt(3, [track('x')]);
    expect(queue.state.index).toBe(1);
    expect(queue.currentTrack?.id).toBe('b');
  });

  it('insertAt() clamps the target index', () => {
    const queue = seeded(['a', 'b']);
    expect(queue.insertAt(99, [track('x')])).toBe(2);
    expect(queue.insertAt(-4, [track('y')])).toBe(0);
    expect(queue.tracks.map((t) => t.id)).toEqual(['y', 'a', 'b', 'x']);
  });
});

describe('remove() family', () => {
  it('remove() keeps the same playing track selected and adjusts the index', () => {
    const queue = seeded(['a', 'b', 'c', 'd'], 2);
    const removed = queue.remove([queue.items[0]!.uid]);
    expect(removed).toBe(1);
    expect(queue.tracks.map((t) => t.id)).toEqual(['b', 'c', 'd']);
    expect(queue.state.index).toBe(1);
    expect(queue.currentTrack?.id).toBe('c');
  });

  it('remove() keeps playing the following track when the playing one is removed', () => {
    const queue = seeded(['a', 'b', 'c', 'd'], 2);
    const removed = queue.remove([queue.items[2]!.uid]);
    expect(removed).toBe(1);
    expect(queue.tracks.map((t) => t.id)).toEqual(['a', 'b', 'd']);
    // The successor shifts into the old index, so playback continues seamlessly.
    expect(queue.state.index).toBe(2);
    expect(queue.currentTrack?.id).toBe('d');
  });

  it('remove() emptying the queue resets the cursor', () => {
    const queue = seeded(['a', 'b']);
    queue.remove(queue.items.map((item) => item.uid));
    expect(queue.state.index).toBe(-1);
    expect(queue.state.cursor).toBe(0);
    expect(queue.isEmpty).toBe(true);
  });

  it('remove() ignores unknown uids', () => {
    const queue = seeded(['a', 'b']);
    expect(queue.remove(['nope'])).toBe(0);
    expect(queue.length).toBe(2);
    expect(queue.remove([])).toBe(0);
  });

  it('removeAtCursor() removes the item under the cursor', () => {
    const queue = seeded(['a', 'b', 'c'], 0);
    queue.setCursor(1);
    expect(queue.removeAtCursor()).toBe(1);
    expect(queue.tracks.map((t) => t.id)).toEqual(['a', 'c']);
    expect(queue.state.cursor).toBe(1);
  });
});

describe('move()', () => {
  it('reorders the items', () => {
    const queue = seeded(['a', 'b', 'c', 'd'], 0);
    queue.move(0, 2);
    expect(queue.tracks.map((t) => t.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves the playing index down when the playing item is shifted', () => {
    const queue = seeded(['a', 'b', 'c', 'd'], 2);
    queue.move(2, 0);
    expect(queue.tracks.map((t) => t.id)).toEqual(['c', 'a', 'b', 'd']);
    expect(queue.state.index).toBe(0);
    expect(queue.currentTrack?.id).toBe('c');
  });

  it('fixes the playing index when a preceding item is moved past it', () => {
    const queue = seeded(['a', 'b', 'c', 'd'], 2);
    queue.move(0, 3);
    expect(queue.tracks.map((t) => t.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(queue.state.index).toBe(1);
    expect(queue.currentTrack?.id).toBe('c');
  });

  it('fixes the playing index when a following item is moved before it', () => {
    const queue = seeded(['a', 'b', 'c', 'd'], 1);
    queue.move(3, 0);
    expect(queue.tracks.map((t) => t.id)).toEqual(['d', 'a', 'b', 'c']);
    expect(queue.state.index).toBe(2);
    expect(queue.currentTrack?.id).toBe('b');
  });

  it('is a no-op for equal or out-of-range indices and empty queues', () => {
    const queue = seeded(['a', 'b'], 0);
    queue.move(1, 1);
    expect(queue.tracks.map((t) => t.id)).toEqual(['a', 'b']);
    new QueueStore({ storage: null }).move(0, 1);
  });
});

describe('moveCursorItem()', () => {
  it('moves the cursor item and returns false at the ends', () => {
    const queue = seeded(['a', 'b', 'c'], 0);
    queue.setCursor(0);
    expect(queue.moveCursorItem(-1)).toBe(false);
    expect(queue.moveCursorItem(1)).toBe(true);
    expect(queue.tracks.map((t) => t.id)).toEqual(['b', 'a', 'c']);
    expect(queue.state.cursor).toBe(1);
    queue.setCursor(2);
    expect(queue.moveCursorItem(1)).toBe(false);
    expect(queue.moveCursorItem(-1)).toBe(true);
  });
});

describe('clear() and jumps', () => {
  it('clear() empties everything', () => {
    const queue = seeded(['a', 'b'], 1);
    queue.clear();
    expect(queue.isEmpty).toBe(true);
    expect(queue.state.index).toBe(-1);
    expect(queue.state.cursor).toBe(0);
  });

  it('jumpTo() clamps and moves the cursor with it', () => {
    const queue = seeded(['a', 'b', 'c'], 0);
    expect(queue.jumpTo(2)).toBe(2);
    expect(queue.state.cursor).toBe(2);
    expect(queue.jumpTo(99)).toBe(2);
    expect(queue.jumpTo(-3)).toBe(0);
    expect(new QueueStore({ storage: null }).jumpTo(0)).toBe(-1);
  });

  it('jumpToUid() finds the item or returns -1', () => {
    const queue = seeded(['a', 'b', 'c'], 0);
    const uid = queue.items[1]!.uid;
    expect(queue.jumpToUid(uid)).toBe(1);
    expect(queue.state.index).toBe(1);
    expect(queue.jumpToUid('missing')).toBe(-1);
  });
});

describe('next() / previous()', () => {
  it('next() returns the following index, then end', () => {
    const queue = seeded(['a', 'b'], 0);
    expect(queue.next()).toEqual({ kind: 'index', index: 1 });
    queue.jumpTo(1);
    expect(queue.next()).toEqual({ kind: 'end' });
  });

  it('next() wraps to 0 when repeating everything', () => {
    const queue = seeded(['a', 'b'], 1);
    queue.setRepeat('all');
    expect(queue.next()).toEqual({ kind: 'index', index: 0 });
  });

  it('next() asks for a replay when repeating one', () => {
    const queue = seeded(['a', 'b'], 1);
    queue.setRepeat('one');
    expect(queue.next()).toEqual({ kind: 'repeat-one', index: 1 });
  });

  it('next() on an empty queue is end', () => {
    expect(new QueueStore({ storage: null }).next()).toEqual({ kind: 'end' });
  });

  it('previous() steps back and only wraps when repeating all', () => {
    const queue = seeded(['a', 'b', 'c'], 1);
    expect(queue.previous()).toBe(0);
    queue.jumpTo(0);
    expect(queue.previous()).toBe(0);
    queue.setRepeat('all');
    expect(queue.previous()).toBe(2);
  });

  it('previous() on an empty queue is -1', () => {
    expect(new QueueStore({ storage: null }).previous()).toBe(-1);
  });
});

describe('repeat cycle', () => {
  it('cycles off -> all -> one -> off and back', () => {
    const queue = new QueueStore({ storage: null });
    expect(queue.repeat).toBe('off');
    expect(queue.cycleRepeat()).toBe('all');
    expect(queue.cycleRepeat()).toBe('one');
    expect(queue.cycleRepeat()).toBe('off');
    expect(queue.cycleRepeat(-1)).toBe('one');
  });

  it('setRepeat stores the mode', () => {
    const queue = new QueueStore({ storage: null });
    queue.setRepeat('all');
    expect(queue.repeat).toBe('all');
  });
});

describe('shuffle', () => {
  it('keeps the playing item in place and shuffles the tail deterministically', () => {
    const queue = seeded(['a', 'b', 'c', 'd'], 1, () => 0);
    queue.setShuffle(true);
    expect(queue.shuffle).toBe(true);
    expect(queue.tracks.map((t) => t.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(queue.state.index).toBe(1);
    expect(queue.currentTrack?.id).toBe('b');
  });

  it('restores the original order when disabled, still playing the same track', () => {
    const queue = seeded(['a', 'b', 'c', 'd'], 1, () => 0);
    queue.setShuffle(true);
    queue.setShuffle(false);
    expect(queue.shuffle).toBe(false);
    expect(queue.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(queue.state.index).toBe(1);
    expect(queue.currentTrack?.id).toBe('b');
  });

  it('toggleShuffle returns the new state', () => {
    const queue = seeded(['a', 'b', 'c'], 0, () => 0);
    expect(queue.toggleShuffle()).toBe(true);
    expect(queue.toggleShuffle()).toBe(false);
  });
});

describe('snapshot() / restore()', () => {
  it('round-trips the whole queue state', () => {
    const queue = seeded(['a', 'b', 'c'], 1);
    queue.setRepeat('all');
    queue.setCursor(0);
    const snapshot = queue.snapshot();

    const restored = new QueueStore({ storage: null });
    restored.restore(snapshot);
    expect(restored.tracks.map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(restored.state.index).toBe(1);
    expect(restored.state.repeat).toBe('all');
    expect(restored.state.cursor).toBe(0);
    expect(restored.snapshot()).toEqual(snapshot);
  });

  it('restore() ignores null and malformed snapshots', () => {
    const queue = seeded(['a', 'b'], 0);
    queue.restore(null);
    queue.restore(undefined);
    queue.restore({ items: 'nope' } as never);
    expect(queue.tracks.map((t) => t.id)).toEqual(['a', 'b']);
  });
});

describe('identity', () => {
  it('the same track queued twice gets two distinct uids', () => {
    const queue = new QueueStore({ storage: null });
    const shared = track('same');
    queue.set([shared, shared]);
    expect(queue.items).toHaveLength(2);
    // `$state` deep-proxies stored objects, so identity is not preserved by
    // design: tracks are compared by `id` throughout the app.
    expect(queue.items[0]!.track).toEqual(shared);
    expect(queue.items[1]!.track).toEqual(shared);
    expect(queue.items[0]!.uid).not.toBe(queue.items[1]!.uid);
  });

  it('indexOfUid() finds items by uid', () => {
    const queue = seeded(['a', 'b', 'c'], 0);
    const uid = queue.items[2]!.uid;
    expect(queue.indexOfUid(uid)).toBe(2);
    expect(queue.indexOfUid('nope')).toBe(-1);
  });
});
