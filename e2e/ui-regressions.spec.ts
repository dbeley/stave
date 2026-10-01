/**
 * Browser-level regressions.
 *
 * These live here rather than in vitest because what was broken was *rendering*:
 * a value painted in the colour behind it, a list that never scrolled, a panel
 * title overlapping its first row. jsdom draws none of that, so it cannot
 * honestly assert it — each of these was measured in the browser first, failed
 * there, and is checked here so it stays fixed.
 */

import { expect, test } from '@playwright/test';
import { keys, login } from './helpers';

test.describe('rendering regressions', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('a settings value stays readable on the focused row', async ({ page }) => {
    await keys(page, 'g s');
    await expect(page.getByRole('listbox', { name: 'settings' })).toBeVisible();

    const contrast = await page.evaluate(() => {
      const row = document.querySelector('[role="listbox"][aria-label="settings"] .row.selected');
      const value = row?.querySelector('.value') as HTMLElement | null;
      if (!row || !value) return { rowBg: '', valueColor: '', value: null };
      return {
        rowBg: getComputedStyle(row).backgroundColor,
        valueColor: getComputedStyle(value).color,
        value: value.textContent,
      };
    });

    expect(contrast.value).toBeTruthy();
    // Was rgb(255,140,66) on rgb(255,140,66): the value was drawn in the colour
    // behind it, i.e. invisible.
    expect(contrast.valueColor).not.toBe(contrast.rowBg);
  });

  test('j scrolls the help list instead of walking off its bottom edge', async ({ page }) => {
    await page.keyboard.press('?');
    const help = page.getByRole('dialog', { name: 'keyboard' });
    await expect(help).toBeVisible();
    expect(await help.locator('.row').count()).toBeGreaterThan(30);

    for (let i = 0; i < 40; i += 1) await page.keyboard.press('j');

    const state = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const selected = dialog?.querySelector('.row.selected') as HTMLElement | null;
      if (!dialog || !selected) return null;
      const scroller = [...dialog.querySelectorAll('*')].find(
        (el) => (el as HTMLElement).scrollHeight > (el as HTMLElement).clientHeight + 4,
      ) as HTMLElement | undefined;
      const row = selected.getBoundingClientRect();
      const box = (scroller ?? dialog).getBoundingClientRect();
      return {
        scrollTop: Math.round(scroller?.scrollTop ?? 0),
        visible: row.bottom <= box.bottom + 1 && row.top >= box.top - 1,
      };
    });

    expect(state).not.toBeNull();
    expect(state!.scrollTop).toBeGreaterThan(0);
    expect(state!.visible).toBe(true);
  });

  test('a leader key shows where it can lead, and clears once resolved', async ({ page }) => {
    await page.keyboard.press('g');

    const leader = page.locator('footer [aria-label="key sequence"]');
    await expect(leader).toBeVisible();
    await expect(leader).toContainText('[g]');
    await expect(leader).toContainText('go home');
    await expect(leader).toContainText('go to now playing');
    expect(await leader.locator('.hint').count()).toBeGreaterThanOrEqual(5);

    // Completing the sequence puts the ordinary hints back.
    await page.keyboard.press('h');
    await expect(leader).toBeHidden();
    await expect(page.locator('header')).toContainText('home');
  });
});

// A short window is the only way the panel lists overflow, which is the case the
// header overlap showed up in.
test.describe('panel header', () => {
  test.use({ viewport: { width: 1100, height: 420 } });

  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test('the panel title never covers the first row', async ({ page }) => {
    await keys(page, 'g a');
    await expect(page.locator('.panel .row').first()).toBeVisible();

    const gap = async () =>
      page.evaluate(() => {
        const panel = document.querySelector('.panel') as HTMLElement;
        const title = panel.querySelector('.title') as HTMLElement;
        const first = panel.querySelector('.body [data-row="0"]') as HTMLElement | null;
        if (!first) return null;
        return Math.round(first.getBoundingClientRect().top - title.getBoundingClientRect().bottom);
      });

    // Was -3: the title's glyph box sat on top of the first row.
    expect(await gap()).toBeGreaterThanOrEqual(0);

    const body = page.locator('.panel .body.scroll').first();
    await body.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await page.keyboard.press('k');
    await body.evaluate((el) => {
      el.scrollTop = 0;
    });
    await page.waitForTimeout(150);

    expect(await gap()).toBeGreaterThanOrEqual(0);
  });
});
