/**
 * The app's `Actions` instance.
 *
 * Components import `actions` from here rather than constructing their own, so
 * there is exactly one shared implementation of "what clicking an album does".
 */

import { app } from '$lib/app.svelte';
import { createActions } from '$lib/ui/actions.svelte';

export const actions = createActions(app);
