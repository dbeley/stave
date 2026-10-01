import { mount } from 'svelte';
import './app.css';
import App from './App.svelte';
import { app } from '$lib/app.svelte';

// Start routing and try to reuse stored credentials before the first paint of
// real data (the shell renders immediately either way).
app.start();

const target = document.getElementById('app');
if (!target) {
  throw new Error('#app mount point is missing from index.html');
}

const instance = mount(App, { target });

export default instance;
