import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
export default {
  // Enables <script lang="ts"> and the modern CSS features used in app.css.
  preprocess: vitePreprocess(),
};
