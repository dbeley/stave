/**
 * Hash-based routing.
 *
 * Hash routing keeps the app deployable as a plain static bundle (GitHub Pages,
 * nginx, a Capacitor WebView) with no server-side rewrites.
 *
 * `parseRoute`/`routeToHash` are pure so every route shape is unit tested.
 */

import type { AlbumListSort } from '$lib/domain/sort';

export type Route =
  | { name: 'home' }
  | { name: 'albums'; sort: AlbumListSort }
  | { name: 'artists' }
  | { name: 'album'; id: string }
  | { name: 'artist'; id: string }
  | { name: 'playlists' }
  | { name: 'playlist'; id: string }
  | { name: 'favorites' }
  | { name: 'listen-later' }
  | { name: 'search'; query: string }
  | { name: 'settings' };

export const ROUTE_NAMES = [
  'home',
  'albums',
  'artists',
  'album',
  'artist',
  'playlists',
  'playlist',
  'favorites',
  'listen-later',
  'search',
  'settings',
] as const;

/** Human-readable title for the header. */
export function routeTitle(route: Route): string {
  switch (route.name) {
    case 'home':
      return 'home';
    case 'albums':
      return `albums (${route.sort})`;
    case 'artists':
      return 'artists';
    case 'album':
      return 'album';
    case 'artist':
      return 'artist';
    case 'playlists':
      return 'playlists';
    case 'playlist':
      return 'playlist';
    case 'favorites':
      return 'favorites';
    case 'listen-later':
      return 'listen later';
    case 'search':
      return route.query ? `search: ${route.query}` : 'search';
    case 'settings':
      return 'settings';
  }
}

export function parseRoute(hash: string): Route {
  const raw = (hash || '').replace(/^#/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = (pathPart ?? '')
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(decodeSegment);

  const [head, second] = segments;
  const params = new URLSearchParams(queryPart ?? '');

  switch (head) {
    case undefined:
      return { name: 'home' };
    case 'albums':
      return { name: 'albums', sort: parseSort(params.get('sort')) };
    case 'artists':
      return { name: 'artists' };
    case 'album':
      return second ? { name: 'album', id: second } : { name: 'albums', sort: 'newest' };
    case 'artist':
      return second ? { name: 'artist', id: second } : { name: 'artists' };
    case 'playlists':
      return { name: 'playlists' };
    case 'playlist':
      return second ? { name: 'playlist', id: second } : { name: 'playlists' };
    case 'favorites':
      return { name: 'favorites' };
    case 'listen-later':
      return { name: 'listen-later' };
    case 'search':
      return { name: 'search', query: params.get('q') ?? '' };
    case 'settings':
      return { name: 'settings' };
    default:
      return { name: 'home' };
  }
}

export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'albums':
      return route.sort === 'newest' ? '#/albums' : `#/albums?sort=${route.sort}`;
    case 'artists':
      return '#/artists';
    case 'album':
      return `#/album/${encodeSegment(route.id)}`;
    case 'artist':
      return `#/artist/${encodeSegment(route.id)}`;
    case 'playlists':
      return '#/playlists';
    case 'playlist':
      return `#/playlist/${encodeSegment(route.id)}`;
    case 'favorites':
      return '#/favorites';
    case 'listen-later':
      return '#/listen-later';
    case 'search':
      return route.query ? `#/search?q=${encodeURIComponent(route.query)}` : '#/search';
    case 'settings':
      return '#/settings';
  }
}

/** Two routes are the same "place" when their name and params match. */
export function sameRoute(a: Route, b: Route): boolean {
  return routeToHash(a) === routeToHash(b);
}

function parseSort(value: string | null): AlbumListSort {
  switch (value) {
    case 'random':
    case 'recent':
    case 'frequent':
    case 'alphabeticalByName':
    case 'alphabeticalByArtist':
    case 'newest':
      return value;
    default:
      return 'newest';
  }
}

/** Route segments are encoded so ids containing `/` or `%` survive a round trip. */
function encodeSegment(segment: string): string {
  // `encodeURIComponent` already turns '/' into %2F, so the hash keeps a single
  // path separator per level and `parseRoute` can split safely.
  return encodeURIComponent(segment);
}

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export interface RouterOptions {
  window?: Pick<Window, 'location' | 'addEventListener' | 'removeEventListener' | 'history'> & {
    location: Location;
  };
}

export class RouterStore {
  current: Route;

  private readonly win: RouterOptions['window'];
  private readonly stack: Route[] = [];
  private listener: (() => void) | null = null;

  constructor(options: RouterOptions = {}) {
    this.win = options.window ?? (globalThis.window as RouterOptions['window']);
    this.current = $state<Route>(parseRoute(this.win?.location?.hash ?? ''));
  }

  /** Begin listening to hashchange. Returns a teardown function. */
  start(): () => void {
    const win = this.win;
    if (!win?.addEventListener) return () => {};
    const onChange = () => {
      const next = parseRoute(win.location.hash);
      if (!sameRoute(next, this.current)) {
        this.stack.push(this.current);
        this.current = next;
      }
    };
    this.listener = onChange;
    win.addEventListener('hashchange', onChange);
    return () => {
      if (this.listener && this.win?.removeEventListener) {
        this.win.removeEventListener('hashchange', this.listener);
      }
      this.listener = null;
    };
  }

  navigate(route: Route, options: { replace?: boolean } = {}): void {
    if (sameRoute(route, this.current)) return;
    const hash = routeToHash(route);
    if (!options.replace) this.stack.push(this.current);
    this.current = route;
    if (this.win?.location) this.win.location.hash = hash;
  }

  /** Go back one entry in the in-app history (used by `q`/Escape). */
  back(): boolean {
    const previous = this.stack.pop();
    if (!previous) return false;
    const hash = routeToHash(previous);
    this.current = previous;
    if (this.win?.location) this.win.location.hash = hash;
    return true;
  }

  get canGoBack(): boolean {
    return this.stack.length > 0;
  }

  reset(): void {
    this.stack.length = 0;
    this.current = parseRoute('');
  }
}
