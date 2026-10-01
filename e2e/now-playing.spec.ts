/**
 * The now playing page: reachable three ways (g n, the `:` palette, and tapping
 * the now-playing bar), showing the cover, metadata and the queue.
 *
 * The queue assertions deliberately reuse the same interactions the queue window
 * uses — the list is one shared component, and this is what proves the page's
 * copy is not a second implementation that quietly behaves differently.
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

test.describe('now playing page', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('g n opens the full view: cover, metadata and the queue', async ({ page }) => {
    await playFirstAlbumTrack(page);
    await keys(page, 'g n');

    await expect(page.locator('header')).toContainText('now playing', { timeout: 10_000 });

    // The cover pane, whatever the art itself resolves to (ASCII or image).
    await expect(page.locator('section.panel', { hasText: 'cover' }).first()).toBeVisible();

    const meta = page.locator('.meta');
    await expect(meta).toContainText('artist');
    await expect(meta).toContainText('duration');
    await expect(meta).toContainText('source');

    // The track title is the page heading, and the transport is actionable.
    // Scope to the page: the now-playing bar stays visible underneath and has a
    // play/pause button of its own, so an unscoped locator matches two elements.
    const main = page.locator('main');
    await expect(page.locator('h1')).not.toBeEmpty();
    await expect(main.getByRole('button', { name: 'seek forward 10 seconds' })).toBeVisible();
    await expect(main.getByRole('button', { name: 'play or pause' })).toBeVisible();

    // The queue is rendered below, as a real list.
    await expect(page.getByRole('listbox', { name: 'queue' })).toBeVisible();
  });

  test('tapping the now-playing bar opens it (the touch path)', async ({ page }) => {
    await playFirstAlbumTrack(page);

    await page.getByRole('button', { name: 'open now playing' }).click();
    await expect(page.locator('header')).toContainText('now playing', { timeout: 10_000 });
  });

  test('the palette lists it as a destination', async ({ page }) => {
    await playFirstAlbumTrack(page);

    await page.keyboard.press(':');
    const palette = page.getByRole('dialog', { name: 'go to' });
    await expect(palette).toBeVisible();
    await palette.getByRole('button', { name: /now playing/ }).click();

    await expect(page.locator('header')).toContainText('now playing', { timeout: 10_000 });
  });

  test('the queue on the page is the same queue, and can remove items', async ({ page }) => {
    await playFirstAlbumTrack(page);
    await keys(page, 'g n');

    const rows = page.locator('[role="listbox"][aria-label="queue"] .row');
    await expect(rows.first()).toBeVisible({ timeout: 10_000 });
    const before = await rows.count();
    expect(before).toBeGreaterThan(0);

    await page.keyboard.press('j');
    await page.keyboard.press('x');
    await expect.poll(async () => rows.count(), { timeout: 10_000 }).toBeLessThan(before);
  });
});
