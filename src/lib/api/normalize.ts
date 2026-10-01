/**
 * Wire payload -> domain model mappers.
 *
 * Kept pure and side-effect free so every quirk (missing duration, absent
 * coverArt, single-item arrays arriving as objects) is covered by unit tests
 * instead of defensive checks scattered through the UI.
 */

import type {
  Album,
  Artist,
  ArtistBio,
  ArtistsIndex,
  ArtistsListing,
  Playlist,
  StarredResults,
  Track,
} from '$lib/domain/types';
import type { AlbumID3, ArtistID3, ArtistInfo2, Child, Playlist as WirePlaylist } from './types';

/** Subsonic sometimes sends a bare object where an array is expected. */
export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function toTrack(child: Child): Track {
  const track: Track = {
    id: child.id,
    title: child.title?.trim() || 'Untitled',
    durationSec: Math.max(0, Math.round(child.duration ?? 0)),
    starred: Boolean(child.starred),
  };

  if (child.albumId) track.albumId = child.albumId;
  if (child.album) track.albumName = child.album;
  if (child.artistId) track.artistId = child.artistId;
  if (child.artist) track.artistName = child.artist;
  if (typeof child.track === 'number') track.trackNumber = child.track;
  if (typeof child.discNumber === 'number') track.discNumber = child.discNumber;
  if (typeof child.year === 'number') track.year = child.year;
  if (child.genre) track.genre = child.genre;
  if (child.coverArt) track.coverArtId = child.coverArt;
  if (child.suffix) track.suffix = child.suffix;
  if (typeof child.bitRate === 'number') track.bitRate = child.bitRate;
  if (typeof child.size === 'number') track.sizeBytes = child.size;

  return track;
}

export function toAlbum(album: AlbumID3): Album {
  const mapped: Album = {
    id: album.id,
    name: album.name?.trim() || 'Untitled album',
    songCount: album.songCount ?? asArray(album.song).length,
    durationSec: Math.max(0, Math.round(album.duration ?? 0)),
    starred: Boolean(album.starred),
  };

  if (album.artistId) mapped.artistId = album.artistId;
  if (album.artist) mapped.artistName = album.artist;
  if (album.coverArt) mapped.coverArtId = album.coverArt;
  if (typeof album.year === 'number') mapped.year = album.year;
  if (album.genre) mapped.genre = album.genre;
  if (album.created) mapped.createdAt = album.created;
  if (typeof album.playCount === 'number') mapped.playCount = album.playCount;
  if (album.song) mapped.tracks = sortTracks(album.song.map(toTrack));

  return mapped;
}

export function toArtist(artist: ArtistID3): Artist {
  const mapped: Artist = {
    id: artist.id,
    name: artist.name?.trim() || 'Unknown artist',
    albumCount: artist.albumCount ?? asArray(artist.album).length,
    starred: Boolean(artist.starred),
  };
  if (artist.coverArt) mapped.coverArtId = artist.coverArt;
  return mapped;
}

export function toPlaylist(playlist: WirePlaylist): Playlist {
  const mapped: Playlist = {
    id: playlist.id,
    name: playlist.name?.trim() || 'Untitled playlist',
    songCount: playlist.songCount ?? asArray(playlist.entry).length,
    durationSec: Math.max(0, Math.round(playlist.duration ?? 0)),
  };

  if (playlist.comment) mapped.comment = playlist.comment;
  if (playlist.owner) mapped.owner = playlist.owner;
  if (playlist.created) mapped.createdAt = playlist.created;
  if (playlist.changed) mapped.changedAt = playlist.changed;
  if (playlist.coverArt) mapped.coverArtId = playlist.coverArt;
  if (playlist.entry) mapped.entries = playlist.entry.map(toTrack);

  return mapped;
}

export function toArtistBio(info: ArtistInfo2 | undefined): ArtistBio {
  const bio: ArtistBio = {
    images: {},
    similarArtists: asArray(info?.similarArtist).map(toArtist),
  };

  if (info?.biography) bio.biography = info.biography;
  if (info?.lastFmUrl) bio.lastFmUrl = info.lastFmUrl;
  if (info?.musicBrainzId) bio.musicBrainzId = info.musicBrainzId;
  if (info?.smallImageUrl) bio.images.small = info.smallImageUrl;
  if (info?.mediumImageUrl) bio.images.medium = info.mediumImageUrl;
  if (info?.largeImageUrl) bio.images.large = info.largeImageUrl;

  return bio;
}

export function toStarred(payload: {
  artist?: ArtistID3 | ArtistID3[];
  album?: AlbumID3 | AlbumID3[];
  song?: Child | Child[];
}): StarredResults {
  return {
    artists: asArray(payload.artist).map(toArtist),
    albums: asArray(payload.album).map(toAlbum),
    tracks: asArray(payload.song).map(toTrack),
  };
}

/**
 * Build the browsable artist index.
 *
 * Accepts either shape a server might send: A-Z buckets (`index[]`, what
 * Navidrome and the spec use), or a flat artist array. In both cases the flat,
 * name-sorted list is derived here, and the buckets are rebuilt when the server
 * did not supply them — so the UI always has something to render.
 */
export function toArtistsListing(payload: {
  ignoredArticles?: string;
  index?: { name?: string; artist?: ArtistID3 | ArtistID3[] }[];
  /**
   * Some servers (and hand-written fixtures) return a flat artist array with no
   * A-Z buckets. Accepting it is what makes the index rebuild below reachable
   * rather than dead code.
   */
  artist?: ArtistID3 | ArtistID3[];
}): ArtistsListing {
  const flat: Artist[] = [];
  const seen = new Set<string>();
  const fromPayload: ArtistsIndex[] = [];

  for (const index of asArray(payload.index)) {
    const artists = asArray(index.artist).map(toArtist).sort(byArtistName);
    for (const artist of artists) {
      if (seen.has(artist.id)) continue;
      seen.add(artist.id);
      flat.push(artist);
    }
    fromPayload.push({ name: index.name?.trim() || '#', artists });
  }

  // Flat form: no buckets supplied, so collect the artists and let the rebuild
  // below produce the A-Z index.
  for (const artist of asArray(payload.artist)) {
    if (seen.has(artist.id)) continue;
    seen.add(artist.id);
    flat.push(toArtist(artist));
  }

  flat.sort(byArtistName);

  const indexes: ArtistsIndex[] = fromPayload.length ? fromPayload : buildIndexesFrom(flat);

  return {
    ignoredArticles: payload.ignoredArticles ?? '',
    indexes,
    artists: flat,
  };
}

function buildIndexesFrom(artists: Artist[]): ArtistsIndex[] {
  const buckets = new Map<string, Artist[]>();
  for (const artist of artists) {
    const letter = indexLetterFor(artist.name);
    const bucket = buckets.get(letter);
    if (bucket) bucket.push(artist);
    else buckets.set(letter, [artist]);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => compareIndexLetters(a, b))
    .map(([name, list]) => ({ name, artists: list }));
}

function indexLetterFor(name: string): string {
  const first = name.trim().charAt(0).toUpperCase();
  return /[A-Z]/.test(first) ? first : '#';
}

function compareIndexLetters(a: string, b: string): number {
  if (a === b) return 0;
  if (a === '#') return 1;
  if (b === '#') return -1;
  return a.localeCompare(b);
}

export function byArtistName(a: Artist, b: Artist): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

export function byAlbumName(a: Album, b: Album): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/** Disc then track order; unknown positions sort last but stay stable. */
export function sortTracks(tracks: Track[]): Track[] {
  return [...tracks].sort((a, b) => {
    const disc = (a.discNumber ?? 1) - (b.discNumber ?? 1);
    if (disc !== 0) return disc;
    const an = a.trackNumber ?? Number.MAX_SAFE_INTEGER;
    const bn = b.trackNumber ?? Number.MAX_SAFE_INTEGER;
    if (an !== bn) return an - bn;
    return a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
  });
}
