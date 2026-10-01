import { describe, it, expect } from 'vitest';
import { parseHexColor, relativeLuminance, colorSchemeFor } from '$lib/utils/color';

describe('parseHexColor', () => {
  it('parses 6-digit hex with and without the hash', () => {
    expect(parseHexColor('#0e1417')).toEqual({ r: 14, g: 20, b: 23 });
    expect(parseHexColor('0e1417')).toEqual({ r: 14, g: 20, b: 23 });
  });

  it('expands the 3-digit shorthand', () => {
    expect(parseHexColor('#abc')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('ignores the alpha channel', () => {
    expect(parseHexColor('#0e1417ff')).toEqual({ r: 14, g: 20, b: 23 });
    expect(parseHexColor('#abcd')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('is case-insensitive and tolerates surrounding whitespace', () => {
    expect(parseHexColor('  #AABBCC ')).toEqual({ r: 170, g: 187, b: 204 });
  });

  it('returns undefined for anything it cannot parse', () => {
    expect(parseHexColor(undefined)).toBeUndefined();
    expect(parseHexColor('')).toBeUndefined();
    expect(parseHexColor('#xyz')).toBeUndefined();
    expect(parseHexColor('rgb(1,2,3)')).toBeUndefined();
    expect(parseHexColor('#12345')).toBeUndefined();
  });
});

describe('relativeLuminance', () => {
  it('spans black to white', () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);
  });

  it('weights green above red above blue', () => {
    const red = relativeLuminance({ r: 255, g: 0, b: 0 });
    const green = relativeLuminance({ r: 0, g: 255, b: 0 });
    const blue = relativeLuminance({ r: 0, g: 0, b: 255 });
    expect(green).toBeGreaterThan(red);
    expect(red).toBeGreaterThan(blue);
  });
});

describe('colorSchemeFor', () => {
  it('classifies the app own themes correctly', () => {
    // Sanity check against the tokens in app.css.
    expect(colorSchemeFor('#0e1417')).toBe('dark'); // dark theme bg
    expect(colorSchemeFor('#000000')).toBe('dark'); // amoled bg
    expect(colorSchemeFor('#f4f4ee')).toBe('light'); // light theme bg
  });

  it('falls back to dark when there is nothing to judge', () => {
    // The terminal aesthetic assumes dark; a wrong guess would only be cosmetic,
    // but defaulting to light would flash white on a dark host.
    expect(colorSchemeFor(undefined)).toBe('dark');
    expect(colorSchemeFor('not-a-colour')).toBe('dark');
  });
});
