import { describe, it, expect } from 'vitest';
import { fallbackPattern, hashString, seededRandom } from '$lib/utils/artPattern';

describe('hashString', () => {
  it('returns the FNV-1a offset basis for the empty string', () => {
    expect(hashString('')).toBe(0x811c9dc5);
  });

  it('is deterministic and unsigned', () => {
    expect(hashString('album-42')).toBe(89241653);
    expect(hashString('album-42')).toBe(hashString('album-42'));
    expect(hashString('album-42')).toBeGreaterThanOrEqual(0);
  });

  it('differs for different inputs', () => {
    expect(hashString('album-42')).not.toBe(hashString('album-43'));
  });
});

describe('seededRandom', () => {
  it('produces a stable sequence for a seed', () => {
    const a = seededRandom(12345);
    const b = seededRandom(12345);
    const seqA = [a(), a(), a()];
    expect(seqA).toEqual([0.9797282677609473, 0.3067522644996643, 0.484205421525985]);
    expect(seqA).toEqual([b(), b(), b()]);
  });

  it('produces different sequences for different seeds', () => {
    const a = seededRandom(12345);
    const b = seededRandom(999);
    expect(a()).not.toBe(b());
  });
});

describe('fallbackPattern', () => {
  it('builds a grid of the requested dimensions', () => {
    const { lines, colors } = fallbackPattern('album-42', 8, 4);

    expect(lines).toHaveLength(4);
    expect(lines.every((line) => [...line].length === 8)).toBe(true);
    expect(colors).toHaveLength(4);
    expect(colors.every((row) => row.length === 8)).toBe(true);
  });

  it('is stable per seed', () => {
    expect(fallbackPattern('album-42', 8, 4)).toEqual(fallbackPattern('album-42', 8, 4));
  });

  it('produces the expected pattern for a known seed', () => {
    expect(fallbackPattern('album-42', 8, 4).lines).toEqual([
      '░░░▒░▒▒▓',
      '░░░▒▒▒▒▓',
      '░▒▒▒╳▓▓▓',
      '▒▒▒▓▓▓▓█',
    ]);
  });

  it('varies by seed', () => {
    expect(fallbackPattern('album-42', 8, 4).lines).not.toEqual(
      fallbackPattern('album-99', 8, 4).lines,
    );
  });

  it('stamps the accent glyph at the centre in the accent colour', () => {
    const columns = 8;
    const rows = 4;
    const { lines, colors } = fallbackPattern('album-42', columns, rows);
    const midRow = Math.floor(rows / 2);
    const midColumn = Math.floor(columns / 2);

    expect([...lines[midRow]!][midColumn]).toBe('╳');
    expect(colors[midRow]![midColumn]).toBe('var(--accent)');

    // Every glyph is drawn from the block ramp plus the (single) accent shape.
    expect(/^[░▒▓█▚▞▙▟◆╳]*$/.test(lines.join(''))).toBe(true);
    // Only the centre cell is accent-coloured.
    const accentCells = colors.flat().filter((colour) => colour === 'var(--accent)');
    expect(accentCells).toHaveLength(1);
  });

  it('handles a 1x1 grid', () => {
    const { lines, colors } = fallbackPattern('album-42', 1, 1);

    expect(lines).toEqual(['╳']);
    expect(colors).toEqual([['var(--accent)']]);
  });
});
