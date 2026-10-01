/**
 * Wire types for the Subsonic API (v1.16.1), as returned with `f=json`.
 *
 * These describe exactly what the server sends. Everything the UI touches is
 * normalised into `$lib/domain/types` at this boundary, so a server quirk
 * never leaks into a component.
 */

export interface SubsonicError {
  code: number;
  message?: string;
}

export interface SubsonicResponse {
  status: 'ok' | 'failed';
  version?: string;
  type?: string;
  serverVersion?: string;
  openSubsonic?: boolean;
  error?: SubsonicError;
  [payload: string]: unknown;
}

export interface SubsonicEnvelope {
  'subsonic-response': SubsonicResponse;
}

export interface Child {
  id: string;
  parent?: string;
  isDir?: boolean;
  title?: string;
  album?: string;
  artist?: string;
  track?: number;
  discNumber?: number;
  year?: number;
  genre?: string;
  coverArt?: string;
  size?: number;
  contentType?: string;
  suffix?: string;
  duration?: number;
  bitRate?: number;
  path?: string;
  albumId?: string;
  artistId?: string;
  created?: string;
  starred?: string;
  playCount?: number;
  played?: string;
  userRating?: number;
}

export interface AlbumID3 {
  id: string;
  name: string;
  artist?: string;
  artistId?: string;
  coverArt?: string;
  songCount?: number;
  duration?: number;
  playCount?: number;
  created?: string;
  starred?: string;
  year?: number;
  genre?: string;
  song?: Child[];
}

export interface ArtistID3 {
  id: string;
  name: string;
  coverArt?: string;
  albumCount?: number;
  starred?: string;
  album?: AlbumID3[];
  artistImageUrl?: string;
}

export interface ArtistInfo2 {
  biography?: string;
  musicBrainzId?: string;
  lastFmUrl?: string;
  smallImageUrl?: string;
  mediumImageUrl?: string;
  largeImageUrl?: string;
  similarArtist?: ArtistID3[];
}

export interface Playlist {
  id: string;
  name: string;
  comment?: string;
  owner?: string;
  public?: boolean;
  songCount?: number;
  duration?: number;
  created?: string;
  changed?: string;
  coverArt?: string;
  entry?: Child[];
}

export interface ArtistsIndex {
  name?: string;
  artist?: ArtistID3[];
}

export interface AlbumListPayload {
  albumList2?: { album?: AlbumID3[] };
  albumList?: { album?: AlbumID3[] };
}

export interface ArtistsPayload {
  artists?: { ignoredArticles?: string; index?: ArtistsIndex[] };
}

export interface PlaylistsPayload {
  playlists?: { playlist?: Playlist[] };
}

export interface SearchPayload {
  searchResult3?: { artist?: ArtistID3[]; album?: AlbumID3[]; song?: Child[] };
  searchResult2?: { artist?: ArtistID3[]; album?: AlbumID3[]; song?: Child[] };
}

export interface StarredPayload {
  starred2?: { artist?: ArtistID3[]; album?: AlbumID3[]; song?: Child[] };
  starred?: { artist?: ArtistID3[]; album?: AlbumID3[]; song?: Child[] };
}

export interface SimilarSongsPayload {
  similarSongs2?: { song?: Child[] };
  similarSongs?: { song?: Child[] };
}

export interface TopSongsPayload {
  topSongs?: { song?: Child[] };
}

export interface RandomSongsPayload {
  randomSongs?: { song?: Child[] };
}
