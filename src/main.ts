import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { app } from '$lib/app.svelte';
import { registerBackButton } from '$lib/native/backButton';

// Start routing and try to reuse stored credentials before the first paint of
// real data (the shell renders immediately either way).
app.start();

// Android hardware back: close an overlay, else walk in-app history, else let
// the OS exit. Fire-and-forget so it never blocks boot; on the web this is a
// no-op. The teardown is intentionally never called — the handler lives for the
// life of the page.
void registerBackButton({ onBack: () => app.handleBack() });

const target = document.getElementById('app');
if (!target) {
  throw new Error('#app mount point is missing from index.html');
}

const instance = mount(App, { target });

export default instance;
