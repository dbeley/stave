/**
 * Colour helpers for host-supplied palettes.
 *
 * A host (see `stylix` in the NixOS module) hands us colours as hex strings but
 * says nothing about whether the scheme is light or dark, so we infer it from the
 * background: `color-scheme` drives scrollbars, form controls and the like, and
 * getting it wrong looks broken rather than merely different.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** Parse `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`. Returns undefined if invalid. */
export function parseHexColor(input: string | undefined): Rgb | undefined {
  if (!input) return undefined;
  const hex = input.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(hex)) return undefined;

  const expanded =
    hex.length === 3 || hex.length === 4
      ? hex
          .slice(0, 3)
          .split('')
          .map((character) => character + character)
          .join('')
      : hex.slice(0, 6);

  if (expanded.length !== 6) return undefined;

  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number): number => {
    const scaled = value / 255;
    return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Which `color-scheme` suits a background. Falls back to dark, which is what the
 * terminal aesthetic assumes when the host gives us nothing parseable.
 */
export function colorSchemeFor(background: string | undefined): 'light' | 'dark' {
  const rgb = parseHexColor(background);
  if (!rgb) return 'dark';
  return relativeLuminance(rgb) > 0.5 ? 'light' : 'dark';
}
