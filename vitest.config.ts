import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

export default defineConfig({
  plugins: [svelte()],
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
        // A floor just below where the suite actually sits (~79% lines / ~69%
        // branches / ~74% functions), so a regression has to be real to fail the
        // build instead of the gate sitting far below reality and never biting.
        //
        // Branches looks low, but it is the honest number: Vitest 5's AST-aware
        // V8 remapping counts implicit `else` branches that v3's v8-to-istanbul
        // discarded as false positives, so the old ~87% was inflated, not better.
        lines: 75,
        functions: 70,
        branches: 65,
        statements: 75,
      },
    },
  },
});
