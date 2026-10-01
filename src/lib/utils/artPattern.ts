/**
 * Deterministic cover-art stand-ins.
 *
 * dmt generates an ASCII pattern for tracks without artwork; we do the same so
 * an album without a cover still has a visual identity, derived from its id.
 */

const BLOCKS = '░▒▓█';
const SHAPES = ['▚', '▞', '▙', '▟', '◆', '╳', '▒', '▓'];

/** Stable 32-bit hash of a string (FNV-1a). */
export function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small seeded PRNG (mulberry32) so patterns are stable per album. */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a monochrome-ish pattern: a soft diagonal field of block characters with
 * a scattered accent glyph, which reads as "cover art" at a glance.
 */
export function fallbackPattern(
  seed: string,
  columns: number,
  rows: number,
): { lines: string[]; colors: string[][] } {
  const random = seededRandom(hashString(seed));
  const lines: string[] = [];
  const colors: string[][] = [];
  const accentGlyph = SHAPES[hashString(seed) % SHAPES.length] ?? '◆';

  for (let y = 0; y < rows; y += 1) {
    let line = '';
    const rowColors: string[] = [];
    for (let x = 0; x < columns; x += 1) {
      // Diagonal gradient + a little noise for texture.
      const diagonal = (x / Math.max(1, columns) + y / Math.max(1, rows)) / 2;
      const noisy = Math.min(1, Math.max(0, diagonal + (random() - 0.5) * 0.25));
      const index = Math.min(BLOCKS.length - 1, Math.floor(noisy * BLOCKS.length));
      line += BLOCKS[index] ?? '░';
      // Keep the pattern dim so it never competes with real content.
      rowColors.push(diagonal > 0.66 ? 'var(--fg-dim)' : 'var(--border-focus)');
    }
    lines.push(line);
    colors.push(rowColors);
  }

  // Stamp the accent glyph in the middle, like a logo.
  const midRow = Math.floor(rows / 2);
  const midColumn = Math.floor(columns / 2);
  const row = lines[midRow];
  if (row) {
    lines[midRow] = `${row.slice(0, midColumn)}${accentGlyph}${row.slice(midColumn + 1)}`;
    colors[midRow]![midColumn] = 'var(--accent)';
  }

  return { lines, colors };
}
