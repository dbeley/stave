/**
 * Cover-art URL helper.
 *
 * Components need it, but it depends on the current connection, so it lives here
 * rather than inside a component's module script.
 */

import { app } from '$lib/app.svelte';
import { COVER_SIZE } from '$lib/config';

export type CoverSize = keyof typeof COVER_SIZE;

export function coverArtUrl(
  coverArtId: string | undefined,
  size: number = COVER_SIZE.list,
): string | undefined {
  if (!coverArtId) return undefined;
  const client = app.getClient();
  if (!client) return undefined;
  return client.coverArtUrl(coverArtId, size);
}

/** Prefer the album's art, then the track's own. */
export function coverArtIdFor(entity: {
  coverArtId?: string | undefined;
  albumId?: string | undefined;
}): string | undefined {
  if (entity.coverArtId) return entity.coverArtId;
  if (entity.albumId) return app.library.albumDetail(entity.albumId).album?.coverArtId;
  return undefined;
}
