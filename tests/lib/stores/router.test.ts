import { describe, it, expect, vi } from 'vitest';
import {
  ROUTE_NAMES,
  RouterStore,
  parseRoute,
  routeTitle,
  routeToHash,
  sameRoute,
} from '$lib/stores/router.svelte';
import type { Route } from '$lib/stores/router.svelte';

describe('parseRoute', () => {
  const cases: ReadonlyArray<readonly [string, Route]> = [
    ['', { name: 'home' }],
    ['#', { name: 'home' }],
    ['#/', { name: 'home' }],
    ['#/albums', { name: 'albums', sort: 'newest' }],
    ['#/albums?sort=random', { name: 'albums', sort: 'random' }],
    ['#/albums?sort=recent', { name: 'albums', sort: 'recent' }],
    ['#/albums?sort=frequent', { name: 'albums', sort: 'frequent' }],
    ['#/albums?sort=alphabeticalByName', { name: 'albums', sort: 'alphabeticalByName' }],
    ['#/albums?sort=alphabeticalByArtist', { name: 'albums', sort: 'alphabeticalByArtist' }],
    ['#/albums?sort=bogus', { name: 'albums', sort: 'newest' }],
    ['#/artists', { name: 'artists' }],
    ['#/album/a1', { name: 'album', id: 'a1' }],
    ['#/artist/ar1', { name: 'artist', id: 'ar1' }],
    ['#/playlists', { name: 'playlists' }],
    ['#/playlist/p1', { name: 'playlist', id: 'p1' }],
    ['#/favorites', { name: 'favorites' }],
    ['#/listen-later', { name: 'listen-later' }],
    ['#/search', { name: 'search', query: '' }],
    ['#/search?q=hello', { name: 'search', query: 'hello' }],
    ['#/search?q=hello%20world', { name: 'search', query: 'hello world' }],
    ['#/settings', { name: 'settings' }],
  ];

  it.each(cases)('parses %j', (hash, expected) => {
    expect(parseRoute(hash)).toEqual(expected);
  });

  it('falls back to the parent list when an id is missing', () => {
    expect(parseRoute('#/album')).toEqual({ name: 'albums', sort: 'newest' });
    expect(parseRoute('#/artist')).toEqual({ name: 'artists' });
    expect(parseRoute('#/playlist')).toEqual({ name: 'playlists' });
  });

  it('routes unknown paths to home', () => {
    expect(parseRoute('#/nope')).toEqual({ name: 'home' });
    expect(parseRoute('#/nope/deeper/still')).toEqual({ name: 'home' });
  });

  it('ignores trailing and duplicate slashes', () => {
    expect(parseRoute('#/artists/')).toEqual({ name: 'artists' });
    expect(parseRoute('#//artists//')).toEqual({ name: 'artists' });
  });

  it('uses only the first two segments for an id', () => {
    expect(parseRoute('#/album/a1/extra')).toEqual({ name: 'album', id: 'a1' });
  });
});

describe('routeToHash', () => {
  it('renders each route name', () => {
    expect(routeToHash({ name: 'home' })).toBe('#/');
    expect(routeToHash({ name: 'albums', sort: 'newest' })).toBe('#/albums');
    expect(routeToHash({ name: 'albums', sort: 'random' })).toBe('#/albums?sort=random');
    expect(routeToHash({ name: 'artists' })).toBe('#/artists');
    expect(routeToHash({ name: 'album', id: 'a1' })).toBe('#/album/a1');
    expect(routeToHash({ name: 'artist', id: 'ar1' })).toBe('#/artist/ar1');
    expect(routeToHash({ name: 'playlists' })).toBe('#/playlists');
    expect(routeToHash({ name: 'playlist', id: 'p1' })).toBe('#/playlist/p1');
    expect(routeToHash({ name: 'favorites' })).toBe('#/favorites');
    expect(routeToHash({ name: 'listen-later' })).toBe('#/listen-later');
    expect(routeToHash({ name: 'search', query: '' })).toBe('#/search');
    expect(routeToHash({ name: 'search', query: 'hello world' })).toBe('#/search?q=hello%20world');
    expect(routeToHash({ name: 'settings' })).toBe('#/settings');
  });

  const allRoutes: Route[] = [
    { name: 'home' },
    { name: 'albums', sort: 'newest' },
    { name: 'albums', sort: 'random' },
    { name: 'albums', sort: 'alphabeticalByArtist' },
    { name: 'artists' },
    { name: 'album', id: 'a1' },
    { name: 'artist', id: 'ar1' },
    { name: 'playlists' },
    { name: 'playlist', id: 'p1' },
    { name: 'favorites' },
    { name: 'listen-later' },
    { name: 'search', query: 'jazz & blues' },
    { name: 'settings' },
  ];

  it.each(allRoutes)('round-trips $name', (route) => {
    expect(parseRoute(routeToHash(route))).toEqual(route);
  });

  it('round-trips an id containing a percent sign', () => {
    expect(parseRoute(routeToHash({ name: 'album', id: '50%off' }))).toEqual({
      name: 'album',
      id: '50%off',
    });
  });

  it('round-trips an id containing a slash', () => {
    // BUG (src/lib/stores/router.svelte.ts:153-155): encodeSegment double-encodes
    // a literal '/' to %252F, but decodeSegment only decodes once, so an id like
    // "disc/1" comes back as "disc%2F1". Routes with slash-bearing ids lose the
    // original id on a round trip.
    expect(parseRoute(routeToHash({ name: 'album', id: 'disc/1' }))).toEqual({
      name: 'album',
      id: 'disc/1',
    });
  });
});

describe('sameRoute', () => {
  it('is true for identical routes', () => {
    expect(sameRoute({ name: 'home' }, { name: 'home' })).toBe(true);
    expect(sameRoute({ name: 'albums', sort: 'newest' }, { name: 'albums', sort: 'newest' })).toBe(
      true,
    );
    expect(sameRoute({ name: 'album', id: 'a1' }, { name: 'album', id: 'a1' })).toBe(true);
    expect(sameRoute({ name: 'search', query: 'x' }, { name: 'search', query: 'x' })).toBe(true);
  });

  it('is false when the name or a parameter differs', () => {
    expect(sameRoute({ name: 'home' }, { name: 'artists' })).toBe(false);
    expect(sameRoute({ name: 'album', id: 'a1' }, { name: 'album', id: 'a2' })).toBe(false);
    expect(sameRoute({ name: 'search', query: 'x' }, { name: 'search', query: 'y' })).toBe(false);
    expect(sameRoute({ name: 'albums', sort: 'newest' }, { name: 'albums', sort: 'random' })).toBe(
      false,
    );
  });
});

describe('routeTitle', () => {
  it('labels the simple routes', () => {
    expect(routeTitle({ name: 'home' })).toBe('home');
    expect(routeTitle({ name: 'artists' })).toBe('artists');
    expect(routeTitle({ name: 'listen-later' })).toBe('listen later');
  });

  it('includes the sort for albums and the query for search', () => {
    expect(routeTitle({ name: 'albums', sort: 'random' })).toBe('albums (random)');
    expect(routeTitle({ name: 'search', query: 'jazz' })).toBe('search: jazz');
    expect(routeTitle({ name: 'search', query: '' })).toBe('search');
  });
});

describe('ROUTE_NAMES', () => {
  it('lists every route kind', () => {
    expect([...ROUTE_NAMES]).toEqual([
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
      'now-playing',
      'settings',
    ]);
  });
});

/** Minimal Window stand-in: hash storage plus hashchange listeners. */
function fakeWindow(initialHash = '') {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const location = { hash: initialHash };
  return {
    location,
    history: {} as History,
    addEventListener(type: string, fn: (event: Event) => void) {
      let set = listeners.get(type);
      if (!set) listeners.set(type, (set = new Set()));
      set.add(fn);
    },
    removeEventListener(type: string, fn: (event: Event) => void) {
      listeners.get(type)?.delete(fn);
    },
    dispatch(type: string) {
      for (const fn of [...(listeners.get(type) ?? [])]) fn(new Event(type));
    },
    listenerCount(type: string) {
      return listeners.get(type)?.size ?? 0;
    },
  };
}

function makeRouter(hash = '') {
  const win = fakeWindow(hash);
  const store = new RouterStore({ window: win as unknown as Window });
  return { win, store };
}

describe('RouterStore', () => {
  it('parses the initial hash on construction', () => {
    expect(makeRouter('#/albums?sort=random').store.current).toEqual({
      name: 'albums',
      sort: 'random',
    });
    expect(makeRouter().store.current).toEqual({ name: 'home' });
  });

  it('navigate() updates the route, stack and location hash', () => {
    const { win, store } = makeRouter();
    store.navigate({ name: 'album', id: 'a1' });
    expect(store.current).toEqual({ name: 'album', id: 'a1' });
    expect(win.location.hash).toBe('#/album/a1');
    expect(store.canGoBack).toBe(true);
  });

  it('navigate() to the current route is a no-op', () => {
    const { store } = makeRouter();
    store.navigate({ name: 'home' });
    expect(store.canGoBack).toBe(false);
  });

  it('navigate() with replace does not grow the history', () => {
    const { store } = makeRouter();
    store.navigate({ name: 'artists' }, { replace: true });
    expect(store.current).toEqual({ name: 'artists' });
    expect(store.canGoBack).toBe(false);
  });

  it('back() pops the stack and restores the previous route', () => {
    const { win, store } = makeRouter();
    store.navigate({ name: 'artists' });
    store.navigate({ name: 'album', id: 'a1' });
    expect(store.back()).toBe(true);
    expect(store.current).toEqual({ name: 'artists' });
    expect(win.location.hash).toBe('#/artists');
    expect(store.back()).toBe(true);
    expect(store.current).toEqual({ name: 'home' });
    expect(store.back()).toBe(false);
  });

  it('reset() clears the stack and returns home', () => {
    const { store } = makeRouter();
    store.navigate({ name: 'artists' });
    store.reset();
    expect(store.current).toEqual({ name: 'home' });
    expect(store.canGoBack).toBe(false);
  });

  it('start() follows hashchange events and the teardown stops listening', () => {
    const { win, store } = makeRouter();
    const stop = store.start();
    expect(win.listenerCount('hashchange')).toBe(1);

    win.location.hash = '#/artists';
    win.dispatch('hashchange');
    expect(store.current).toEqual({ name: 'artists' });
    expect(store.canGoBack).toBe(true);

    stop();
    expect(win.listenerCount('hashchange')).toBe(0);
    win.location.hash = '#/settings';
    win.dispatch('hashchange');
    expect(store.current).toEqual({ name: 'artists' });
  });

  it('start() ignores hashchange when the route is unchanged', () => {
    const { win, store } = makeRouter('#/artists');
    store.start();
    win.dispatch('hashchange');
    expect(store.canGoBack).toBe(false);
  });

  it('start() is a no-op without addEventListener', () => {
    const store = new RouterStore({
      window: { location: { hash: '' } } as unknown as Window,
    });
    const stop = store.start();
    expect(() => stop()).not.toThrow();
  });

  it('handles a missing window gracefully', () => {
    const store = new RouterStore({ window: undefined as never });
    expect(store.current).toEqual({ name: 'home' });
    expect(() => store.navigate({ name: 'artists' })).not.toThrow();
  });
});

describe('vi sanity for router tests', () => {
  it('exposes vi', () => {
    expect(vi.isMockFunction(vi.fn())).toBe(true);
  });
});
