/**
 * Browser-level regressions.
 *
 * These live here rather than in vitest because what was broken was *rendering*:
 * a value painted in the colour behind it, a list that never scrolled, a panel
 * title overlapping its first row. jsdom draws none of that, so it cannot
 * honestly assert it — each of these was measured in the browser first, failed
 * there, and is checked here so it stays fixed.
 */

import { expect, test, type Page } from '@playwright/test';
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

/**
 * The connect popup keeps a highlight cursor. These pin the invariant that made
 * it misbehave: the highlight and the *focus* must be the same thing, because the
 * focus is what decides where your typing goes.
 */
test.describe('connect popup', () => {
  test('tab moves the focus, so typing lands where the highlight points', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog', { name: 'connect' })).toBeVisible();

    const form = page.locator('.form');
    const server = form.locator('input[type="url"]');
    await server.fill('http://127.0.0.1:4534');

    await page.keyboard.press('Tab');

    // The next field really has the focus on it…
    await expect(form.locator('input[type="text"]')).toBeFocused();
    // …and the highlight agrees with the focus rather than drifting ahead of it.
    await expect(form.locator('.row.active .label')).toHaveText('username');

    // Typing used to append to the server URL while "username" was highlighted.
    await page.keyboard.type('dave');
    await expect(form.locator('input[type="text"]')).toHaveValue('dave');
    await expect(server).toHaveValue('http://127.0.0.1:4534');
  });

  test('moving onto a field never changes its value', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('dialog', { name: 'connect' })).toBeVisible();

    const form = page.locator('.form');
    const remember = form.locator('input[type="checkbox"]');
    await form.locator('input[type="url"]').click();

    // Tabbing onto the checkbox must not tick it (it used to).
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');

    await expect(remember).toBeFocused();
    await expect(form.locator('.row.active .label')).toHaveText('remember');
    await expect(remember).not.toBeChecked();

    // …while space still toggles it, which is what a checkbox should do.
    await page.keyboard.press('Space');
    await expect(remember).toBeChecked();
  });
});

/**
 * The hint bar is a single `nowrap` row, and all three of these were measured
 * in the browser before they were fixed:
 *
 * - the same key was offered twice (`[?] keyboard help` from the registry plus a
 *   hard-coded `[?] help`), and on the settings page both `[␣] activate` and the
 *   shadowed global `[␣] play / pause`,
 * - the message line came last and was pushed past the right edge whenever the
 *   hints overflowed — 0px wide on the home page, off-screen below ~1440,
 * - an entry that did not fit was clipped mid-label (`[q] back / clos`).
 */
test.describe('hint bar', () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  /**
   * The keys on screen. The hidden measuring copy carries its own class, so
   * this is the visible row and nothing else.
   */
  const shownKeys = (page: Page) =>
    page.$$eval('footer .hint', (nodes) =>
      nodes.map((node) => node.querySelector('.key')?.textContent?.trim() ?? ''),
    );

  const ROUTES: [string, string][] = [
    ['g h', 'home'],
    ['g a', 'albums'],
    ['g r', 'artists'],
    ['g p', 'playlists'],
    ['g f', 'favorites'],
    ['g l', 'listen later'],
    ['g n', 'now playing'],
    ['g s', 'settings'],
  ];

  test('offers each key once, and always offers help', async ({ page }) => {
    for (const [sequence, title] of ROUTES) {
      await keys(page, sequence);
      await expect(page.locator('header')).toContainText(title);

      const shown = await shownKeys(page);
      expect(shown.length, `no hints on ${title}`).toBeGreaterThan(0);
      expect(new Set(shown).size, `a key offered twice on ${title} (${shown})`).toBe(shown.length);
      expect(shown, `help dropped on ${title}`).toContain('[?]');
    }

    // Narrow enough that most of the row has to go: help still has to be there,
    // because it is how everything that did not fit is found.
    await page.setViewportSize({ width: 900, height: 700 });
    await page.waitForTimeout(300);
    const narrow = await shownKeys(page);
    expect(narrow).toContain('[?]');
    expect(new Set(narrow).size).toBe(narrow.length);
  });

  test('the message stays on screen when the hints fill the row', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 700 });
    await page.keyboard.press('z'); // reports the sort it landed on

    const state = await page.evaluate(() => {
      const footer = document.querySelector('footer.hints');
      const toast = footer?.querySelector('.toast');
      if (!footer || !toast) return null;
      const box = footer.getBoundingClientRect();
      const rect = toast.getBoundingClientRect();
      return {
        width: Math.round(rect.width),
        right: Math.round(rect.right),
        boxRight: Math.round(box.right),
        clientWidth: footer.clientWidth,
        scrollWidth: footer.scrollWidth,
      };
    });

    expect(state).not.toBeNull();
    // Was 0 wide on the home page and past the right edge below 1440: the hints
    // ran the full width of the row and the message came after them.
    expect(state!.width).toBeGreaterThan(0);
    expect(state!.right).toBeLessThanOrEqual(state!.boxRight + 1);
    // The row itself can no longer overflow, at any width.
    expect(state!.scrollWidth).toBeLessThanOrEqual(state!.clientWidth + 1);
  });

  test('shows whole entries, never one cut mid-label', async ({ page }) => {
    for (const width of [1440, 1024, 900]) {
      await page.setViewportSize({ width, height: 700 });
      await page.waitForTimeout(300);

      const clipped = await page.evaluate(() => {
        const footer = document.querySelector('footer.hints');
        if (!footer) return ['no footer'];
        const box = footer.getBoundingClientRect();
        return [...footer.querySelectorAll('.hint')]
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            return rect.left < box.left - 1 || rect.right > box.right + 1;
          })
          .map((node) => (node.textContent ?? '').replace(/\s+/g, ' ').trim());
      });

      expect(clipped, `clipped at ${width}px`).toEqual([]);
    }
  });
});
