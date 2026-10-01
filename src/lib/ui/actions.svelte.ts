/**
 * Shared item actions.
 *
 * Every surface that shows an album, artist or track routes through this module,
 * so "clicking a track replaces the queue and plays it" is implemented once and
 * cannot drift between the album page, the search results and the artist page.
 */

import type { App } from '$lib/app.svelte';
import type { Album, Artist, Track } from '$lib/domain/types';
import type { EnqueueMode } from '$lib/player/player.svelte';

export interface TrackContext {
  /** The list the clicked track belongs to (queue replacement context). */
  tracks: Track[];
  index: number;
  /** Label used in the status line, e.g. the album name. */
  label?: string;
}

export class Actions {
  constructor(private readonly app: App) {}

  // ------------------------------------------------------------- playback

  /**
   * Click on a track: the queue is replaced and playback starts at that track.
   * `context` keeps the surrounding list as the queue (album/playlist pages);
   * without it the track plays alone (search results).
   */
  async playTrackNow(track: Track, context?: TrackContext): Promise<void> {
    if (context && context.tracks.length > 1) {
      await this.app.player.playNow(track, { tracks: context.tracks, index: context.index });
      this.app.toasts.info(`playing ${context.label ?? 'selection'} from "${track.title}"`);
      return;
    }
    await this.app.player.playNow(track);
    this.app.toasts.info(`playing "${track.title}"`);
  }

  async playAlbumNow(album: Album): Promise<void> {
    const played = await this.app.player.playAlbum(album);
    if (played === 0) {
      this.app.toasts.warn(`no tracks in "${album.name}"`);
      return;
    }
    this.app.toasts.info(`playing album "${album.name}"`);
  }

  async playArtistNow(artist: Artist): Promise<void> {
    const slice = this.app.library.artistDetail(artist.id);
    if (slice.albums.length === 0) {
      await this.app.library.loadArtist(artist.id);
    }
    const albums = this.app.library.artistDetail(artist.id).albums;
    const tracks: Track[] = [];
    for (const album of albums) {
      if (album.tracks) tracks.push(...album.tracks);
    }
    if (tracks.length > 0) {
      await this.app.player.playTracks(tracks, 0);
      this.app.toasts.info(`playing ${tracks.length} tracks by ${artist.name}`);
      return;
    }
    this.app.toasts.warn(`no tracks loaded for ${artist.name} — open an album first`);
  }

  // --------------------------------------------------------------- queueing

  enqueueTrack(track: Track, mode: EnqueueMode = 'end'): void {
    this.app.player.enqueue([track], mode);
    this.app.toasts.info(
      mode === 'next' ? `queued next: "${track.title}"` : `queued: "${track.title}"`,
    );
  }

  enqueueTracks(tracks: Track[], mode: EnqueueMode = 'end', label?: string): number {
    const added = this.app.player.enqueue(tracks, mode);
    if (added > 0) {
      this.app.toasts.info(
        `${mode === 'next' ? 'queued next' : 'queued'}: ${added} ${added === 1 ? 'track' : 'tracks'}${label ? ` (${label})` : ''}`,
      );
    } else {
      this.app.toasts.warn('nothing to queue');
    }
    return added;
  }

  async enqueueAlbum(album: Album, mode: EnqueueMode = 'end'): Promise<void> {
    const added = await this.app.player.enqueueAlbum(album, mode);
    this.app.toasts.info(
      added > 0
        ? `${mode === 'next' ? 'queued next' : 'queued'}: "${album.name}" (${added} tracks)`
        : `could not load tracks for "${album.name}"`,
    );
  }

  /** Queue an album's tracks to play directly after the current one. */
  async playAlbumNext(album: Album): Promise<void> {
    await this.enqueueAlbum(album, 'next');
  }

  // ------------------------------------------------------------- favorites

  async toggleAlbumFavorite(album: Album): Promise<void> {
    await this.app.favorites.toggleAlbum(album);
    this.app.library.invalidate('album', album.id);
  }

  async toggleArtistFavorite(artist: Artist): Promise<void> {
    await this.app.favorites.toggleArtist(artist);
  }

  async toggleTrackFavorite(track: Track): Promise<void> {
    await this.app.favorites.toggleTrack(track);
  }

  // ---------------------------------------------------------- listen later

  /** Local-only, albums only — never sent to the server. */
  toggleListenLater(album: Album): boolean {
    const added = this.app.listenLater.toggle(album);
    this.app.toasts.info(
      added
        ? `listen later: +"${album.name}"${this.app.settings.state.offlineCacheEnabled ? ' (caching)' : ''}`
        : `listen later: −"${album.name}"`,
    );
    return added;
  }

  /** Toggle listen-later for the album a track belongs to. */
  async toggleListenLaterForTrack(track: Track): Promise<void> {
    const album = await this.resolveAlbumForTrack(track);
    if (!album) {
      this.app.toasts.warn('listen later only applies to albums');
      return;
    }
    this.toggleListenLater(album);
  }

  private async resolveAlbumForTrack(track: Track): Promise<Album | undefined> {
    if (!track.albumId) return undefined;
    const cached = this.app.library.albumDetail(track.albumId).album;
    if (cached) return cached;
    try {
      const album = await this.app.requireClient().getAlbum(track.albumId);
      return album;
    } catch {
      return undefined;
    }
  }

  // ------------------------------------------------------------ navigation

  openAlbum(albumId: string): void {
    this.app.router.navigate({ name: 'album', id: albumId });
  }

  openArtist(artistId: string): void {
    this.app.router.navigate({ name: 'artist', id: artistId });
  }

  openPlaylist(playlistId: string): void {
    this.app.router.navigate({ name: 'playlist', id: playlistId });
  }

  openSearch(query = ''): void {
    this.app.router.navigate({ name: 'search', query });
    this.app.focusSearch();
  }

  // ------------------------------------------------------------ act-on-item

  /** The `o` menu for an album. */
  openAlbumActions(album: Album): void {
    this.app.ui.openActions({ kind: 'album', id: album.id, title: album.name, album });
  }

  /** The `o` menu for a track. */
  openTrackActions(track: Track): void {
    this.app.ui.openActions({ kind: 'track', id: track.id, title: track.title, track });
  }

  /** The `o` menu for an artist. */
  openArtistActions(artist: Artist): void {
    this.app.ui.openActions({
      kind: 'artist',
      id: artist.id,
      title: artist.name,
      artist,
    });
  }
}

export function createActions(app: App): Actions {
  return new Actions(app);
}
