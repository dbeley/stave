import { describe, expect, it, vi } from 'vitest';
import { MIN_QUERY_LENGTH, SearchStore } from '$lib/stores/search.svelte';
import type { SubsonicClient } from '$lib/api/client';
import { emptySearchResults } from '$lib/domain/types';

/** Deterministic debounce: the scheduler hands back the callback instead of timing it. */
function manualScheduler() {
  const pending: (() => void)[] = [];
  let cancelled = 0;
  return {
    pending,
    get cancelled() {
      return cancelled;
    },
    schedule: (fn: () => void) => {
      pending.push(fn);
      return fn;
    },
    cancel: () => {
      cancelled += 1;
    },
    async flush() {
      const next = pending.shift();
      if (next) await next();
      // Let the search promise settle.
      await Promise.resolve();
    },
  };
}

function fakeClient(search3: ReturnType<typeof vi.fn>): SubsonicClient {
  return { search3 } as unknown as SubsonicClient;
}

describe('SearchStore', () => {
  it('starts empty and does not search on an empty query', async () => {
    const search3 = vi.fn().mockResolvedValue(emptySearchResults());
    const scheduler = manualScheduler();
    const store = new SearchStore({
      client: () => fakeClient(search3),
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancel,
    });

    expect(store.hasQuery).toBe(false);
    expect(store.hasResults).toBe(false);

    store.setQuery('   ');
    await scheduler.flush();

    expect(search3).not.toHaveBeenCalled();
    expect(store.state.results).toEqual(emptySearchResults());
    expect(store.state.loading).toBe(false);
  });

  it('debounces and reports loading while the query is pending', async () => {
    const search3 = vi.fn().mockResolvedValue(emptySearchResults());
    const scheduler = manualScheduler();
    const store = new SearchStore({
      client: () => fakeClient(search3),
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancel,
    });

    store.setQuery('radio');
    expect(store.state.loading).toBe(true);
    expect(search3).not.toHaveBeenCalled();
    expect(scheduler.pending).toHaveLength(1);

    await scheduler.flush();
    expect(search3).toHaveBeenCalledWith('radio', expect.any(Object));
    expect(store.state.loading).toBe(false);
  });

  it('cancels the previous debounce when a new keystroke arrives', () => {
    const scheduler = manualScheduler();
    const store = new SearchStore({
      client: () => fakeClient(vi.fn().mockResolvedValue(emptySearchResults())),
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancel,
    });

    store.setQuery('r');
    store.setQuery('ra');
    store.setQuery('rad');
    expect(scheduler.cancelled).toBe(2);
    expect(scheduler.pending).toHaveLength(3);
  });

  it('stores results and the query they belong to', async () => {
    const results = {
      artists: [{ id: 'ar', name: 'Artist', albumCount: 1, starred: false }],
      albums: [{ id: 'al', name: 'Album', songCount: 1, durationSec: 1, starred: false }],
      tracks: [{ id: 't', title: 'Track', durationSec: 1, starred: false }],
    };
    const scheduler = manualScheduler();
    const store = new SearchStore({
      client: () => fakeClient(vi.fn().mockResolvedValue(results)),
      schedule: scheduler.schedule,
      cancelSchedule: scheduler.cancel,
    });

    await store.submit('everything');
    expect(store.state.total).toBe(3);
    expect(store.state.results.albums[0]?.name).toBe('Album');
    expect(store.state.resultsFor).toBe('everything');
    expect(store.hasResults).toBe(true);
    expect(store.isEmptyResult).toBe(false);
  });

  it('discards a stale response when a newer query wins', async () => {
    let resolveSlow: ((value: unknown) => void) | undefined;
    const search3 = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSlow = resolve;
          }),
      )
      .mockResolvedValueOnce({
        artists: [],
        albums: [],
        tracks: [{ id: 'fast', title: 'Fast', durationSec: 1, starred: false }],
      });

    const store = new SearchStore({ client: () => fakeClient(search3) });

    const slow = store.submit('slow');
    const fast = store.submit('fast');
    await fast;

    // The slow request resolves last but must not clobber the newer results.
    resolveSlow?.({
      artists: [],
      albums: [],
      tracks: [{ id: 'slow', title: 'Slow', durationSec: 1, starred: false }],
    });
    await slow;

    expect(store.state.resultsFor).toBe('fast');
    expect(store.state.results.tracks.map((entry) => entry.id)).toEqual(['fast']);
  });

  it('reports failures and keeps the query', async () => {
    const onError = vi.fn();
    const store = new SearchStore({
      client: () => fakeClient(vi.fn().mockRejectedValue(new Error('search broke'))),
      onError,
    });

    await store.submit('boom');
    expect(store.state.error).toBe('search broke');
    expect(store.state.loading).toBe(false);
    expect(onError).toHaveBeenCalledOnce();
  });

  it('handles a missing client without throwing', async () => {
    const store = new SearchStore({ client: () => null });
    await expect(store.submit('anything')).resolves.toBeUndefined();
    expect(store.state.total).toBe(0);
  });

  it('clear() resets everything and invalidates an in-flight search', async () => {
    let resolvePending: ((value: unknown) => void) | undefined;
    const search3 = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePending = resolve;
        }),
    );
    const store = new SearchStore({ client: () => fakeClient(search3) });

    const pending = store.submit('gone');
    store.clear();
    resolvePending?.({
      artists: [],
      albums: [],
      tracks: [{ id: 'late', title: 'Late', durationSec: 1, starred: false }],
    });
    await pending;

    expect(store.state.query).toBe('');
    expect(store.state.total).toBe(0);
    expect(store.state.results.tracks).toEqual([]);
    expect(store.state.loading).toBe(false);
  });

  it('exposes the minimum query length', () => {
    expect(MIN_QUERY_LENGTH).toBeGreaterThan(0);
  });
});
