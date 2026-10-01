<!--
  ASCII cover art, the look dmt made its signature.
 *
 * The image is drawn into a small offscreen canvas, sampled to a character grid
 * by luminance, and colourised per cell. When the image cannot be read (no
 * canvas, offline, CORS), a deterministic pattern derived from the album id is
 * used instead — so a cover is never an empty box.
-->
<script lang="ts">
  import { fallbackPattern } from '$lib/utils/artPattern';

  interface Props {
    /** Image URL, when one is available. */
    src?: string | undefined;
    /** Seed for the fallback pattern (album/track id). */
    seed: string;
    /** Grid width in characters. */
    columns?: number;
    /** Grid height in rows; defaults to columns/2 for a squarish look. */
    rows?: number;
    /** Colourise from the image, or render monochrome. */
    color?: boolean;
  }

  let { src, seed, columns = 40, rows, color = true }: Props = $props();

  const RAMP = ' .:-=+*#%@';

  let lines = $state<string[]>([]);
  let colors = $state<string[][]>([]);
  let failed = $state(false);
  let rowCount = $derived(rows ?? Math.max(6, Math.round(columns / 2.2)));

  $effect(() => {
    const url = src;
    const cols = columns;
    const targetRows = rowCount;
    const useColor = color;

    if (!url) {
      ({ lines, colors } = fallbackPattern(seed, cols, targetRows));
      failed = false;
      return;
    }

    let cancelled = false;
    void render(url, cols, targetRows, useColor).then((result) => {
      if (cancelled) return;
      if (!result) {
        ({ lines, colors } = fallbackPattern(seed, cols, targetRows));
        failed = true;
        return;
      }
      lines = result.lines;
      colors = result.colors;
      failed = false;
    });

    return () => {
      cancelled = true;
    };
  });

  interface Rendered {
    lines: string[];
    colors: string[][];
  }

  async function render(
    url: string,
    cols: number,
    targetRows: number,
    useColor: boolean,
  ): Promise<Rendered | null> {
    if (typeof document === 'undefined') return null;
    try {
      const image = await loadImage(url);
      const canvas = document.createElement('canvas');
      canvas.width = cols;
      canvas.height = targetRows;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) return null;
      context.drawImage(image, 0, 0, cols, targetRows);
      const data = context.getImageData(0, 0, cols, targetRows).data;

      const outLines: string[] = [];
      const outColors: string[][] = [];

      for (let y = 0; y < targetRows; y += 1) {
        let line = '';
        const rowColors: string[] = [];
        for (let x = 0; x < cols; x += 1) {
          const offset = (y * cols + x) * 4;
          const r = data[offset] ?? 0;
          const g = data[offset + 1] ?? 0;
          const b = data[offset + 2] ?? 0;
          const a = (data[offset + 3] ?? 255) / 255;
          // Perceptual luminance, then map onto the character ramp.
          const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
          const index = Math.min(RAMP.length - 1, Math.floor(luminance * (RAMP.length - 1)));
          line += RAMP[index] ?? ' ';
          rowColors.push(
            useColor && a > 0.1 ? boost(`rgb(${r}, ${g}, ${b})`, 1.35) : 'var(--fg-dim)',
          );
        }
        outLines.push(line);
        outColors.push(rowColors);
      }
      return { lines: outLines, colors: outColors };
    } catch {
      return null;
    }
  }

  function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.crossOrigin = 'anonymous';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('image failed to load'));
      image.src = url;
    });
  }

  /** Lift dark pixels so a dark cover still shows structure on a dark theme. */
  function boost(css: string, factor: number): string {
    const match = /rgb\((\d+), (\d+), (\d+)\)/.exec(css);
    if (!match) return css;
    const [, r, g, b] = match;
    const lift = (value: string) => Math.min(255, Math.round(Number(value) * factor));
    return `rgb(${lift(r!)}, ${lift(g!)}, ${lift(b!)})`;
  }
</script>

<div class="art" style="--cols: {columns}">
  {#each lines as line, rowIndex (rowIndex)}
    <div class="line" style="line-height: 1">
      {#each [...line] as character, columnIndex (columnIndex)}<span
          style="color: {colors[rowIndex]?.[columnIndex] ?? 'var(--fg-dim)'}">{character}</span
        >{/each}
    </div>
  {/each}
  {#if failed}
    <span class="fallback-note" title="cover art unavailable — generated pattern">~</span>
  {/if}
</div>

<style>
  .art {
    position: relative;
    font-family: var(--font-mono);
    font-size: clamp(6px, 1.1vw, 11px);
    line-height: 1;
    white-space: pre;
    overflow: hidden;
    user-select: none;
  }
  .line {
    white-space: pre;
  }
  .fallback-note {
    position: absolute;
    right: 0;
    bottom: 0;
    color: var(--fg-faint);
  }
</style>
