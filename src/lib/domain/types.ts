/**
 * Normalised domain model.
 *
 * All server payloads are mapped into these shapes at the API boundary, so
 * views, the queue and the offline cache only ever deal with one vocabulary.
 * Field names are consistent (no `duration` meaning seconds in one place and
 * milliseconds in another) and optionality is explicit.
 */

export interface Track {
  id: string;
  title: string;
  albumId?: string;
  albumName?: string;
  artistId?: string;
  artistName?: string;
  /** 1-based position within its disc. */
  trackNumber?: number;
  discNumber?: number;
  /** Seconds. */
  durationSec: number;
  year?: number;
  genre?: string;
  /** Cover art id, falls back to the album's. */
  coverArtId?: string;
  suffix?: string;
  bitRate?: number;
  sizeBytes?: number;
  starred: boolean;
}

export interface Album {
  id: string;
  name: string;
  artistId?: string;
  artistName?: string;
  coverArtId?: string;
  songCount: number;
  durationSec: number;
  year?: number;
  genre?: string;
  createdAt?: string;
  starred: boolean;
  playCount?: number;
  /** Only populated by `getAlbum`. */
  tracks?: Track[];
}

export interface Artist {
  id: string;
  name: string;
  coverArtId?: string;
  albumCount: number;
  starred: boolean;
}

export interface ArtistBio {
  biography?: string;
  lastFmUrl?: string;
  musicBrainzId?: string;
  images: { small?: string; medium?: string; large?: string };
  similarArtists: Artist[];
}

export interface Playlist {
  id: string;
  name: string;
  comment?: string;
  owner?: string;
  songCount: number;
  durationSec: number;
  createdAt?: string;
  changedAt?: string;
  coverArtId?: string;
  /** Only populated by `getPlaylist`. */
  entries?: Track[];
}

export interface SearchResults {
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
}

export interface StarredResults {
  artists: Artist[];
  albums: Album[];
  tracks: Track[];
}

export interface ArtistAlbums {
  artist: Artist;
  albums: Album[];
}

export interface ArtistsIndex {
  /** Index letter, or '#' for symbols. */
  name: string;
  artists: Artist[];
}

export interface ArtistsListing {
  ignoredArticles: string;
  indexes: ArtistsIndex[];
  /** Flat, name-sorted list — convenient for navigation across indexes. */
  artists: Artist[];
}

export interface ServerInfo {
  version?: string;
  serverVersion?: string;
  type?: string;
  openSubsonic: boolean;
}

export function emptySearchResults(): SearchResults {
  return { artists: [], albums: [], tracks: [] };
}

export function emptyStarredResults(): StarredResults {
  return { artists: [], albums: [], tracks: [] };
}
