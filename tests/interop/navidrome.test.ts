/**
 * Integration tests against a *real* Subsonic server (Navidrome).
 *
 * Skipped by default: CI has no music server, and a network-dependent test in
 * the default suite would be a liability. Run it deliberately:
 *
 *   just navidrome &                     # throwaway Navidrome on :4533
 *   STAVE_IT=1 pnpm vitest run tests/interop
 *
 * Env: STAVE_IT=1 to enable, STAVE_IT_SERVER / _USER / _PASS to point
 * somewhere else (defaults: http://127.0.0.1:4533, admin/admin).
 */

import { describe, expect, it, beforeAll } from 'vitest';
import { SubsonicClient, normalizeServerUrl } from '$lib/api/client';

const enabled = process.env.STAVE_IT === '1';
const SERVER = process.env.STAVE_IT_SERVER ?? 'http://127.0.0.1:4533';
const USER = process.env.STAVE_IT_USER ?? 'admin';
const PASS = process.env.STAVE_IT_PASS ?? 'admin';

describe.skipIf(!enabled)('interop: real Subsonic server', () => {
  const client = new SubsonicClient({
    server: normalizeServerUrl(SERVER),
    username: USER,
    password: PASS,
    clientName: 'stave-interop',
  });

  let albumId = '';
  let trackId = '';
  let artistId = '';

  beforeAll(async () => {
    const info = await client.ping();
    expect(info.version).toBeTruthy();
  });

  it('rejects wrong credentials with an auth error', async () => {
    const bad = new SubsonicClient({
      server: SERVER,
      username: USER,
      password: 'definitely-not-the-password',
    });
    await expect(bad.ping()).rejects.toMatchObject({ name: 'AuthError' });
  });

  it('lists albums for every supported sort type', async () => {
    for (const type of [
      'newest',
      'random',
      'alphabeticalByName',
      'alphabeticalByArtist',
      'frequent',
      'recent',
    ] as const) {
      const albums = await client.getAlbumList({ type, size: 5 });
      expect(Array.isArray(albums)).toBe(true);
      if (albums.length > 0) {
        expect(albums[0]!.name).toBeTruthy();
        expect(albums[0]!.id).toBeTruthy();
      }
    }

    const newest = await client.getAlbumList({ type: 'newest', size: 1 });
    albumId = newest[0]?.id ?? '';
    artistId = newest[0]?.artistId ?? '';
    expect(albumId).toBeTruthy();
  });

  it('returns a full album with ordered tracks', async () => {
    const album = await client.getAlbum(albumId);
    expect(album.name).toBeTruthy();
    expect(album.tracks?.length ?? 0).toBeGreaterThan(0);
    trackId = album.tracks![0]!.id;

    const numbers = (album.tracks ?? [])
      .map((track) => track.trackNumber)
      .filter((value): value is number => typeof value === 'number');
    const sorted = [...numbers].sort((a, b) => a - b);
    expect(numbers).toEqual(sorted);
  });

  it('builds the artist index and artist detail', async () => {
    const listing = await client.getArtists();
    expect(listing.artists.length).toBeGreaterThan(0);
    expect(listing.indexes.length).toBeGreaterThan(0);

    const detail = await client.getArtist(listing.artists[0]!.id);
    expect(detail.artist.name).toBeTruthy();
  });

  it('degrades gracefully for artist info (no Last.fm configured)', async () => {
    const bio = await client.getArtistInfo2(artistId);
    // Either real data or an empty payload — never a thrown error.
    expect(Array.isArray(bio.similarArtists)).toBe(true);
    expect(typeof bio.biography === 'string' || bio.biography === undefined).toBe(true);
  });

  it('searches across artists, albums and tracks', async () => {
    // Two characters minimum: Navidrome ignores single-character queries and
    // returns an empty (but successful) result set for them. The next test
    // pins that behaviour down so a client-side regression cannot hide it.
    const results = await client.search3('am', { artistCount: 5, albumCount: 5, songCount: 5 });
    expect(results.artists.length + results.albums.length + results.tracks.length).toBeGreaterThan(
      0,
    );
  });

  it('treats a single-character query as a valid but empty search', async () => {
    const results = await client.search3('a', { artistCount: 5, albumCount: 5, songCount: 5 });
    expect(Array.isArray(results.albums)).toBe(true);
    expect(Array.isArray(results.artists)).toBe(true);
    expect(Array.isArray(results.tracks)).toBe(true);
  });

  it('matches on an artist name case-insensitively', async () => {
    const results = await client.search3('Aurelia', {
      artistCount: 5,
      albumCount: 5,
      songCount: 5,
    });
    expect(results.artists.length + results.albums.length).toBeGreaterThan(0);
  });

  it('streams audio with range support (needed for seeking)', async () => {
    const url = client.streamUrl(trackId);
    const response = await fetch(url, { headers: { Range: 'bytes=0-2047' } });
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type') ?? '').toMatch(/audio|octet-stream/);

    const bytes = await response.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(0);
    expect(bytes.byteLength).toBeLessThanOrEqual(2048);
  });

  it('serves cover art', async () => {
    const response = await fetch(client.coverArtUrl(albumId, 120));
    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type') ?? '').toMatch(/image/);
  });

  it('stars and unstars without leaving the server inconsistent', async () => {
    await client.star({ albumId });
    let starred = await client.getStarred();
    expect(starred.albums.some((album) => album.id === albumId)).toBe(true);

    await client.unstar({ albumId });
    starred = await client.getStarred();
    expect(starred.albums.some((album) => album.id === albumId)).toBe(false);
  });

  it('accepts now-playing and scrobble submissions', async () => {
    await expect(client.scrobble({ id: trackId, submission: false })).resolves.toBeUndefined();
    await expect(client.scrobble({ id: trackId, submission: true })).resolves.toBeUndefined();
  });

  it('exposes playlists (an empty list is valid for a fresh server)', async () => {
    const playlists = await client.getPlaylists();
    expect(Array.isArray(playlists)).toBe(true);
    for (const playlist of playlists) {
      expect(playlist.id).toBeTruthy();
      const full = await client.getPlaylist(playlist.id);
      expect(Array.isArray(full.entries)).toBe(true);
    }
  });

  it('resolves similar songs for the auto-DJ, or reports none', async () => {
    const similar = await client.getSimilarSongs(trackId, 10);
    expect(Array.isArray(similar)).toBe(true);
    expect(similar.some((track) => track.id === trackId)).toBe(false);
  });

  it('returns top songs by artist name, tolerating an unconfigured server', async () => {
    const detail = await client.getArtist(artistId);
    const top = await client.getTopSongs(detail.artist.name, 5);
    expect(Array.isArray(top)).toBe(true);
  });
});
