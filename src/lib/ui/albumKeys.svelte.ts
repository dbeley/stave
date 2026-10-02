/**
 * Album-list key bindings.
 *
 * One factory, used by the albums page, the home page, the artist page and the
 * search results — so an album behaves identically wherever it appears:
 *
 *   enter  open the album page        (also a click)
 *   p      play the album now         (replaces the queue)
 *   a      add to the end of the queue
 *   f      toggle favourite           (server-side star)
 *   L      toggle listen later        (local only, drives the offline cache)
 *   o      action menu (hold `n` here for "play next")
 *   y      go to the artist
 */

import type { Album } from '$lib/domain/types';
import type { Binding } from '$lib/keyboard/registry.svelte';
import type { ListCursor } from '$lib/keyboard/list.svelte';
import { actions } from '$lib/ui/actionsRegistry.svelte';

export interface AlbumKeyOptions {
  /** Defaults to opening the album page. */
  onOpen?: (album: Album) => void;
  scope?: Binding['scope'];
  group?: string;
}

export function albumListBindings(
  cursor: ListCursor,
  albums: () => Album[],
  options: AlbumKeyOptions = {},
): Binding[] {
  const scope = options.scope ?? 'page';
  const group = options.group ?? 'album';
  const current = () => cursor.selected(albums());
  const open = options.onOpen ?? ((album: Album) => actions.openAlbum(album.id));

  return [
    {
      keys: ['enter'],
      scope,
      group,
      description: 'open album',
      run: () => {
        const album = current();
        if (album) open(album);
      },
    },
    {
      keys: ['p'],
      scope,
      group,
      description: 'play album now',
      run: () => {
        const album = current();
        if (album) void actions.playAlbumNow(album);
      },
    },
    {
      keys: ['a'],
      scope,
      group,
      description: 'add album to queue',
      run: () => {
        const album = current();
        if (album) void actions.enqueueAlbum(album, 'end');
      },
    },
    {
      keys: ['f'],
      scope,
      group,
      description: 'toggle favourite',
      run: () => {
        const album = current();
        if (album) void actions.toggleAlbumFavorite(album);
      },
    },
    {
      keys: ['L'],
      scope,
      group,
      description: 'toggle listen later',
      run: () => {
        const album = current();
        if (album) actions.toggleListenLater(album);
      },
    },
    {
      keys: ['o'],
      scope,
      group,
      description: 'album actions',
      run: () => {
        const album = current();
        if (album) actions.openAlbumActions(album);
      },
    },
    {
      keys: ['y'],
      scope,
      group,
      description: 'go to artist',
      run: () => {
        const album = current();
        if (album?.artistId) actions.openArtist(album.artistId);
      },
    },
  ];
}
