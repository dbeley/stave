import { describe, it, expect, vi } from 'vitest';
import {
  DEFAULT_SEEDS,
  buildAutoDjQueue,
  dedupe,
  pickSeeds,
  rankBySimilarity,
  similarityScore,
  type AutoDjRequest,
} from '$lib/player/autodj';
import type { Track } from '$lib/domain/types';

function track(id: string, over: Partial<Track> = {}): Track {
  return { id, title: `Track ${id}`, durationSec: 180, starred: false, ...over };
}

function makeRequest(over: Partial<AutoDjRequest> = {}): AutoDjRequest {
  return {
    history: [track('seed')],
    exclude: new Set<string>(),
    count: 3,
    requestSimilar: vi.fn(async () => []),
    requestRandom: vi.fn(async () => []),
    ...over,
  };
}

describe('pickSeeds', () => {
  it('keeps the most recent order, de-duplicates by id and limits', () => {
    const history = [
      track('a'),
      track('b'),
      track('a', { title: 'a again' }),
      track('c'),
      track('d'),
    ];
    expect(pickSeeds(history, 3).map((t) => t.id)).toEqual(['a', 'b', 'c']);
    expect(pickSeeds(history, 10).map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(pickSeeds(history, 0)).toEqual([]);
    expect(pickSeeds([], 3)).toEqual([]);
  });

  it('DEFAULT_SEEDS is a sane small number', () => {
    expect(DEFAULT_SEEDS).toBeGreaterThan(0);
    expect(
      pickSeeds(
        [1, 2, 3, 4, 5].map((n) => track(`t${n}`)),
        DEFAULT_SEEDS,
      ),
    ).toHaveLength(DEFAULT_SEEDS);
  });
});

describe('similarityScore', () => {
  const seed = track('seed', { genre: 'rock', artistId: 'ar1', albumId: 'al1', year: 2000 });

  it('skips a candidate identical to a seed', () => {
    expect(similarityScore(seed, [seed])).toBe(0);
  });

  it('weights genre above artist above album (with equal era)', () => {
    const sameGenre = track('g', { genre: 'rock', year: 2000 });
    const sameArtist = track('a', { artistId: 'ar1', year: 2000 });
    const sameAlbum = track('l', { albumId: 'al1', year: 2000 });
    expect(similarityScore(sameGenre, [seed])).toBeGreaterThan(similarityScore(sameArtist, [seed]));
    expect(similarityScore(sameArtist, [seed])).toBeGreaterThan(similarityScore(sameAlbum, [seed]));
  });

  it('rewards a closer release year and penalises a very distant one', () => {
    const base = { genre: 'rock' as const };
    const sameYear = similarityScore(track('y0', { ...base, year: 2000 }), [seed]);
    const oneYear = similarityScore(track('y1', { ...base, year: 2001 }), [seed]);
    const twoYears = similarityScore(track('y2', { ...base, year: 2002 }), [seed]);
    const farAway = similarityScore(track('y3', { ...base, year: 1980 }), [seed]);
    expect(sameYear).toBeGreaterThan(oneYear);
    expect(oneYear).toBeGreaterThan(twoYears);
    expect(twoYears).toBeGreaterThan(farAway);
    expect(farAway).toBeLessThan(similarityScore(track('y4', { ...base, year: 1995 }), [seed]));
  });

  it('treats a missing year as maximally distant', () => {
    const noYear = track('n', { genre: 'rock' });
    const gap = similarityScore(noYear, [seed]);
    const farYear = similarityScore(track('f', { genre: 'rock', year: 1900 }), [seed]);
    expect(gap).toBe(farYear);
  });

  it('sums the contributions of every seed', () => {
    const other = track('seed2', { genre: 'jazz', artistId: 'ar2', year: 2010 });
    const candidate = track('c', { genre: 'rock', year: 2000 });
    expect(similarityScore(candidate, [seed, other])).toBe(
      similarityScore(candidate, [seed]) + similarityScore(candidate, [other]),
    );
  });
});

describe('rankBySimilarity', () => {
  const seeds = [track('seed', { genre: 'rock', year: 2000 })];

  it('returns the best matches first, honours exclude and the limit', () => {
    const top = track('top', { genre: 'rock', year: 2000 });
    const mid = track('mid', { genre: 'rock', year: 2005 });
    const low = track('low', { genre: 'pop', year: 1990 });
    const excluded = track('ex', { genre: 'rock', year: 2000 });

    const ranked = rankBySimilarity(seeds, [low, top, mid, excluded], {
      exclude: new Set([excluded.id]),
    });
    expect(ranked.map((t) => t.id)).toEqual(['top', 'mid', 'low']);

    expect(rankBySimilarity(seeds, [low, top, mid], { limit: 2 }).map((t) => t.id)).toEqual([
      'top',
      'mid',
    ]);
    expect(rankBySimilarity(seeds, [low, top], { limit: 0 })).toEqual([]);
  });

  it('keeps the original library order on ties', () => {
    const first = track('first', { genre: 'rock', year: 2000 });
    const second = track('second', { genre: 'rock', year: 2000 });
    const third = track('third', { genre: 'rock', year: 2000 });
    expect(rankBySimilarity(seeds, [first, second, third]).map((t) => t.id)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });
});

describe('dedupe', () => {
  it('skips already-seen ids, records what it takes and respects the limit', () => {
    const seen = new Set(['seen']);
    const taken = dedupe([track('seen'), track('a'), track('a'), track('b'), track('c')], seen, 2);
    expect(taken.map((t) => t.id)).toEqual(['a', 'b']);
    expect([...seen]).toEqual(['seen', 'a', 'b']);
  });

  it('returns nothing for a non-positive limit', () => {
    const seen = new Set<string>();
    expect(dedupe([track('a')], seen, 0)).toEqual([]);
    expect(seen.size).toBe(0);
  });
});

describe('buildAutoDjQueue', () => {
  it('returns source "similar" when the server provides enough tracks', async () => {
    const requestSimilar = vi.fn(async (_seed: Track, count: number) =>
      [track('s1'), track('s2'), track('s3')].slice(0, count),
    );
    const requestRandom = vi.fn(async () => [] as Track[]);
    const outcome = await buildAutoDjQueue(
      makeRequest({ count: 2, requestSimilar, requestRandom }),
    );
    expect(outcome.source).toBe('similar');
    expect(outcome.tracks.map((t) => t.id)).toEqual(['s1', 's2']);
    expect(requestRandom).not.toHaveBeenCalled();
  });

  it('honours exclude when collecting similar tracks', async () => {
    const requestSimilar = vi.fn(async () => [track('s1'), track('s2'), track('s3')]);
    const outcome = await buildAutoDjQueue(
      makeRequest({
        count: 2,
        requestSimilar,
        exclude: new Set(['s1']),
        requestRandom: vi.fn(async () => [] as Track[]),
      }),
    );
    expect(outcome.source).toBe('similar');
    expect(outcome.tracks.map((t) => t.id)).toEqual(['s2', 's3']);
  });

  it('falls back to "heuristic" over a random sample, never returning excluded ids', async () => {
    const sample = [
      track('s1', { genre: 'rock', year: 2000 }),
      track('s2', { genre: 'rock', year: 2001 }),
      track('s3', { genre: 'jazz', year: 1990 }),
      track('s4', { genre: 'rock', year: 2002 }),
    ];
    const outcome = await buildAutoDjQueue(
      makeRequest({
        history: [track('seed', { genre: 'rock', year: 2000 })],
        count: 3,
        exclude: new Set(['s1']),
        requestSimilar: vi.fn(async () => [] as Track[]),
        requestRandom: vi.fn(async () => sample),
      }),
    );
    expect(outcome.source).toBe('heuristic');
    expect(outcome.tracks).toHaveLength(3);
    expect(outcome.tracks.map((t) => t.id)).not.toContain('s1');
    expect(new Set(outcome.tracks.map((t) => t.id)).size).toBe(outcome.tracks.length);
  });

  it('returns source "empty" when every lookup comes back empty', async () => {
    const outcome = await buildAutoDjQueue(makeRequest({ count: 3 }));
    expect(outcome).toEqual({ tracks: [], source: 'empty' });
  });

  it('survives a requestSimilar that throws', async () => {
    const requestSimilar = vi.fn(async () => {
      throw new Error('upstream down');
    });
    const outcome = await buildAutoDjQueue(
      makeRequest({
        history: [track('seed', { genre: 'rock', year: 2000 })],
        count: 2,
        requestSimilar,
        requestRandom: vi.fn(async () => [track('h1', { genre: 'rock', year: 2000 })]),
      }),
    );
    expect(outcome.tracks.map((t) => t.id)).toEqual(['h1']);
    expect(outcome.source).toBe('heuristic');
  });

  it('uses a fresh random pull as a last resort', async () => {
    const requestRandom = vi
      .fn<() => Promise<Track[]>>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([track('r1')]);
    const outcome = await buildAutoDjQueue(
      makeRequest({ count: 1, requestRandom, requestSimilar: vi.fn(async () => [] as Track[]) }),
    );
    expect(outcome.source).toBe('random');
    expect(outcome.tracks.map((t) => t.id)).toEqual(['r1']);
  });

  it('returns "empty" immediately for a non-positive count and calls nothing', async () => {
    const requestSimilar = vi.fn(async () => [] as Track[]);
    const requestRandom = vi.fn(async () => [] as Track[]);
    const outcome = await buildAutoDjQueue(
      makeRequest({ count: 0, requestSimilar, requestRandom }),
    );
    expect(outcome).toEqual({ tracks: [], source: 'empty' });
    expect(requestSimilar).not.toHaveBeenCalled();
    expect(requestRandom).not.toHaveBeenCalled();
  });

  it('de-duplicates across multiple similarity seeds', async () => {
    const shared = track('shared');
    const requestSimilar = vi.fn(async () => [shared, track('other')]);
    const outcome = await buildAutoDjQueue(
      makeRequest({
        history: [track('seed1'), track('seed2'), track('seed3')],
        count: 3,
        requestSimilar,
        requestRandom: vi.fn(async () => [] as Track[]),
      }),
    );
    const ids = outcome.tracks.map((t) => t.id);
    expect(ids).toContain('shared');
    expect(new Set(ids).size).toBe(ids.length);
  });
});
