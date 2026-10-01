/**
 * Subsonic REST endpoint names.
 *
 * The `*2` / ID3 variants are preferred: Navidrome implements them fully and
 * they return stable, well-typed payloads.
 */
export const ENDPOINTS = {
  ping: 'ping',
  getAlbumList2: 'getAlbumList2',
  getAlbum: 'getAlbum',
  getArtists: 'getArtists',
  getArtist: 'getArtist',
  getArtistInfo2: 'getArtistInfo2',
  getTopSongs: 'getTopSongs',
  getSimilarSongs2: 'getSimilarSongs2',
  getSimilarSongs: 'getSimilarSongs',
  getRandomSongs: 'getRandomSongs',
  search3: 'search3',
  getPlaylists: 'getPlaylists',
  getPlaylist: 'getPlaylist',
  getStarred2: 'getStarred2',
  star: 'star',
  unstar: 'unstar',
  scrobble: 'scrobble',
  getCoverArt: 'getCoverArt',
  stream: 'stream',
  download: 'download',
  getGenres: 'getGenres',
} as const;

export type EndpointName = (typeof ENDPOINTS)[keyof typeof ENDPOINTS];

/** `getAlbumList2` list types. */
export const ALBUM_LIST_TYPES = [
  'random',
  'newest',
  'alphabeticalByName',
  'alphabeticalByArtist',
  'frequent',
  'recent',
  'starred',
  'byYear',
  'byGenre',
] as const;

export type AlbumListType = (typeof ALBUM_LIST_TYPES)[number];

/** Subsonic error codes we branch on. */
export const SUBSONIC_ERROR = {
  GENERIC: 0,
  MISSING_PARAMETER: 10,
  CLIENT_TOO_OLD: 20,
  SERVER_TOO_OLD: 30,
  WRONG_CREDENTIALS: 40,
  TOKEN_AUTH_NOT_SUPPORTED: 41,
  LICENCE_REQUIRED: 50,
  NOT_FOUND: 70,
} as const;
