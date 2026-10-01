import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * They run the real production build against the mock Subsonic server (see
 * e2e/global-setup.ts), and drive the app with the keyboard — which is the
 * point of this UI, and the only way to prove the key bindings actually work
 * end to end.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  globalSetup: './e2e/global-setup.ts',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    video: 'off',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
    // A music player is useless if the browser refuses to start playback
    // without a click first, and the suite drives everything from the keyboard.
    launchOptions: {
      args: ['--autoplay-policy=no-user-gesture-required'],
    },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
