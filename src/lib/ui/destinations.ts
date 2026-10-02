/**
 * The single table of places in the app.
 *
 * Both the `:` "go to" palette and the touch bottom nav are generated from this
 * list, so the on-screen rows, the mnemonics and the registered bindings cannot
 * drift apart.
 */

import { app } from '$lib/app.svelte';
import type { Route } from '$lib/stores/router.svelte';

export interface Destination {
  /** Single key that also jumps straight there, and is shown on the row. */
  key: string;
  label: string;
  hint: string;
  run: () => void;
  /** When present, this destination is also a bottom-nav tab on touch. */
  nav?: { activeOn: Route['name'][] };
}

// The mnemonics deliberately match the `g`-chord suffixes (g h, g a, g r ...),
// so muscle memory carries over in both directions.
export const DESTINATIONS: Destination[] = [
  {
    key: 'h',
    label: 'home',
    hint: 'random picks + recently added',
    run: () => app.router.navigate({ name: 'home' }),
    nav: { activeOn: ['home'] },
  },
  {
    key: 'a',
    label: 'albums',
    hint: 'newest, random or A-Z',
    run: () => app.router.navigate({ name: 'albums', sort: 'newest' }),
    nav: { activeOn: ['albums', 'album'] },
  },
  {
    key: 'r',
    label: 'artists',
    hint: 'the A-Z index',
    run: () => app.router.navigate({ name: 'artists' }),
    nav: { activeOn: ['artists', 'artist'] },
  },
  {
    key: 'p',
    label: 'playlists',
    hint: 'server-side playlists',
    run: () => app.router.navigate({ name: 'playlists' }),
  },
  {
    key: 'f',
    label: 'favourites',
    hint: 'starred albums, artists, tracks',
    run: () => app.router.navigate({ name: 'favorites' }),
  },
  {
    key: 'l',
    label: 'listen later',
    hint: 'albums kept for offline',
    run: () => app.router.navigate({ name: 'listen-later' }),
  },
  {
    key: '/',
    label: 'search',
    hint: 'tracks, albums, artists',
    run: () => {
      app.router.navigate({ name: 'search', query: app.search.state.query });
      app.focusSearch();
    },
  },
  {
    key: 'n',
    label: 'now playing',
    hint: 'cover, metadata, queue',
    run: () => app.router.navigate({ name: 'now-playing' }),
    nav: { activeOn: ['now-playing'] },
  },
  {
    key: 'Q',
    label: 'queue',
    hint: 'what plays next, reorder it',
    run: () => app.ui.openOverlay('queue'),
  },
  {
    key: '?',
    label: 'keyboard help',
    hint: 'every binding, generated live',
    run: () => app.ui.openOverlay('help'),
  },
  {
    key: 's',
    label: 'settings',
    hint: 'theme, credentials, auto-dj, offline',
    run: () => app.router.navigate({ name: 'settings' }),
  },
];

/** Destinations that belong in the touch bottom nav, in table order. */
export const NAV_DESTINATIONS: Destination[] = DESTINATIONS.filter((d) => d.nav);
