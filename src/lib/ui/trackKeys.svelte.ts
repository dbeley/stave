/**
 * Track-list key bindings.
 *
 *   enter  play now — the queue is replaced by the surrounding list, starting
 *          at this track (the behaviour the spec asks for)
 *   a      add to the end of the queue
 *   f      toggle favourite
 *   L      listen later for the track's album (albums only, local)
 *   o      action menu (hold `n` here for "play next")
 *   y      go to the artist
 */

import type { Track } from '$lib/domain/types';
import type { ListCursor } from '$lib/keyboard/list.svelte';
import type { Binding } from '$lib/keyboard/registry.svelte';
import { actions } from '$lib/ui/actionsRegistry.svelte';
import type { TrackContext } from '$lib/ui/actions.svelte';

export interface TrackKeyOptions {
  /** Overrides the default "replace the queue with this list" behaviour. */
  context?: () => TrackContext | undefined;
  onActivate?: (track: Track, index: number) => void;
  scope?: Binding['scope'];
  group?: string;
}

export function trackListBindings(
  cursor: ListCursor,
  tracks: () => Track[],
  options: TrackKeyOptions = {},
): Binding[] {
  const scope = options.scope ?? 'page';
  const group = options.group ?? 'track';
  const current = () => cursor.selected(tracks());

  const activate = (track: Track | undefined, index: number) => {
    if (!track) return;
    if (options.onActivate) {
      options.onActivate(track, index);
      return;
    }
    const context = options.context?.();
    void actions.playTrackNow(track, context);
  };

  return [
    {
      keys: ['enter'],
      scope,
      group,
      description: 'play now (replaces queue)',
      run: () => activate(current(), cursor.index),
    },
    {
      keys: ['a'],
      scope,
      group,
      description: 'add to queue',
      run: () => {
        const track = current();
        if (track) actions.enqueueTrack(track, 'end');
      },
    },
    {
      keys: ['f'],
      scope,
      group,
      description: 'toggle favourite',
      run: () => {
        const track = current();
        if (track) void actions.toggleTrackFavorite(track);
      },
    },
    {
      keys: ['L'],
      scope,
      group,
      description: 'listen later (album)',
      run: () => {
        const track = current();
        if (track) void actions.toggleListenLaterForTrack(track);
      },
    },
    {
      keys: ['o'],
      scope,
      group,
      description: 'track actions',
      run: () => {
        const track = current();
        if (track) actions.openTrackActions(track);
      },
    },
    {
      keys: ['y'],
      scope,
      group,
      description: 'go to artist',
      run: () => {
        const track = current();
        if (track?.artistId) actions.openArtist(track.artistId);
      },
    },
  ];
}
