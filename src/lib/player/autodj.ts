/**
 * Auto-DJ.
 *
 * When the queue runs dry (or is about to), the auto-DJ appends tracks that are
 * *similar to what was just played*, producing an endless radio.
 *
 * Strategy, best first:
 *   1. server-provided similarity (`getSimilarSongs2`), seeded by the most
 *      recent tracks — this is the good stuff when Last.fm is configured;
 *   2. local heuristics over a random-server sample (genre / era / artist /
 *      same album), so the radio never stalls on a server without similarity;
 *   3. anything at all from the library, as the last resort.
 *
 * The scoring functions are pure and exported so they can be tested directly.
 */

import type { Track } from '$lib/domain/types';

export interface AutoDjRequest {
  /** Seed tracks, most recent first. */
  history: Track[];
  /** Track ids already in the queue (candidates are de-duplicated against these). */
  exclude: Set<string>;
  /** How many tracks to add. */
  count: number;
  /** Server similarity lookup. Should resolve to [] when unavailable. */
  requestSimilar: (seed: Track, count: number) => Promise<Track[]>;
  /** Random sample from the library, used for heuristic scoring. */
  requestRandom: (count: number) => Promise<Track[]>;
}

export interface AutoDjOutcome {
  tracks: Track[];
  /** Which strategy produced the result — surfaced in the status line and tests. */
  source: 'similar' | 'heuristic' | 'random' | 'empty';
}

/** Number of recent tracks used as similarity seeds. */
export const DEFAULT_SEEDS = 3;

export async function buildAutoDjQueue(
  request: AutoDjRequest,
  options: { seeds?: number; randomSampleSize?: number } = {},
): Promise<AutoDjOutcome> {
  const { history, count, exclude } = request;
  if (count <= 0) return { tracks: [], source: 'empty' };

  const seeds = pickSeeds(history, options.seeds ?? DEFAULT_SEEDS);
  const collected: Track[] = [];
  const seen = new Set(exclude);

  // 1. Server similarity, one seed at a time until we have enough.
  for (const seed of seeds) {
    if (collected.length >= count) break;
    let similar: Track[];
    try {
      similar = await request.requestSimilar(seed, count * 2);
    } catch {
      similar = [];
    }
    collected.push(...dedupe(similar, seen, count - collected.length));
  }
  if (collected.length >= count) {
    return { tracks: collected.slice(0, count), source: 'similar' };
  }

  // 2. Local heuristics over a random sample of the library.
  const sampleSize = options.randomSampleSize ?? Math.max(count * 6, 60);
  let sample: Track[];
  try {
    sample = await request.requestRandom(sampleSize);
  } catch {
    sample = [];
  }

  const heuristics = rankBySimilarity(seeds, sample, {
    exclude: seen,
    limit: count - collected.length,
  });
  if (heuristics.length > 0) {
    collected.push(...heuristics);
    // Record them, or the filler below would hand back the same tracks again.
    for (const track of heuristics) seen.add(track.id);
  }

  if (collected.length >= count) {
    return { tracks: collected.slice(0, count), source: 'heuristic' };
  }

  // 3. Last resort: whatever else the sample holds, then a fresh random pull.
  const filler = dedupe(sample, seen, count - collected.length);
  collected.push(...filler);
  if (collected.length < count) {
    try {
      const extra = await request.requestRandom(count - collected.length);
      collected.push(...dedupe(extra, seen, count - collected.length));
    } catch {
      /* nothing more we can do */
    }
  }

  if (collected.length === 0) return { tracks: [], source: 'empty' };
  return {
    tracks: collected.slice(0, count),
    source: heuristics.length > 0 || filler.length > 0 ? 'heuristic' : 'random',
  };
}

/** Most recent tracks, newest first, without duplicates. */
export function pickSeeds(history: Track[], count: number): Track[] {
  const seeds: Track[] = [];
  if (count <= 0) return seeds;
  const seen = new Set<string>();
  for (const track of history) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    seeds.push(track);
    if (seeds.length >= count) break;
  }
  return seeds;
}

/**
 * Score a candidate against the seed set.
 *
 * Weights are deliberately simple and explainable: shared genre is the
 * strongest signal available without external metadata, then a nearby release
 * year, then the same artist or album.
 */
export function similarityScore(candidate: Track, seeds: Track[]): number {
  let score = 0;
  for (const seed of seeds) {
    if (candidate.id === seed.id) continue;

    if (candidate.genre && seed.genre && candidate.genre === seed.genre) score += 3;
    if (candidate.artistId && seed.artistId && candidate.artistId === seed.artistId) score += 2;
    if (candidate.albumId && seed.albumId && candidate.albumId === seed.albumId) score += 1;

    const yearGap = yearDistance(candidate.year, seed.year);
    if (yearGap === 0) score += 1.5;
    else if (yearGap === 1) score += 1;
    else if (yearGap === 2) score += 0.5;
    else if (yearGap > 12) score -= 0.5;
  }
  return score;
}

function yearDistance(a: number | undefined, b: number | undefined): number {
  if (a === undefined || b === undefined) return 99;
  return Math.abs(a - b);
}

/** Rank candidates by similarity, best first; ties keep library order. */
export function rankBySimilarity(
  seeds: Track[],
  candidates: Track[],
  options: { exclude?: Set<string>; limit?: number } = {},
): Track[] {
  const exclude = options.exclude ?? new Set<string>();
  const limit = options.limit ?? candidates.length;

  const scored = candidates
    .filter((track) => !exclude.has(track.id))
    .map((track, position) => ({ track, position, score: similarityScore(track, seeds) }))
    .sort((a, b) => (b.score === a.score ? a.position - b.position : b.score - a.score));

  return scored.slice(0, Math.max(0, limit)).map((entry) => entry.track);
}

/** Take up to `limit` tracks not already seen; records what was taken. */
export function dedupe(tracks: Track[], seen: Set<string>, limit: number): Track[] {
  const out: Track[] = [];
  if (limit <= 0) return out;
  for (const track of tracks) {
    if (seen.has(track.id)) continue;
    seen.add(track.id);
    out.push(track);
    if (out.length >= limit) break;
  }
  return out;
}
