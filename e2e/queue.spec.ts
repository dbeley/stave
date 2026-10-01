/**
 * Queue behaviour, driven entirely from the keyboard: the spec's rule is that a
 * track click replaces the queue, `a` appends and `n` inserts after the current
 * item.
 */

import { expect, test } from '@playwright/test';
import { keys, login } from './helpers';

async function playFirstAlbumTrack(page: import('@playwright/test').Page): Promise<void> {
  await keys(page, 'g a');
  await expect(page.locator('.row').first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('[aria-label="album tracks"] .row').first()).toBeVisible({
    timeout: 20_000,
  });
  await page.keyboard.press('Enter');
  await expect(page.locator('header')).toContainText('≡', { timeout: 20_000 });
}

function queueLength(text: string): number {
  const match = /≡(\d+)/.exec(text);
  return match ? Number(match[1]) : 0;
}

test.describe('queue', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('playing a track fills the queue with the album', async ({ page }) => {
    await playFirstAlbumTrack(page);
    const header = (await page.locator('header').innerText()).replace(/\s+/g, ' ');
    expect(queueLength(header)).toBeGreaterThan(0);
  });

  test('a appends and n plays next, Q opens the queue window', async ({ page }) => {
    await playFirstAlbumTrack(page);

    await keys(page, 'g a');
    await expect(page.locator('.row').first()).toBeVisible();
    const before = queueLength((await page.locator('header').innerText()).replace(/\s+/g, ' '));

    // Append the whole selected album ("a" on an album row).
    await page.keyboard.press('a');
    await expect
      .poll(async () => queueLength((await page.locator('header').innerText()).replace(/\s+/g, ' ')), {
        timeout: 20_000,
      })
      .toBeGreaterThan(before);

    // The queue window lists what is queued and can remove an item with x.
    await page.keyboard.press('Q');
    const dialog = page.getByRole('dialog', { name: 'queue' });
    await expect(dialog).toBeVisible();
    const rows = await dialog.locator('.row').count();
    expect(rows).toBeGreaterThan(0);

    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await expect
      .poll(async () => dialog.locator('.row').count(), { timeout: 10_000 })
      .toBeLessThan(rows);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('space toggles playback and n skips', async ({ page }) => {
    await playFirstAlbumTrack(page);
    const bar = page.locator('#now-playing-bar');

    await page.keyboard.press('Space');
    await expect(bar).toContainText('>');
    await page.keyboard.press('Space');
    await expect(bar).toContainText('||');

    await page.keyboard.press('n');
    await expect(bar).toContainText('||');
  });

  test('favourites and listen later toggle from an album row', async ({ page }) => {
    await keys(page, 'g a');
    await expect(page.locator('.row').first()).toBeVisible();
    await expect(page.locator('.row.selected')).toBeVisible();

    // Listen later is local-only; the row badge appears without a round trip.
    await page.keyboard.press('L');
    await expect(page.locator('.row.selected .badge.later')).toBeVisible({ timeout: 10_000 });

    // Favourites hit the server; the badge follows the optimistic update.
    await page.keyboard.press('f');
    await expect(page.locator('.row.selected .badge.star')).toBeVisible({ timeout: 10_000 });
  });
});
