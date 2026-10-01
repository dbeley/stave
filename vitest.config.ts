import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [svelte({ hot: false })],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      $lib: fileURLToPath(new URL('./src/lib', import.meta.url)),
    },
    // Svelte 5 must resolve to the browser build (not svelte/server) in jsdom.
    conditions: ['browser'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    passWithNoTests: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/lib/**/*.{ts,svelte}'],
      exclude: ['src/lib/**/*.d.ts'],
      thresholds: {
        // A floor just below where the suite actually sits (~81% lines / ~87%
        // branches / ~75% functions), so a regression has to be real to fail the
        // build instead of the gate sitting far below reality and never biting.
        lines: 75,
        functions: 70,
        branches: 80,
        statements: 75,
      },
    },
  },
});
