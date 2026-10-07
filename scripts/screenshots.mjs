#!/usr/bin/env node
/**
 * Regenerate the screenshots used by the README and docs/screenshots/.
 *
 * The demo library is synthetic (see scripts/seed-library.sh) but everything
 * else is real: the script drives the production build through the actual
 * login form and the real key bindings against tools/mock-subsonic, the same
 * way e2e/ does. Nothing here is mocked up by hand — if the UI changes, the
 * screenshots change with it.
 *
 * Usage (inside the dev shell, which provides ffmpeg + the Playwright browsers):
 *
 *   just screenshots                    # build, seed, serve, capture
 *   node scripts/screenshots.mjs --only album   # iterate on a single shot
 *
 * Reusing servers you already have running:
 *
 *   node scripts/screenshots.mjs --base-url http://127.0.0.1:4173 \
 *                                --server-url http://127.0.0.1:4534
 *
 * Flags:
 *   --out <dir>         output directory            (default docs/screenshots)
 *   --base-url <url>    app URL; skips build+preview when given
 *   --server-url <url>  Subsonic URL; skips the mock server when given
 *   --port <n>          preview port                (default 4173)
 *   --mock-port <n>     mock Subsonic port          (default 4534)
 *   --music <dir>       library served by the mock  (default testdata/music)
 *   --only <name>       capture a single shot (repeatable)
 *   --no-build          reuse the existing dist/
 */

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ----------------------------------------------------------------- arguments

const argv = process.argv.slice(2);

function flag(name, fallback) {
  const index = argv.indexOf(`--${name}`);
  return index === -1 ? fallback : argv[index + 1];
}
function has(name) {
  return argv.includes(`--${name}`);
}
function repeated(name) {
  const values = [];
  argv.forEach((arg, index) => {
    if (arg === `--${name}`) values.push(argv[index + 1]);
  });
  return values;
}

const OUT = resolve(ROOT, flag('out', 'docs/screenshots'));
const PORT = Number(flag('port', '4173'));
const MOCK_PORT = Number(flag('mock-port', '4534'));
const MUSIC = resolve(ROOT, flag('music', 'testdata/music'));
const BASE_URL = flag('base-url', `http://127.0.0.1:${PORT}`);
const SERVER_URL = flag('server-url', `http://127.0.0.1:${MOCK_PORT}`);
const ONLY = repeated('only');
const WANT = (name) => ONLY.length === 0 || ONLY.includes(name);

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 412, height: 915 };

// An album from the demo library: enough tracks for a meaningful track list.
const HERO_ALBUM = 'Neon Cartography';
const SEARCH_TERM = 'aurelia';

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// ------------------------------------------------------------------- servers

const children = [];

async function waitForOk(url, what, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch {
      /* not up yet */
    }
    await sleep(300);
  }
  throw new Error(`timed out waiting for ${what} at ${url}`);
}

async function startServers() {
  if (!flag('server-url', null)) {
    if (!existsSync(MUSIC)) {
      // The demo library is deliberately not committed (same as e2e/, which
      // seeds it the same way rather than failing with "no music").
      console.log('[mock] generating the demo library in testdata/music…');
      const seeded = spawnSync('bash', [join(ROOT, 'scripts/seed-library.sh'), MUSIC], {
        cwd: ROOT,
        stdio: 'inherit',
        env: { ...process.env, SEED_FILES_ONLY: '0' },
      });
      if (seeded.status !== 0) {
        throw new Error('could not generate the demo library (needs ffmpeg on PATH)');
      }
    }
    console.log('[mock] starting the mock Subsonic server…');
    const mock = spawn(
      process.execPath,
      [
        join(ROOT, 'tools/mock-subsonic/server.mjs'),
        '--music',
        MUSIC,
        '--port',
        String(MOCK_PORT),
        '--quiet',
      ],
      { cwd: ROOT, stdio: 'inherit' },
    );
    children.push(mock);
    await waitForOk(`${SERVER_URL}/rest/ping?u=admin&p=admin&v=1.16.1&c=shots&f=json`, 'mock');
  }

  if (!flag('base-url', null)) {
    if (!has('no-build')) {
      console.log('[app] pnpm build…');
      const built = spawnSync('pnpm', ['build'], { cwd: ROOT, stdio: 'inherit' });
      if (built.status !== 0) throw new Error('pnpm build failed');
    }
    console.log(`[app] pnpm preview on :${PORT}…`);
    const preview = spawn('pnpm', ['preview', '--port', String(PORT), '--strictPort'], {
      cwd: ROOT,
      stdio: 'inherit',
    });
    children.push(preview);
    await waitForOk(`${BASE_URL}/`, 'preview server');
  }
}

function stopServers() {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGTERM');
  }
}

// -------------------------------------------------------------------- driver

/** Connect through the real login form, exactly like a user (and e2e/ does). */
async function login(page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  const server = page.locator('input[type="url"]');
  await server.waitFor({ state: 'visible', timeout: 30_000 });
  await server.fill(SERVER_URL);
  await page.locator('input[type="text"]').fill('admin');
  await page.locator('input[type="password"]').fill('admin');
  await page.getByRole('button', { name: 'connect' }).click();
  await page.getByRole('dialog', { name: 'connect' }).waitFor({ state: 'hidden', timeout: 30_000 });
  await page.waitForFunction(
    () => document.querySelector('header')?.textContent?.includes('●'),
    null,
    { timeout: 30_000 },
  );
}

async function keys(page, sequence) {
  for (const key of sequence.split(' ')) await page.keyboard.press(key);
}

/** Wait for the app to settle: a row on screen, no animation, light debounce. */
async function settle(page, { rows = true } = {}) {
  if (rows) {
    await page
      .locator('.row')
      .first()
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => {});
  }
  await page.waitForTimeout(500);
}

async function shot(page, name) {
  if (!WANT(name)) return;
  await page.screenshot({ path: join(OUT, `${name}.png`) });
  console.log(`  ✓ ${name}.png`);
}

/**
 * Move the list cursor onto the row whose text contains `needle`, with `j`
 * from the top — the way a keyboard user would. Clicking is not an option here:
 * a click *activates* the row (it opens the album/artist), so it cannot be used
 * to park the cursor on something before pressing an item key.
 */
async function moveToRow(page, needle, maxPresses = 60) {
  await keys(page, 'g g');
  for (let press = 0; press < maxPresses; press += 1) {
    if ((await selectedText(page)).includes(needle)) return;
    await page.keyboard.press('j');
    await page.waitForTimeout(60);
  }
  throw new Error(`no row matching ${JSON.stringify(needle)} on this page`);
}

/** Assert no overlay is left open — a stale modal silently ruins a shot. */
async function closeOverlays(page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const open = page.locator('[role="dialog"]:visible');
    if ((await open.count()) === 0) return;
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
  }
  throw new Error('an overlay would not close');
}

/** Text of the row the cursor is on, whitespace-collapsed. */
async function selectedText(page) {
  return (
    await page
      .locator('.row.selected')
      .first()
      .innerText()
      .catch(() => '')
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Star an album, idempotently.
 *
 * `f` toggles, and the mock server keeps stars in memory for the life of the
 * process — so a second run against an already-running server would *unstar*
 * whatever the first run starred (and the favourites page would come out
 * empty). Read the row's own badge and only press the key when it is missing.
 * `★` is a favourite, `⌂` is listen later (see AlbumRow.svelte).
 */
async function ensureStar(page, needle) {
  await moveToRow(page, needle);
  if (!(await selectedText(page)).includes('★')) await page.keyboard.press('f');
}

async function ensureListenLater(page, needle) {
  await moveToRow(page, needle);
  if (!(await selectedText(page)).includes('⌂')) await page.keyboard.press('L');
}

async function captureDesktop(browser) {
  const context = await browser.newContext({
    viewport: DESKTOP,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();

  console.log('[shots] desktop');
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="url"]').waitFor({ state: 'visible', timeout: 30_000 });
  await shot(page, 'connect');
  await login(page);

  // home
  await keys(page, 'g h');
  await settle(page);
  await shot(page, 'home');

  // album list — star a few albums and flag one for listen later, so the
  // favourites and listen-later pages have something to show.
  await keys(page, 'g a');
  await settle(page);
  for (const album of ['Idempotent Nights', 'Checksum Faults', 'Static Bloom', HERO_ALBUM]) {
    await ensureStar(page, album);
  }
  // …and the album we are about to open is also on the listen-later list
  await ensureListenLater(page, HERO_ALBUM);
  await page.waitForTimeout(900);
  await shot(page, 'albums');

  // album page
  await page.keyboard.press('Enter');
  await page
    .locator('[aria-label="album tracks"] .row')
    .first()
    .waitFor({ state: 'visible', timeout: 30_000 })
    .catch(() => {});
  await page.waitForTimeout(700);
  await shot(page, 'album');

  // play the whole album, then now playing with real progress on the bar
  await page.keyboard.press('P');
  await page.waitForTimeout(5000);
  await keys(page, 'g n');
  await settle(page, { rows: false });
  await shot(page, 'now-playing');

  // queue window
  await page.keyboard.press('Q');
  await page.waitForTimeout(600);
  await shot(page, 'queue');
  await closeOverlays(page);

  // artists → an artist page
  await keys(page, 'g r');
  await settle(page);
  await shot(page, 'artists');
  await moveToRow(page, 'Aurelia Vance');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await shot(page, 'artist');
  await closeOverlays(page);

  // search
  await keys(page, 'g h');
  await page.keyboard.press('/');
  const field = page.getByLabel('search');
  await field.waitFor({ state: 'visible', timeout: 15_000 });
  await field.fill(SEARCH_TERM);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2000);
  await shot(page, 'search');
  await closeOverlays(page);

  // playlists / favourites / listen later
  await keys(page, 'g p');
  await settle(page);
  await shot(page, 'playlists');
  await keys(page, 'g f');
  await settle(page);
  // the favourites page opens on artists; the starred albums are the point
  await page.keyboard.press('Tab');
  await page.waitForTimeout(700);
  await shot(page, 'favorites');
  await keys(page, 'g l');
  await settle(page);
  await shot(page, 'listen-later');

  // help overlay (generated from the binding registry)
  await keys(page, 'g h');
  await page.waitForTimeout(400);
  await page.keyboard.press('?');
  await page.getByRole('dialog', { name: 'keyboard' }).waitFor({ state: 'visible' });
  await page.waitForTimeout(600);
  await shot(page, 'help');
  await closeOverlays(page);

  // settings
  await keys(page, 'g s');
  await page.waitForTimeout(800);
  await shot(page, 'settings');

  // themes: light and amoled, on the same album page
  await keys(page, 'g a');
  await settle(page);
  await moveToRow(page, HERO_ALBUM);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  await page.keyboard.press('T'); // dark → light
  await page.waitForTimeout(700);
  await shot(page, 'theme-light');
  await page.keyboard.press('T'); // light → amoled
  await page.waitForTimeout(700);
  await shot(page, 'theme-amoled');
  await page.keyboard.press('T'); // back to dark

  await context.close();
}

async function captureMobile(browser) {
  const context = await browser.newContext({
    viewport: MOBILE,
    deviceScaleFactor: 3,
    reducedMotion: 'reduce',
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();

  console.log('[shots] mobile');
  await login(page);
  await settle(page);
  await shot(page, 'mobile-home');

  // the go-to palette doubles as the touch navigation
  await page.getByRole('button', { name: 'open the go-to palette' }).click();
  await page.getByRole('dialog', { name: 'go to' }).waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await shot(page, 'mobile-palette');
  await closeOverlays(page);

  // albums list → album page, the phone layout
  await keys(page, 'g a');
  await settle(page);
  await moveToRow(page, HERO_ALBUM);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await shot(page, 'mobile-album');

  await context.close();
}

// ---------------------------------------------------------------------- main

const main = async () => {
  await mkdir(OUT, { recursive: true });
  await startServers();

  const browser = await chromium.launch({
    args: ['--autoplay-policy=no-user-gesture-required'],
  });

  try {
    await captureDesktop(browser);
    await captureMobile(browser);
  } finally {
    await browser.close();
    stopServers();
  }

  console.log(`\nWrote the screenshots to ${OUT}`);
};

main().catch((error) => {
  console.error(`\nscreenshots failed: ${error.message}`);
  stopServers();
  process.exit(1);
});
