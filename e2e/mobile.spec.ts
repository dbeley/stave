/**
 * The same UI on a phone-sized touch viewport.
 *
 * It lives in its own file because Playwright requires `test.use` at the top level,
 * and the rest of the suite must keep running on desktop Chromium.
 *
 * Two claims are checked here that desktop Chromium cannot check: that the status
 * bar's `[:]` chip survives the header's `overflow: hidden` at 412px, and that the
 * hint bar stops naming keys a touch device does not have.
 */
import { devices, expect, test } from '@playwright/test';
import { login } from './helpers';

test.use({ ...devices['Pixel 7'] });

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
});
