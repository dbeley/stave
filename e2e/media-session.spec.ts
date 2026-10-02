/**
 * MediaSession wiring.
 *
 * This is the check that would have caught the original bug, in which
 * `BrowserMediaSession` was never constructed and every call went to the no-op
 * port. It observes the REAL `navigator.mediaSession` through a Proxy, because an
 * earlier version of this probe replaced the object with a plain one whose setters
 * accepted anything — it reported a healthy session while the real API was throwing
 * on metadata, and that throw was aborting playback.
 */

import { expect, test } from '@playwright/test';
import { keys, login } from './helpers';

test('playing a track registers OS media controls with real metadata', async ({ page }) => {
  await page.addInitScript(() => {
    const events: string[] = [];
    (window as unknown as { __msEvents: string[] }).__msEvents = events;
    const real = navigator.mediaSession;
    if (!real) {
      events.push('no-mediaSession');
      return;
    }
    const proxy = new Proxy(real, {
      set(target, property, value) {
        // Record what was set, and read the title back *through* the real object:
        // if the platform rejected our metadata this throws, which is the failure
        // we want to surface rather than swallow.
        events.push(`set:${String(property)}`);
        const ok = Reflect.set(target, property, value);
        if (property === 'metadata') {
          events.push(`title:${target.metadata?.title ?? ''}`);
        }
        return ok;
      },
      get(target, property) {
        const value = Reflect.get(target, property);
        if (typeof value === 'function') {
          return (...args: unknown[]) => {
            events.push(`call:${String(property)}:${String(args[0] ?? '')}`);
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value;
      },
    });
    Object.defineProperty(navigator, 'mediaSession', { configurable: true, get: () => proxy });
  });

  await login(page);

  // Play a track the same way a user does.
  await keys(page, 'g a');
  await expect(page.locator('.row').first()).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Enter');
  await expect(page.locator('[aria-label="album tracks"] .row').first()).toBeVisible({
    timeout: 20_000,
  });
  await page.keyboard.press('Enter');
  await expect(page.locator('header')).toContainText('≡', { timeout: 20_000 });
  await page.waitForTimeout(1500);

  const events = await page.evaluate(
    () => (window as unknown as { __msEvents: string[] }).__msEvents,
  );

  // The transport handlers the OS buttons call.
  expect(events).toContain('call:setActionHandler:play');
  expect(events).toContain('call:setActionHandler:pause');
  expect(events).toContain('call:setActionHandler:nexttrack');
  expect(events).toContain('call:setActionHandler:previoustrack');

  // Metadata actually accepted by the platform, carrying the track title.
  expect(events).toContain('set:metadata');
  const title = events.find((event) => event.startsWith('title:'))?.slice('title:'.length);
  expect(title).toBeTruthy();

  // And a playback state, without which the OS shows no transport at all.
  expect(events.filter((event) => event.startsWith('set:playbackState')).length).toBeGreaterThan(0);
});
