/**
 * The same UI on a phone-sized touch viewport, plus the desktop counter-guard.
 *
 * It lives in its own file because Playwright requires `test.use` at the top level,
 * and the rest of the suite must keep running on desktop Chromium.
 *
 * The touch shell is exercised end to end here: the bottom nav drives navigation,
 * the mini-player opens the now-playing screen (whose queue segment lists the
 * queue), a long-press on a track row opens the action menu, and tapping the
 * progress bar seeks. Two more claims are checked that desktop Chromium cannot:
 * that the status bar's `[:]` chip survives the header's `overflow: hidden` at
 * 412px, and that the hint bar stops naming keys a touch device does not have.
 */
import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import { keys, login } from './helpers';

test.use({ ...devices['Pixel 7'] });

/**
 * Start playback the way the keyboard specs do, so the mini-player has a track
 * to show. On the touch shell the keyboard bindings still work — the shell only
 * changes the chrome, not the input model's registry.
 */
async function playFirstAlbumTrack(page: Page): Promise<void> {
  await keys(page, 'g a');
  await expect(page.locator('.row').first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('[aria-label="album tracks"] .row').first()).toBeVisible({
    timeout: 20_000,
  });
  await page.keyboard.press('Enter');
  await expect(page.locator('header')).toContainText('≡', { timeout: 20_000 });
}

/**
 * Hold a touch pointer on `target` until its long-press fires. Playwright has no
 * touch down/up API, so dispatch synthetic pointer events with `pointerType:
 * 'touch'` — the same shape `src/lib/utils/press.ts` keys off (it ignores mouse
 * pointers, which is why a real `click()` cannot trigger it).
 */
async function longPress(page: Page, target: Locator): Promise<void> {
  const box = await target.boundingBox();
  const x = box ? box.x + box.width / 2 : 0;
  const y = box ? box.y + box.height / 2 : 0;
  await target.dispatchEvent('pointerdown', {
    pointerType: 'touch',
    pointerId: 1,
    isPrimary: true,
    clientX: x,
    clientY: y,
  });
  await page.waitForTimeout(600); // the default delay is 500ms
  await target.dispatchEvent('pointerup', {
    pointerType: 'touch',
    pointerId: 1,
    isPrimary: true,
    clientX: x,
    clientY: y,
  });
}

test.describe('phone viewport', () => {
  test('navigation is reachable by touch, and key hints are hidden', async ({ page }) => {
    await login(page);

    const chip = page.getByRole('button', { name: 'open the go-to palette' });
    await expect(chip).toBeVisible();

    // Version and clock are dropped below 640px so the chip cannot be clipped.
    await expect(page.getByText(/^v\d+\.\d+\.\d+$/)).toBeHidden();

    // Hints name keys this device does not have, so none should render. Scoped to
    // the footer: the `[j]`-style text is not a reliable probe, since only the
    // first few hints are shown and `j` is not among them.
    await expect(page.locator('footer .hint')).toHaveCount(0);

    await chip.click();
    await expect(page.getByRole('dialog', { name: 'go to' })).toBeVisible();
    await page.getByRole('button', { name: 'go to settings' }).click();
    await expect(page.locator('header')).toContainText('settings');
  });

  test('list rows are large enough to tap', async ({ page }) => {
    await login(page);
    await page.goto('/#/albums');

    const row = page.locator('.row').first();
    await expect(row).toBeVisible();
    const box = await row.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('bottom nav navigates between sections', async ({ page }) => {
    await login(page);

    const nav = page.getByRole('navigation', { name: 'sections' });
    await expect(nav).toBeVisible();

    await nav.getByRole('button', { name: 'go to albums' }).click();
    await expect(page.locator('header')).toContainText('albums');

    await nav.getByRole('button', { name: 'go to artists' }).click();
    await expect(page.locator('header')).toContainText('artists');

    await nav.getByRole('button', { name: 'go to home' }).click();
    await expect(page.locator('header')).toContainText('home');
  });

  test('mini-player opens the now-playing screen, and the queue segment shows queue rows', async ({
    page,
  }) => {
    await login(page);
    await playFirstAlbumTrack(page);

    await page.getByRole('button', { name: 'open now playing' }).click();
    await expect(page.getByRole('tablist', { name: 'now playing views' })).toBeVisible();

    await page.getByRole('tab', { name: 'queue' }).click();
    const queue = page.getByRole('listbox', { name: 'queue' });
    await expect(queue).toBeVisible();
    await expect(queue.getByRole('option').first()).toBeVisible();
  });

  test('long-pressing a track row opens its action menu', async ({ page }) => {
    await login(page);
    await page.goto('/#/albums');

    const albumRow = page.locator('.row').first();
    await expect(albumRow).toBeVisible({ timeout: 20_000 });
    await albumRow.click();

    const trackRow = page.locator('[aria-label="album tracks"] .row').first();
    await expect(trackRow).toBeVisible({ timeout: 20_000 });

    await longPress(page, trackRow);
    await expect(page.getByRole('dialog', { name: 'actions' })).toBeVisible();
  });

  test('tapping the progress bar seeks', async ({ page }) => {
    await login(page);
    await playFirstAlbumTrack(page);

    const slider = page.getByRole('slider');
    await expect(slider).toBeVisible();

    // Click the middle of the bar; `aria-valuenow` is the fill percentage, so a
    // seek to the centre must land near 50 (not the ~0 it starts at).
    await slider.click();
    await expect
      .poll(async () => Number(await slider.getAttribute('aria-valuenow')))
      .toBeGreaterThanOrEqual(40);
  });
});

test.describe('desktop (counter-guard)', () => {
  // The file-wide `test.use` forces the Pixel 7; restore a desktop context here
  // so the terminal shell — not the touch shell — is what this block asserts.
  // (`defaultBrowserType` is worker-forcing and cannot be set in a group, so only
  // the options that actually flip the shell back are overridden.)
  test.use({ viewport: { width: 1440, height: 900 }, hasTouch: false, isMobile: false });

  test('desktop has no bottom nav and keeps vim keys', async ({ page }) => {
    await login(page);

    await expect(page.getByRole('navigation', { name: 'sections' })).toHaveCount(0);

    await page.keyboard.press('g');
    await page.keyboard.press('a');
    await expect(page.locator('header')).toContainText('albums');
  });
});
