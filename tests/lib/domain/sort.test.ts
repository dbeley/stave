import { describe, it, expect } from 'vitest';
import { SORT_OPTIONS, nextSort, sortOption } from '$lib/domain/sort';
import { ALBUM_LIST_TYPES } from '$lib/api/endpoints';

describe('SORT_OPTIONS', () => {
  it('exposes the six album list sorts in display order', () => {
    expect(SORT_OPTIONS.map((o) => o.id)).toEqual([
      'newest',
      'random',
      'recent',
      'frequent',
      'alphabeticalByName',
      'alphabeticalByArtist',
    ]);
  });

  it('maps every option onto a valid Subsonic list type', () => {
    for (const option of SORT_OPTIONS) {
      expect(ALBUM_LIST_TYPES).toContain(option.type);
      // The UI sort id and the wire list type happen to share a vocabulary.
      expect(option.type).toBe(option.id);
    }
  });

  it('marks only the stable sorts as paginated', () => {
    const paginated = Object.fromEntries(SORT_OPTIONS.map((o) => [o.id, o.paginated]));
    expect(paginated).toEqual({
      newest: true,
      random: false,
      recent: false,
      frequent: false,
      alphabeticalByName: true,
      alphabeticalByArtist: true,
    });
  });

  it('gives every option a label and a unique single-character hint', () => {
    const hints = SORT_OPTIONS.map((o) => o.hint);
    expect(new Set(hints).size).toBe(SORT_OPTIONS.length);
    for (const option of SORT_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(0);
      expect(option.hint).toMatch(/^[a-z]$/);
    }
  });
});

describe('sortOption', () => {
  it('finds the option with the given id', () => {
    expect(sortOption('random').id).toBe('random');
    expect(sortOption('alphabeticalByArtist').label).toBe('artist A-Z');
  });

  it('falls back to the first option for an unknown id', () => {
    expect(sortOption('nope' as never)).toBe(SORT_OPTIONS[0]);
  });
});

describe('nextSort', () => {
  it('cycles forward through the options', () => {
    expect(nextSort('newest')).toBe('random');
    expect(nextSort('random')).toBe('recent');
    expect(nextSort('frequent')).toBe('alphabeticalByName');
  });

  it('wraps around at the end of the list', () => {
    expect(nextSort('alphabeticalByArtist')).toBe('newest');
  });

  it('cycles backward with a negative direction', () => {
    expect(nextSort('newest', -1)).toBe('alphabeticalByArtist');
    expect(nextSort('random', -1)).toBe('newest');
  });

  it('applies a larger step modulo the list length', () => {
    expect(nextSort('newest', 2)).toBe('recent');
    expect(nextSort('newest', SORT_OPTIONS.length)).toBe('newest');
  });

  it('treats an unknown id as the first option', () => {
    expect(nextSort('bogus' as never)).toBe('random');
    expect(nextSort('bogus' as never, -1)).toBe('alphabeticalByArtist');
  });
});
