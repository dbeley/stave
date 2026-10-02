/**
 * Temporary probe. jsdom cannot answer either of these:
 *
 *  1. Is MediaSession actually registered in the real browser? The bug was that
 *     production never constructed BrowserMediaSession, so the only honest check
 *     is to look at navigator.mediaSession in a running page.
 *  2. Does virtualisation actually make the artist list cheaper? Needs real
 *     layout, real DOM counts and real timings.
 *
 * Deleted once answered.
 */

import { expect, test } from '@playwright/test';
import { keys, login } from './helpers';

test('probe: mediaSession wiring', async ({ page }) => {
  // Spying must happen BEFORE the app module runs, or the port is already built.
  await page.addInitScript(() => {
    const events: string[] = [];
    (window as unknown as { __msEvents: string[] }).__msEvents = events;
    try {
      Object.defineProperty(navigator, 'mediaSession', {
        configurable: true,
        get() {
          return {
            set metadata(value: unknown) {
              events.push(`metadata:${JSON.stringify(value)?.slice(0, 60)}`);
            },
            set playbackState(value: unknown) {
              events.push(`state:${String(value)}`);
            },
            setPositionState(value: unknown) {
              events.push(`position:${JSON.stringify(value)?.slice(0, 40)}`);
            },
            setActionHandler(action: string) {
              events.push(`handler:${action}`);
            },
          };
        },
      });
    } catch {
      events.push('spy-failed');
    }
  });

  await login(page);

  // Playing a track is what registers metadata and handlers.
  await keys(page, 'g a');
  await expect(page.locator('.row').first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('[aria-label="album tracks"] .row').first()).toBeVisible({
    timeout: 20_000,
  });
  await page.keyboard.press('Enter');
  await expect(page.locator('header')).toContainText('≡', { timeout: 20_000 });
  await page.waitForTimeout(2000);

  const events = await page.evaluate(
    () => (window as unknown as { __msEvents: string[] }).__msEvents,
  );
  console.log('PROBE mediaSession calls:', JSON.stringify(events.slice(0, 25)));
  console.log('PROBE call count:', events.length);
});


test('probe: artist list cost with a large library', async ({ page }) => {
  // The mock library has six artists, so virtualisation never engages and the
  // measurement proves nothing. Stub `getArtists` to return thousands, which is
  // the case that was slow.
  await page.addInitScript(() => {
    const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
    const artists = Array.from({ length: 6000 }, (_, index) => ({
      id: `ar${index}`,
      name: `${LETTERS[index % 26]}rtist ${String(index).padStart(5, '0')}`,
      albumCount: 3,
    }));
    // Shape the parser expects: index[].artist[] (ArtistID3), see toArtistsListing.
    const listing = {
      ignoredArticles: '',
      index: LETTERS.map((letter) => ({
        name: letter,
        artist: artists.filter((artist) => artist.name.startsWith(letter)),
      })),
    };
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('getArtists') || url.includes('getIndexes')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              'subsonic-response': {
                status: 'ok',
                version: '1.16.1',
                type: 'navidrome',
                serverVersion: '0.54.0-mock',
                openSubsonic: true,
                artists: listing,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        );
      }
      return originalFetch(input as RequestInfo, init);
    };
  });

  await login(page);

  const started = Date.now();
  await keys(page, 'g r');
  const list = page.locator('[aria-label="artists"]');
  await expect(list.locator('.row').first()).toBeVisible({ timeout: 30_000 });
  console.log('PROBE 6000-artist list visible in ms:', Date.now() - started);

  await page.waitForTimeout(800);
  const dom = await page.evaluate(() => {
    const list = document.querySelector('[aria-label="artists"]');
    const body = document.querySelector('.panel .body.scroll');
    return {
      renderedRows: list?.querySelectorAll('.row').length ?? -1,
      pads: list?.querySelectorAll('.pad').length ?? -1,
      padHeights: [...(list?.querySelectorAll<HTMLElement>('.pad') ?? [])].map((p) => p.style.height),
      scrollHeight: body?.scrollHeight ?? -1,
      clientHeight: body?.clientHeight ?? -1,
    };
  });
  console.log('PROBE DOM with 6000 artists:', JSON.stringify(dom));

  // Walk a long way down, which is where the old list stuttered.
  const moveStart = Date.now();
  for (let i = 0; i < 30; i += 1) await page.keyboard.press('j');
  console.log('PROBE 30 j presses in ms:', Date.now() - moveStart);

  const after = await page.evaluate(() => {
    const list = document.querySelector('[aria-label="artists"]');
    const selected = list?.querySelector('.row.selected');
    const row = selected?.getBoundingClientRect();
    const body = document.querySelector('.panel .body.scroll')?.getBoundingClientRect();
    return {
      renderedRows: list?.querySelectorAll('.row').length ?? -1,
      selectedIndex: selected?.getAttribute('data-row') ?? null,
      selectedInsideViewport: row && body ? row.top >= body.top - 1 && row.bottom <= body.bottom + 1 : null,
    };
  });
  console.log('PROBE after walking down:', JSON.stringify(after));

  // The A-Z jump still has to work on a virtualised list.
  await page.keyboard.press('z');
  await page.waitForTimeout(500);
  const jumped = await page.evaluate(() => {
    const list = document.querySelector('[aria-label="artists"]');
    const selected = list?.querySelector('.row.selected');
    return {
      selectedIndex: selected?.getAttribute('data-row') ?? null,
      text: selected?.textContent?.trim().slice(0, 40) ?? null,
    };
  });
  console.log('PROBE after A-Z jump (z):', JSON.stringify(jumped));
});
