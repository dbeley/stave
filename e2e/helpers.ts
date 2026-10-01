/** Shared helpers for the e2e suite. */

import { expect, type Page } from '@playwright/test';

export const MOCK_SERVER = `http://127.0.0.1:${process.env.MOCK_SUBSONIC_PORT ?? '4534'}`;
export const MOCK_USER = process.env.MOCK_SUBSONIC_USER ?? 'admin';
export const MOCK_PASS = process.env.MOCK_SUBSONIC_PASS ?? 'admin';

/**
 * Connect through the real login form (the blocking overlay), the same way a
 * user would — no back-door localStorage seeding, so auth is genuinely covered.
 *
 * Inputs are addressed by type rather than by label text: the "remember" label
 * also contains the word "password", so `getByLabel('password')` matches two
 * elements and trips Playwright's strict mode.
 */
export async function login(page: Page): Promise<void> {
  await page.goto('/');

  const server = page.locator('input[type="url"]');
  await expect(server).toBeVisible();
  await server.fill(MOCK_SERVER);
  await page.locator('input[type="text"]').fill(MOCK_USER);
  await page.locator('input[type="password"]').fill(MOCK_PASS);
  await page.getByRole('button', { name: 'connect' }).click();

  // The blocking overlay disappears once `ping` succeeds.
  await expect(page.getByRole('dialog', { name: 'connect' })).toBeHidden({ timeout: 20_000 });
  // The status bar shows a filled dot plus the server version once connected.
  await expect(page.locator('header')).toContainText('●', { timeout: 20_000 });
  await expect(page.locator('header')).not.toContainText('not connected');
}

/** Press a vim-style key sequence, one key at a time. */
export async function keys(page: Page, sequence: string): Promise<void> {
  for (const key of sequence.split(' ')) {
    await page.keyboard.press(key);
  }
}

/** The row the cursor is currently on, as plain text. */
export async function selectedRowText(page: Page): Promise<string> {
  return (await page.locator('.row.selected').first().innerText()).replace(/\s+/g, ' ').trim();
}

export async function rowCount(page: Page): Promise<number> {
  return page.locator('.row').count();
}
