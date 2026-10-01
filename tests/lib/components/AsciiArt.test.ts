import { describe, it, expect, vi, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';
import { fallbackPattern } from '$lib/utils/artPattern';
import AsciiArt from '$lib/components/AsciiArt.svelte';

/** Whitespace in the markup is irrelevant; the glyph grid is what matters. */
function glyphs(node: HTMLElement): string {
  return (node.textContent ?? '').replace(/\s+/g, '');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AsciiArt', () => {
  it('draws a deterministic generated pattern when there is no cover url', async () => {
    const view = render(AsciiArt, { props: { seed: 'al1', columns: 20 } });
    await tick();

    const rows = Math.max(6, Math.round(20 / 2.2));
    const expected = fallbackPattern('al1', 20, rows);
    expect(glyphs(view.container)).toBe(expected.lines.join(''));
    // A real pattern, not the "cover unavailable" marker.
    expect(view.container.textContent).not.toContain('~');
  });

  it('honours the columns and rows props', async () => {
    const view = render(AsciiArt, { props: { seed: 'al2', columns: 8, rows: 4 } });
    await tick();

    expect(glyphs(view.container)).toBe(fallbackPattern('al2', 8, 4).lines.join(''));
    expect(glyphs(view.container)).toHaveLength(32);
  });

  it('is stable for a given seed and differs across seeds', async () => {
    const a = render(AsciiArt, { props: { seed: 'same', columns: 12 } });
    const b = render(AsciiArt, { props: { seed: 'same', columns: 12 } });
    const c = render(AsciiArt, { props: { seed: 'other', columns: 12 } });
    await tick();

    expect(glyphs(a.container)).toBe(glyphs(b.container));
    expect(glyphs(a.container)).not.toBe(glyphs(c.container));
  });

  it('falls back to the generated pattern and flags it when the image fails', async () => {
    class FailingImage {
      onload: (() => void) | null = null;
      onerror: ((error?: unknown) => void) | null = null;
      crossOrigin = '';
      set src(_value: string) {
        queueMicrotask(() => this.onerror?.(new Error('nope')));
      }
    }
    vi.stubGlobal('Image', FailingImage);

    const view = render(AsciiArt, {
      props: { src: 'https://example.test/x.jpg', seed: 'al3', columns: 10 },
    });

    await vi.waitFor(() => {
      expect(view.container.textContent).toContain('~');
    });

    // The generated pattern is still drawn underneath the marker.
    expect(glyphs(view.container).length).toBeGreaterThan(0);
  });
});
