import { describe, it, expect } from 'vitest';
import {
  asArray,
  byAlbumName,
  byArtistName,
  sortTracks,
  toAlbum,
  toArtist,
  toArtistBio,
  toArtistsListing,
  toPlaylist,
  toStarred,
  toTrack,
} from '$lib/api/normalize';
import type { Track } from '$lib/domain/types';

/** Minimal wire Child with only the fields under test. */
function child(over: Record<string, unknown> = {}) {
  return { id: 'x', title: 'x', ...over } as never;
}

function track(over: Partial<Track> = {}): Track {
  return { id: 'x', title: 'T', durationSec: 0, starred: false, ...over };
}

describe('asArray', () => {
  it('returns an empty array for undefined and null', () => {
    expect(asArray(undefined)).toEqual([]);
    expect(asArray(null)).toEqual([]);
  });

  it('wraps a single value in an array', () => {
    expect(asArray({ id: 'a' })).toEqual([{ id: 'a' }]);
  });

  it('passes an existing array through unchanged', () => {
    const input = [1, 2, 3];
    expect(asArray(input)).toBe(input);
  });
});

describe('toTrack', () => {
  it('maps every optional field when present', () => {
    const result = toTrack(
      child({
        id: 't1',
        title: '  Song  ',
        duration: 215.6,
        starred: '2020-01-01T00:00:00.000Z',
        albumId: 'a1',
        album: 'Album',
        artistId: 'ar1',
        artist: 'Artist',
        track: 3,
        discNumber: 2,
        year: 2020,
        genre: 'Rock',
        coverArt: 'c1',
        suffix: 'mp3',
        bitRate: 320,
        size: 12_345,
      }),
    );
    expect(result).toEqual({
      id: 't1',
      title: 'Song',
      durationSec: 216,
      starred: true,
      albumId: 'a1',
      albumName: 'Album',
      artistId: 'ar1',
      artistName: 'Artist',
      trackNumber: 3,
      discNumber: 2,
      year: 2020,
      genre: 'Rock',
      coverArtId: 'c1',
      suffix: 'mp3',
      bitRate: 320,
      sizeBytes: 12_345,
    });
  });

  it('omits optional keys that the server did not send', () => {
    const result = toTrack(child({ id: 't1', title: 'Song' }));
    expect(result).toEqual({ id: 't1', title: 'Song', durationSec: 0, starred: false });
    expect('albumId' in result).toBe(false);
    expect('year' in result).toBe(false);
    expect('coverArtId' in result).toBe(false);
  });

  it('falls back to "Untitled" for a missing or blank title', () => {
    expect(toTrack(child({ title: undefined })).title).toBe('Untitled');
    expect(toTrack(child({ title: '   ' })).title).toBe('Untitled');
  });

  it('defaults a missing duration to 0 and clamps negatives', () => {
    expect(toTrack(child()).durationSec).toBe(0);
    expect(toTrack(child({ duration: -42 })).durationSec).toBe(0);
  });

  it('makes `starred` a boolean regardless of the wire value', () => {
    expect(toTrack(child({ starred: undefined })).starred).toBe(false);
    expect(toTrack(child({ starred: '' })).starred).toBe(false);
    expect(toTrack(child({ starred: '2021-05-05' })).starred).toBe(true);
  });
});

describe('toAlbum', () => {
  it('maps fields and sorts embedded tracks', () => {
    const result = toAlbum({
      id: 'a1',
      name: '  Album  ',
      artistId: 'ar1',
      artist: 'Artist',
      coverArt: 'c1',
      songCount: 2,
      duration: 600.4,
      year: 2019,
      genre: 'Jazz',
      created: '2019-01-01',
      playCount: 4,
      starred: '2019-02-02',
      song: [
        child({ id: 't2', title: 'Second', track: 2, duration: 100 }),
        child({ id: 't1', title: 'First', track: 1, duration: 200 }),
      ],
    } as never);

    expect(result).toMatchObject({
      id: 'a1',
      name: 'Album',
      artistId: 'ar1',
      artistName: 'Artist',
      coverArtId: 'c1',
      songCount: 2,
      durationSec: 600,
      year: 2019,
      genre: 'Jazz',
      createdAt: '2019-01-01',
      playCount: 4,
      starred: true,
    });
    expect(result.tracks?.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('derives songCount from the song array when the server omits it', () => {
    const result = toAlbum({
      id: 'a1',
      name: 'Album',
      song: [child({ id: 't1' }), child({ id: 't2' })],
    } as never);
    expect(result.songCount).toBe(2);
    expect(result.tracks).toHaveLength(2);
  });

  it('keeps an explicit songCount of 0', () => {
    const result = toAlbum({ id: 'a1', name: 'Album', songCount: 0 } as never);
    expect(result.songCount).toBe(0);
  });

  it('falls back to "Untitled album" and 0 duration', () => {
    const result = toAlbum({ id: 'a1', name: '   ' } as never);
    expect(result.name).toBe('Untitled album');
    expect(result.durationSec).toBe(0);
    expect(result.tracks).toBeUndefined();
  });
});

describe('toArtist', () => {
  it('maps fields and derives albumCount from the album array', () => {
    const result = toArtist({
      id: 'ar1',
      name: '  Artist  ',
      coverArt: 'c1',
      album: [{ id: 'a1', name: 'A' }],
      starred: 'x',
    } as never);
    expect(result).toEqual({
      id: 'ar1',
      name: 'Artist',
      coverArtId: 'c1',
      albumCount: 1,
      starred: true,
    });
  });

  it('prefers an explicit albumCount and falls back to "Unknown artist"', () => {
    expect(toArtist({ id: 'ar1', name: '', albumCount: 9 } as never)).toEqual({
      id: 'ar1',
      name: 'Unknown artist',
      albumCount: 9,
      starred: false,
    });
  });
});

describe('toPlaylist', () => {
  it('maps metadata and entries', () => {
    const result = toPlaylist({
      id: 'p1',
      name: '  Mix  ',
      comment: 'best of',
      owner: 'alice',
      duration: 120.7,
      songCount: 1,
      created: '2020-01-01',
      changed: '2020-02-02',
      coverArt: 'c1',
      entry: [child({ id: 't1', title: 'Song' })],
    } as never);

    expect(result).toMatchObject({
      id: 'p1',
      name: 'Mix',
      comment: 'best of',
      owner: 'alice',
      durationSec: 121,
      songCount: 1,
      createdAt: '2020-01-01',
      changedAt: '2020-02-02',
      coverArtId: 'c1',
    });
    expect(result.entries?.map((t) => t.id)).toEqual(['t1']);
  });

  it('derives songCount from entries and applies name/duration fallbacks', () => {
    const result = toPlaylist({
      id: 'p1',
      name: ' ',
      entry: [child({ id: 't1' }), child({ id: 't2' })],
    } as never);
    expect(result.name).toBe('Untitled playlist');
    expect(result.songCount).toBe(2);
    expect(result.durationSec).toBe(0);
  });
});

describe('toArtistBio', () => {
  it('returns empty defaults for an undefined payload', () => {
    expect(toArtistBio(undefined)).toEqual({ images: {}, similarArtists: [] });
  });

  it('maps biography, links, images and similar artists', () => {
    expect(
      toArtistBio({
        biography: 'bio',
        lastFmUrl: 'https://last.fm/x',
        musicBrainzId: 'mbid',
        smallImageUrl: 's',
        mediumImageUrl: 'm',
        largeImageUrl: 'l',
        similarArtist: [{ id: 'ar2', name: 'Other' }],
      } as never),
    ).toEqual({
      biography: 'bio',
      lastFmUrl: 'https://last.fm/x',
      musicBrainzId: 'mbid',
      images: { small: 's', medium: 'm', large: 'l' },
      similarArtists: [{ id: 'ar2', name: 'Other', albumCount: 0, starred: false }],
    });
  });

  it('accepts a single similar artist object', () => {
    const bio = toArtistBio({ similarArtist: { id: 'ar2', name: 'One' } } as never);
    expect(bio.similarArtists.map((a) => a.id)).toEqual(['ar2']);
  });
});

describe('toStarred', () => {
  it('returns empty lists when the payload is empty', () => {
    expect(toStarred({})).toEqual({ artists: [], albums: [], tracks: [] });
    expect(toStarred({ artist: undefined, album: null, song: undefined } as never)).toEqual({
      artists: [],
      albums: [],
      tracks: [],
    });
  });

  it('maps each section, accepting a single object in place of an array', () => {
    const result = toStarred({
      artist: { id: 'ar1', name: 'Artist' },
      album: { id: 'a1', name: 'Album' },
      song: child({ id: 't1', title: 'Song' }),
    } as never);
    expect(result.artists.map((a) => a.id)).toEqual(['ar1']);
    expect(result.albums.map((a) => a.id)).toEqual(['a1']);
    expect(result.tracks.map((t) => t.id)).toEqual(['t1']);
  });
});

describe('toArtistsListing', () => {
  it('derives a flat list from the index and sorts it, keeping the server index order', () => {
    const listing = toArtistsListing({
      ignoredArticles: 'The ',
      index: [
        { name: 'z', artist: [{ id: 'z', name: 'Zappa' }] },
        {
          name: 'a',
          artist: [
            { id: 'a', name: 'alpha' },
            { id: 'b', name: 'Beta' },
          ],
        },
      ],
    } as never);

    expect(listing.ignoredArticles).toBe('The ');
    // Server index order (z then a) is preserved...
    expect(listing.indexes.map((i) => i.name)).toEqual(['z', 'a']);
    // ...but each index's artists and the flat list are name-sorted.
    expect(listing.indexes[1]?.artists.map((a) => a.id)).toEqual(['a', 'b']);
    expect(listing.artists.map((a) => a.name)).toEqual(['alpha', 'Beta', 'Zappa']);
  });

  it('buckets index entries with no name under #', () => {
    const listing = toArtistsListing({
      index: [
        { name: '   ', artist: [{ id: '1', name: '%Symbol' }] },
        { name: undefined, artist: [{ id: '2', name: '3 Doors' }] },
      ],
    } as never);
    expect(listing.indexes.map((i) => i.name)).toEqual(['#', '#']);
    expect(listing.indexes[0]?.artists.map((a) => a.id)).toEqual(['1']);
  });

  it('deduplicates artists that appear in more than one index', () => {
    const listing = toArtistsListing({
      index: [
        { name: 'A', artist: [{ id: '1', name: 'Alpha' }] },
        {
          name: 'A',
          artist: [
            { id: '1', name: 'Alpha' },
            { id: '2', name: 'Amber' },
          ],
        },
      ],
    } as never);
    expect(listing.artists.map((a) => a.id)).toEqual(['1', '2']);
  });

  it('returns an empty listing when there is no index', () => {
    // NOTE: `toArtistsListing` only reads `payload.index`; there is no separate
    // flat-artist source, so the documented "rebuild indexes when the server
    // omits index" path (buildIndexesFrom) is unreachable — flat is always [].
    const listing = toArtistsListing({});
    expect(listing).toEqual({ ignoredArticles: '', indexes: [], artists: [] });
  });

  it('defaults ignoredArticles to an empty string', () => {
    const listing = toArtistsListing({
      index: [{ name: 'A', artist: [{ id: '1', name: 'Alpha' }] }],
    } as never);
    expect(listing.ignoredArticles).toBe('');
  });
});

describe('sortTracks', () => {
  it('orders by disc, then track, with unknown positions last', () => {
    const input = [
      track({ id: 'disc2', discNumber: 2, trackNumber: 1 }),
      track({ id: 'disc1-track2', discNumber: 1, trackNumber: 2 }),
      track({ id: 'disc1-track1', discNumber: 1, trackNumber: 1 }),
      track({ id: 'disc1-unknown', discNumber: 1 }),
      track({ id: 'noDisc-track5', trackNumber: 5 }),
    ];
    expect(sortTracks(input).map((t) => t.id)).toEqual([
      'disc1-track1',
      'disc1-track2',
      'noDisc-track5',
      'disc1-unknown',
      'disc2',
    ]);
  });

  it('treats a missing discNumber as disc 1', () => {
    const sorted = sortTracks([
      track({ id: 'disc2', discNumber: 2, trackNumber: 1 }),
      track({ id: 'implicitDisc', trackNumber: 1 }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['implicitDisc', 'disc2']);
  });

  it('breaks ties on title, case-insensitively', () => {
    const sorted = sortTracks([
      track({ id: 'z', trackNumber: 1, title: 'Zed' }),
      track({ id: 'a', trackNumber: 1, title: 'apple' }),
    ]);
    expect(sorted.map((t) => t.id)).toEqual(['a', 'z']);
  });

  it('does not mutate the input array', () => {
    const input = [track({ id: 'b', trackNumber: 2 }), track({ id: 'a', trackNumber: 1 })];
    const copy = input.slice();
    sortTracks(input);
    expect(input).toEqual(copy);
  });

  it('handles an empty list', () => {
    expect(sortTracks([])).toEqual([]);
  });
});

describe('name comparators', () => {
  it('byArtistName compares case-insensitively', () => {
    expect(byArtistName({ name: 'alpha' } as never, { name: 'Beta' } as never)).toBeLessThan(0);
  });

  it('byAlbumName compares case-insensitively', () => {
    expect(byAlbumName({ name: 'Zed' } as never, { name: 'apple' } as never)).toBeGreaterThan(0);
  });
});
