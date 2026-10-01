/**
 * Smoke test: the app connects, lists a library, plays a track and searches —
 * all by keyboard, because a keyboard-first UI that needs a mouse to start is
 * not keyboard-first.
 */

import { expect, test } from '@playwright/test';
import { keys, login, selectedRowText } from './helpers';

test.describe('smoke', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('home shows random and recently added panes', async ({ page }) => {
    await expect(page.locator('header')).toContainText('home');
    await expect(page.getByText('random', { exact: false }).first()).toBeVisible();
    await expect(page.getByText('recently added', { exact: false }).first()).toBeVisible();

    // The demo library has albums, so at least one row must be listed.
    await expect(page.locator('.row').first()).toBeVisible({ timeout: 20_000 });
  });

  test('tab moves the focused pane, and j/k follow it', async ({ page }) => {
    // Each pane owns a cursor, and each starts on its first row.
    const randomRow = page.locator('[aria-label="random albums"] [aria-selected="true"]');
    const recentRow = page.locator('[aria-label="recently added albums"] [aria-selected="true"]');
    await expect(randomRow).toHaveAttribute('data-row', '0', { timeout: 20_000 });
    await expect(recentRow).toHaveAttribute('data-row', '0', { timeout: 20_000 });

    await page.keyboard.press('Tab');
    await page.keyboard.press('j');

    // Regression: the list bindings were registered once in onMount with the
    // focus-0 cursor, so Tab moved the highlight while j kept driving the random
    // pane. j must move the focused pane and leave the other one untouched.
    await expect(recentRow).toHaveAttribute('data-row', '1');
    await expect(randomRow).toHaveAttribute('data-row', '0');
  });

  test('the go-to palette navigates by tap and by keyboard', async ({ page }) => {
    // Touch path: on a phone the status-bar chip is the only navigation there is.
    await page.getByRole('button', { name: 'open the go-to palette' }).click();
    await expect(page.getByRole('dialog', { name: 'go to' })).toBeVisible();
    await page.getByRole('button', { name: 'go to artists' }).click();
    await expect(page.locator('header')).toContainText('artists');

    // Keyboard path: `:` opens the same palette.
    await keys(page, 'g h');
    await page.keyboard.press(':');
    await expect(page.getByRole('dialog', { name: 'go to' })).toBeVisible();
    await page.getByRole('button', { name: 'go to settings' }).click();
    await expect(page.locator('header')).toContainText('settings');
  });

  test('album list navigates and the cursor moves with j/k', async ({ page }) => {
    await keys(page, 'g a'); // go to albums
    await expect(page.locator('header')).toContainText('albums');
    await expect(page.locator('.row').first()).toBeVisible({ timeout: 20_000 });

    const first = await selectedRowText(page);
    await page.keyboard.press('j');
    const second = await selectedRowText(page);
    expect(second).not.toBe(first);

    await page.keyboard.press('k');
    expect(await selectedRowText(page)).toBe(first);

    await keys(page, 'G'); // last
    const last = await selectedRowText(page);
    expect(last).not.toBe(first);
    await keys(page, 'g g'); // first
    expect(await selectedRowText(page)).toBe(first);
  });

  test('opening an album shows its metadata and track list', async ({ page }) => {
    await keys(page, 'g a');
    await expect(page.locator('.row').first()).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Enter');

    await expect(page.locator('header')).toContainText('album');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('[role="listbox"][aria-label="album tracks"]')).toBeVisible({
      timeout: 20_000,
    });
    expect(await page.locator('[aria-label="album tracks"] .row').count()).toBeGreaterThan(0);
  });

  test('playing a track starts playback and updates the now-playing bar', async ({ page }) => {
    await keys(page, 'g a');
    await expect(page.locator('.row').first()).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Enter');
    await expect(page.locator('[aria-label="album tracks"] .row').first()).toBeVisible({
      timeout: 20_000,
    });

    await page.keyboard.press('Enter'); // play the selected track
    const bar = page.locator('#now-playing-bar');
    await expect(bar).toBeVisible();

    // The track title must land in the bar, and the queue must know about it.
    const trackTitle = await page.locator('[aria-label="album tracks"] .row.selected').innerText();
    const title = trackTitle.replace(/\s+/g, ' ').trim().split(' ').slice(1, 4).join(' ');
    await expect(page.locator('.bar')).toContainText(title.split(' ')[0] ?? '', {
      timeout: 20_000,
    });
    await expect(page.locator('header')).toContainText('≡');
  });

  test('search finds tracks and albums', async ({ page }) => {
    await page.keyboard.press('/');
    const input = page.getByLabel('search');
    await expect(input).toBeFocused();

    // Every seeded album contains the word "the" or a letter in common; use a
    // broad term so the assertion is about behaviour, not about the fixtures.
    await input.fill('a');
    await page.keyboard.press('Enter');

    await expect(page.locator('[role="listbox"][aria-label="search results"]')).toBeVisible({
      timeout: 20_000,
    });
    expect(await page.locator('[aria-label="search results"] .row').count()).toBeGreaterThan(0);
  });

  test('help overlay is generated from the binding registry', async ({ page }) => {
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'keyboard' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('play / pause');
    await expect(dialog).toContainText('toggle listen later');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });
});
