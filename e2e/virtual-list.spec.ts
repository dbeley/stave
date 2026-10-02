/**
 * Large-library rendering.
 *
 * A real library holds thousands of artists, and the first version of the
 * virtualised list rendered all of them: the scrollport was misidentified as the
 * list itself, so `clientHeight` reported the full 6000-row height and the render
 * window covered everything. Measured cost was ~450ms per `j` press.
 *
 * The assertions here are structural on purpose — how many rows exist, and whether
 * the cursor's row is really on screen — rather than absolute timings, which vary
 * between machines. The timing is printed so a regression is visible in the log
 * even when it stays under the (deliberately loose) bound.
 */

import { expect, test } from '@playwright/test';
import { keys, login, selectedRowText } from './helpers';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const PER_LETTER = 231; // 26 * 231 = 6006 artists, plus one heading row per letter

function artistPayload(): unknown {
  return {
    'subsonic-response': {
      status: 'ok',
      version: '1.16.1',
      artists: {
        ignoredArticles: 'The El La Los Las Le Les',
        index: LETTERS.map((letter, bucket) => ({
          name: letter,
          artist: Array.from({ length: PER_LETTER }, (_, position) => ({
            id: `ar-${bucket}-${position}`,
            name: `${letter}rtist ${String(position).padStart(4, '0')}`,
            albumCount: 3,
          })),
        })),
      },
    },
  };
}

/**
 * Rows the list has actually built.
 *
 * Counted by `data-row`, which only `ListView` sets: row components render a
 * `.row` of their own inside it (`ArtistRow` does), so counting `.row` reports
 * roughly double and hides the true window size.
 */
async function renderedRows(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('[aria-label="artists"] [data-row]').count();
}

/** The scrollport the list actually lives in, and the geometry it implies. */
async function geometry(page: import('@playwright/test').Page) {
  return page.locator('[aria-label="artists"]').evaluate((element) => {
    let port: HTMLElement | null = element.parentElement;
    while (port && !['auto', 'scroll'].includes(getComputedStyle(port).overflowY)) {
      port = port.parentElement;
    }
    const heights = [...element.querySelectorAll<HTMLElement>('[data-row]')]
      .map((row) => row.offsetHeight)
      .filter((height) => height > 0)
      .sort((a, b) => a - b);
    return {
      portClientHeight: port?.clientHeight ?? 0,
      minHeight: heights[0] ?? 0,
      maxHeight: heights[heights.length - 1] ?? 0,
      scrollHeight: element.scrollHeight,
      items: element.querySelectorAll('[data-row]').length,
    };
  });
}

test('a 6000-artist library renders a window, not the whole list', async ({ page }) => {
  await page.route('**/rest/getArtists*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(artistPayload()),
    }),
  );

  await login(page);
  await keys(page, 'g r');

  const list = page.locator('[aria-label="artists"]');
  await expect(list.locator('.row').first()).toBeVisible({ timeout: 20_000 });

  // The whole point: the visible band plus overscan, not the whole library.
  const initial = await renderedRows(page);
  const shape = await geometry(page);
  console.log(
    `PROBE rendered ${initial} of 6032 rows; port ${shape.portClientHeight}px, row ${shape.minHeight}px, scrollHeight ${shape.scrollHeight}px`,
  );
  expect(initial).toBeGreaterThan(0);
  // ~48 fit on screen here. The bound is loose enough for another viewport, and
  // far below the 6000 that would mean virtualisation had stopped working.
  expect(initial).toBeLessThan(120);

  /*
   * The spacer arithmetic assumes every row is the same height. An artists list
   * interleaves headings with artists, so this is a real assumption rather than a
   * property of the data — if a row type ever differs, the scroll height drifts.
   */
  expect(shape.maxHeight).toBe(shape.minHeight);

  // The list's scroll height has to match the rows it claims to have, or the
  // scrollbar and the spacers disagree with what is on screen.
  const full = 6032 * shape.minHeight;
  expect(shape.scrollHeight).toBeGreaterThan(full * 0.95);
  expect(shape.scrollHeight).toBeLessThan(full * 1.05);

  // The cursor starts on the first artist, not on its heading row.
  expect(await selectedRowText(page)).toContain('Artist 0000');

  // Moving the cursor must reach a row and keep the window small.
  await page.keyboard.press('j');
  expect(await selectedRowText(page)).toContain('Artist 0001');
  expect(await renderedRows(page)).toBeLessThan(120);

  const selected = page.locator('[aria-label="artists"] .row.selected');

  // A-Z jump: the cursor moves to a row that was never rendered, so the list has
  // to scroll to it rather than widen the window until it appears.
  await page.keyboard.press('z');
  await expect(selected).toContainText('Zrtist', { timeout: 5_000 });
  await expect(selected).toBeInViewport();
  expect(await renderedRows(page)).toBeLessThan(120);

  // Last row: same test at the far end, where the spacer arithmetic has to be right.
  await page.keyboard.press('G');
  await expect(selected).toContainText('Zrtist 0230', { timeout: 5_000 });
  await expect(selected).toBeInViewport();
  expect(await renderedRows(page)).toBeLessThan(120);

  // Back to the top.
  await keys(page, 'g g');
  await expect(selected).toContainText('Artist 0000', { timeout: 5_000 });
  await expect(selected).toBeInViewport();

  // Hold `j` for a while: the per-move cost was the reported symptom.
  const started = Date.now();
  for (let step = 0; step < 30; step += 1) {
    await page.keyboard.press('j');
  }
  const elapsed = Date.now() - started;
  console.log(`PROBE 30 x j: ${elapsed}ms (${Math.round(elapsed / 30)}ms per move)`);
  expect(elapsed).toBeLessThan(4_000);
  expect(await renderedRows(page)).toBeLessThan(120);
});
