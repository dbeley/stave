/**
 * The shared action module encodes the product spec's behaviour, so these tests
 * are the spec: "clicking a track replaces the queue", "an album can be queued
 * at the end or right after the current track", "listen later is albums only".
 */

import { describe, expect, it, vi } from 'vitest';
// Type-only: importing the real `app` singleton here would construct every
// store (and touch localStorage) just to satisfy a type.
import type { App } from '$lib/app.svelte';
import { Actions } from '$lib/ui/actions.svelte';
import type { Album, Artist, Track } from '$lib/domain/types';

function track(id: string, albumId = 'al1'): Track {
  return { id, title: `Track ${id}`, durationSec: 10, starred: false, albumId };
}

function album(id = 'al1'): Album {
  return { id, name: `Album ${id}`, songCount: 3, durationSec: 30, starred: false };
}

function artist(id = 'ar1'): Artist {
  return { id, name: `Artist ${id}`, albumCount: 2, starred: false };
}

/** A minimal App-shaped object: only what `Actions` touches. */
function fakeApp(overrides: Record<string, unknown> = {}) {
  const app = {
    player: {
      playNow: vi.fn().mockResolvedValue(undefined),
      playAlbum: vi.fn().mockResolvedValue(undefined),
      playTracks: vi.fn().mockResolvedValue(undefined),
      enqueue: vi.fn().mockReturnValue(3),
      enqueueAlbum: vi.fn().mockResolvedValue(5),
    },
    favorites: {
      toggleAlbum: vi.fn().mockResolvedValue(true),
      toggleArtist: vi.fn().mockResolvedValue(true),
      toggleTrack: vi.fn().mockResolvedValue(true),
    },
    listenLater: {
      toggle: vi.fn().mockReturnValue(true),
      has: vi.fn().mockReturnValue(false),
    },
    settings: { state: { offlineCacheEnabled: false } },
    library: {
      invalidate: vi.fn(),
      albumDetail: vi.fn().mockReturnValue({ album: undefined }),
      artistDetail: vi.fn().mockReturnValue({ albums: [], topSongs: [] }),
      loadArtist: vi.fn().mockResolvedValue(undefined),
    },
    router: { navigate: vi.fn() },
    ui: { openActions: vi.fn() },
    toasts: { info: vi.fn(), ok: vi.fn(), warn: vi.fn(), error: vi.fn() },
    focusRequests: { search: 0 },
    focusSearch: vi.fn(function (this: { focusRequests: { search: number } }) {
      this.focusRequests.search += 1;
    }),
    requireClient: vi.fn(() => ({ getAlbum: vi.fn().mockResolvedValue(album()) })),
    ...overrides,
  };
  return { app: app as unknown as App, raw: app };
}

describe('Actions — playback contract', () => {
  it('a plain track click replaces the queue with just that track', async () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);

    await actions.playTrackNow(track('t1'));

    expect(raw.player.playNow).toHaveBeenCalledWith(track('t1'));
    expect(raw.toasts.info).toHaveBeenCalledWith(expect.stringContaining('Track t1'));
  });

  it('a track click inside a list keeps that list as the queue, starting here', async () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);
    const tracks = [track('t1'), track('t2'), track('t3')];

    await actions.playTrackNow(tracks[1]!, { tracks, index: 1, label: 'Album al1' });

    expect(raw.player.playNow).toHaveBeenCalledWith(tracks[1], { tracks, index: 1 });
    expect(raw.toasts.info).toHaveBeenCalledWith(expect.stringContaining('Album al1'));
  });

  it('a single-item context falls back to playing the track on its own', async () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);

    await actions.playTrackNow(track('t1'), { tracks: [track('t1')], index: 0 });

    expect(raw.player.playNow).toHaveBeenCalledWith(track('t1'));
  });

  it('playing an album delegates to the player', async () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);
    const subject = album();

    await actions.playAlbumNow(subject);

    expect(raw.player.playAlbum).toHaveBeenCalledWith(subject);
    expect(raw.toasts.info).toHaveBeenCalledWith(expect.stringContaining('Album al1'));
  });
});

describe('Actions — queueing contract', () => {
  it('appends a track to the end of the queue', () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);

    actions.enqueueTrack(track('t1'), 'end');

    expect(raw.player.enqueue).toHaveBeenCalledWith([expect.objectContaining({ id: 't1' })], 'end');
    expect(raw.toasts.info).toHaveBeenCalledWith(expect.stringContaining('queued'));
  });

  it('inserts a track directly after the current one', () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);

    actions.enqueueTrack(track('t1'), 'next');

    expect(raw.player.enqueue).toHaveBeenCalledWith(expect.anything(), 'next');
    expect(raw.toasts.info).toHaveBeenCalledWith(expect.stringContaining('queued next'));
  });

  it('queues a whole album in the requested position', async () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);

    await actions.enqueueAlbum(album(), 'next');

    expect(raw.player.enqueueAlbum).toHaveBeenCalledWith(expect.anything(), 'next');
    expect(raw.toasts.info).toHaveBeenCalledWith(expect.stringContaining('queued next'));
  });

  it('warns instead of claiming success when an album has no tracks', async () => {
    const { app, raw } = fakeApp();
    raw.player.enqueueAlbum.mockResolvedValue(0);
    const actions = new Actions(app);

    await actions.enqueueAlbum(album());

    expect(raw.toasts.info).toHaveBeenCalledWith(expect.stringContaining('could not load tracks'));
  });

  it('reports how many tracks were queued', () => {
    const { app, raw } = fakeApp();
    raw.player.enqueue.mockReturnValue(7);
    const actions = new Actions(app);

    const added = actions.enqueueTracks([track('t1')], 'end', 'Album al1');

    expect(added).toBe(7);
    expect(raw.toasts.info).toHaveBeenCalledWith(expect.stringContaining('7 tracks'));
  });

  it('warns when there is nothing to queue', () => {
    const { app, raw } = fakeApp();
    raw.player.enqueue.mockReturnValue(0);
    const actions = new Actions(app);

    expect(actions.enqueueTracks([], 'end')).toBe(0);
    expect(raw.toasts.warn).toHaveBeenCalledWith('nothing to queue');
  });

  it('playAlbumNext queues after the current track', async () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);

    await actions.playAlbumNext(album());

    expect(raw.player.enqueueAlbum).toHaveBeenCalledWith(expect.anything(), 'next');
  });
});

describe('Actions — favourites and listen later', () => {
  it('toggles an album favourite and drops the cached album detail', async () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);
    const subject = album();

    await actions.toggleAlbumFavorite(subject);

    expect(raw.favorites.toggleAlbum).toHaveBeenCalledWith(subject);
    expect(raw.library.invalidate).toHaveBeenCalledWith('album', 'al1');
  });

  it('toggles artist and track favourites', async () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);

    await actions.toggleArtistFavorite(artist());
    await actions.toggleTrackFavorite(track('t1'));

    expect(raw.favorites.toggleArtist).toHaveBeenCalledOnce();
    expect(raw.favorites.toggleTrack).toHaveBeenCalledOnce();
  });

  it('toggling listen later is local and reports the new state', () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);

    expect(actions.toggleListenLater(album())).toBe(true);
    expect(raw.listenLater.toggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'al1' }));
    expect(raw.toasts.info).toHaveBeenCalledWith(expect.stringContaining('listen later: +'));

    raw.listenLater.toggle.mockReturnValue(false);
    expect(actions.toggleListenLater(album())).toBe(false);
    expect(raw.toasts.info).toHaveBeenCalledWith(expect.stringContaining('listen later: −'));
  });

  it('mentions caching when the offline cache is enabled', () => {
    const { app, raw } = fakeApp({ settings: { state: { offlineCacheEnabled: true } } });
    const actions = new Actions(app);

    actions.toggleListenLater(album());

    expect(raw.toasts.info).toHaveBeenCalledWith(expect.stringContaining('caching'));
  });

  it('listen later for a track resolves its album and toggles that', async () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);

    await actions.toggleListenLaterForTrack(track('t1', 'al1'));

    expect(raw.listenLater.toggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'al1' }));
  });

  it('refuses listen later for something that has no album', async () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);
    const orphan: Track = { id: 't9', title: 'Orphan', durationSec: 5, starred: false };

    await actions.toggleListenLaterForTrack(orphan);

    expect(raw.listenLater.toggle).not.toHaveBeenCalled();
    expect(raw.toasts.warn).toHaveBeenCalledWith('listen later only applies to albums');
  });

  it('falls back to a fetch when the album detail is not cached', async () => {
    const getAlbum = vi.fn().mockResolvedValue(album('al2'));
    const { app, raw } = fakeApp({ requireClient: vi.fn(() => ({ getAlbum })) });
    const actions = new Actions(app);

    await actions.toggleListenLaterForTrack(track('t2', 'al2'));

    expect(getAlbum).toHaveBeenCalledWith('al2');
    expect(raw.listenLater.toggle).toHaveBeenCalledWith(expect.objectContaining({ id: 'al2' }));
  });
});

describe('Actions — navigation and menus', () => {
  it('opens entity pages through the router', () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);

    actions.openAlbum('al1');
    actions.openArtist('ar1');
    actions.openPlaylist('pl1');

    expect(raw.router.navigate).toHaveBeenCalledWith({ name: 'album', id: 'al1' });
    expect(raw.router.navigate).toHaveBeenCalledWith({ name: 'artist', id: 'ar1' });
    expect(raw.router.navigate).toHaveBeenCalledWith({ name: 'playlist', id: 'pl1' });
  });

  it('opening search navigates and asks for focus', () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);

    actions.openSearch('hello');

    expect(raw.router.navigate).toHaveBeenCalledWith({ name: 'search', query: 'hello' });
    expect(raw.focusRequests.search).toBe(1);
  });

  it('opens the action menu with the entity payload attached', () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);

    actions.openAlbumActions(album());
    expect(raw.ui.openActions).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'album',
        id: 'al1',
        album: expect.objectContaining({ id: 'al1' }),
      }),
    );

    actions.openTrackActions(track('t1'));
    expect(raw.ui.openActions).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'track', id: 't1' }),
    );

    actions.openArtistActions(artist());
    expect(raw.ui.openActions).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'artist',
        id: 'ar1',
        artist: expect.objectContaining({ id: 'ar1' }),
      }),
    );
  });
});

describe('Actions — playing an artist', () => {
  it('plays every track the artist page has already loaded', async () => {
    const { app, raw } = fakeApp();
    raw.library.artistDetail.mockReturnValue({
      albums: [
        { ...album('al1'), tracks: [track('t1')] },
        { ...album('al2'), tracks: [track('t2')] },
      ],
      topSongs: [],
    });
    const actions = new Actions(app);

    await actions.playArtistNow(artist());

    expect(raw.player.playTracks).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 't1' }), expect.objectContaining({ id: 't2' })],
      0,
    );
  });

  it('says so when nothing is loaded instead of failing silently', async () => {
    const { app, raw } = fakeApp();
    const actions = new Actions(app);

    await actions.playArtistNow(artist());

    expect(raw.player.playTracks).not.toHaveBeenCalled();
    expect(raw.toasts.warn).toHaveBeenCalledWith(expect.stringContaining('open an album first'));
  });
});
