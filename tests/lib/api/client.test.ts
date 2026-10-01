import { describe, it, expect, vi } from 'vitest';
import { SubsonicClient, normalizeCredentials, normalizeServerUrl } from '$lib/api/client';
import type { SubsonicClientOptions } from '$lib/api/client';
import { ResponseCache } from '$lib/api/cache';
import {
  AuthError,
  NetworkError,
  ProtocolError,
  RequestTimeoutError,
  SubsonicError,
} from '$lib/api/errors';
import { md5 } from '$lib/api/md5';

const SALT = 'cafebabe01234567';
const PASSWORD = 'hunter2';

/** Plain stand-in for a fetch Response — avoids depending on the jsdom globals. */
interface FakeResponse {
  status: number;
  ok: boolean;
  statusText: string;
  text: () => Promise<string>;
}

function rawResponse(body: unknown, status = 200): FakeResponse {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    statusText: status === 200 ? 'OK' : `HTTP ${status}`,
    text: async () => text,
  };
}

function envelope(payload: Record<string, unknown>, status = 200): FakeResponse {
  return rawResponse(
    { 'subsonic-response': { status: 'ok', version: '1.16.1', ...payload } },
    status,
  );
}

function failure(code: number, message = 'boom'): FakeResponse {
  return rawResponse({ 'subsonic-response': { status: 'failed', error: { code, message } } });
}

function endpointOf(input: unknown): string {
  return new URL(String(input)).pathname.split('/').pop() ?? '';
}

function paramsOf(input: unknown): URLSearchParams {
  return new URL(String(input)).searchParams;
}

type Handler = (endpoint: string, url: URL) => FakeResponse;

function newClient(
  overrides: Partial<SubsonicClientOptions> = {},
  handler: Handler = () => envelope({}),
) {
  const fetchImpl = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = new URL(String(input));
    void init;
    return handler(endpointOf(input), url);
  });
  const client = new SubsonicClient({
    server: 'http://music.example.com',
    username: 'alice',
    password: PASSWORD,
    saltFactory: () => SALT,
    cache: null,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    ...overrides,
  });
  return { client, fetchImpl };
}

describe('normalizeServerUrl', () => {
  it('adds http:// when the scheme is missing', () => {
    expect(normalizeServerUrl('music.example.com')).toBe('http://music.example.com');
    expect(normalizeServerUrl('localhost:4533')).toBe('http://localhost:4533');
  });

  it('keeps an explicit scheme', () => {
    expect(normalizeServerUrl('https://music.example.com')).toBe('https://music.example.com');
    expect(normalizeServerUrl('HTTP://music.example.com')).toBe('HTTP://music.example.com');
  });

  it('trims whitespace and strips trailing slashes', () => {
    expect(normalizeServerUrl('  https://music.example.com/  ')).toBe('https://music.example.com');
    expect(normalizeServerUrl('http://x.example.com///')).toBe('http://x.example.com');
  });

  it('returns an empty string for blank input', () => {
    expect(normalizeServerUrl('')).toBe('');
    expect(normalizeServerUrl('   ')).toBe('');
  });
});

describe('normalizeCredentials', () => {
  it('normalises the server and trims the username, leaving the password alone', () => {
    expect(
      normalizeCredentials({
        server: ' music.example.com/ ',
        username: ' alice ',
        password: ' p ',
      }),
    ).toEqual({ server: 'http://music.example.com', username: 'alice', password: ' p ' });
  });
});

describe('SubsonicClient authentication', () => {
  it('sends u/t/s/v/c/f with t = md5(password + salt)', async () => {
    const { client, fetchImpl } = newClient();
    await client.ping();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [input, init] = fetchImpl.mock.calls[0]!;
    const url = new URL(String(input));
    expect(url.pathname).toBe('/rest/ping');
    expect(url.searchParams.get('u')).toBe('alice');
    expect(url.searchParams.get('t')).toBe(md5(PASSWORD + SALT));
    expect(url.searchParams.get('s')).toBe(SALT);
    expect(url.searchParams.get('v')).toBe('1.16.1');
    expect(url.searchParams.get('c')).toBe('stave');
    expect(url.searchParams.get('f')).toBe('json');
    expect(init?.headers).toEqual({ Accept: 'application/json' });
    expect(init?.signal).toBeDefined();
  });

  it('allows overriding the client name and API version', async () => {
    const { client, fetchImpl } = newClient({ clientName: 'my-client', apiVersion: '1.15.0' });
    await client.ping();
    const params = paramsOf(fetchImpl.mock.calls[0]![0]);
    expect(params.get('c')).toBe('my-client');
    expect(params.get('v')).toBe('1.15.0');
  });

  it('appends request parameters and applies the documented defaults', async () => {
    const { client, fetchImpl } = newClient();
    await client.getAlbumList({ type: 'alphabeticalByArtist', size: 5, offset: 10, genre: 'Jazz' });

    let params = paramsOf(fetchImpl.mock.calls[0]![0]);
    expect(params.get('type')).toBe('alphabeticalByArtist');
    expect(params.get('size')).toBe('5');
    expect(params.get('offset')).toBe('10');
    expect(params.get('genre')).toBe('Jazz');

    await client.getAlbumList({ type: 'newest' });
    params = paramsOf(fetchImpl.mock.calls[1]![0]);
    expect(params.get('size')).toBe('20');
    expect(params.get('offset')).toBe('0');
    expect(params.get('genre')).toBeNull();
  });

  it('omits undefined, null and empty-string parameters', async () => {
    const { client, fetchImpl } = newClient();
    await client.getAlbumList({ type: 'newest', genre: '', fromYear: undefined });
    const params = paramsOf(fetchImpl.mock.calls[0]![0]);
    expect(params.has('genre')).toBe(false);
    expect(params.has('fromYear')).toBe(false);
  });
});

describe('SubsonicClient error mapping', () => {
  it('throws AuthError for status:failed with code 40', async () => {
    const { client } = newClient({}, () => failure(40, 'Wrong username or password'));
    await expect(client.ping()).rejects.toBeInstanceOf(AuthError);
    await expect(client.ping()).rejects.toMatchObject({
      code: 40,
      message: 'Wrong username or password',
    });
  });

  it('throws AuthError for code 41 (token auth unsupported)', async () => {
    const { client } = newClient({}, () => failure(41));
    await expect(client.ping()).rejects.toBeInstanceOf(AuthError);
  });

  it('throws a plain SubsonicError for other failure codes', async () => {
    const { client } = newClient({}, () => failure(70, 'not found'));
    await expect(client.ping()).rejects.toBeInstanceOf(SubsonicError);
    await expect(client.ping()).rejects.not.toBeInstanceOf(AuthError);
    await expect(client.ping()).rejects.toMatchObject({ code: 70, message: 'not found' });
  });

  it('defaults a failure without an error object to code 0', async () => {
    const { client } = newClient({}, () =>
      rawResponse({ 'subsonic-response': { status: 'failed' } }),
    );
    await expect(client.ping()).rejects.toMatchObject({ code: 0, message: 'Subsonic error 0' });
  });

  it('throws AuthError on HTTP 401 and 403', async () => {
    const unauthorized = newClient({}, () => rawResponse('nope', 401));
    await expect(unauthorized.client.ping()).rejects.toBeInstanceOf(AuthError);

    const forbidden = newClient({}, () => rawResponse('nope', 403));
    await expect(forbidden.client.ping()).rejects.toBeInstanceOf(AuthError);
  });

  it('throws NetworkError on other non-OK HTTP statuses', async () => {
    const { client } = newClient({}, () => rawResponse('boom', 500));
    await expect(client.ping()).rejects.toBeInstanceOf(NetworkError);
    await expect(client.ping()).rejects.not.toBeInstanceOf(AuthError);
  });

  it('throws ProtocolError when the body is not JSON', async () => {
    const { client } = newClient({}, () => rawResponse('<html>not json</html>', 200));
    await expect(client.ping()).rejects.toBeInstanceOf(ProtocolError);
  });

  it('throws ProtocolError when the subsonic-response envelope is missing or malformed', async () => {
    const missing = newClient({}, () => rawResponse({}, 200));
    await expect(missing.client.ping()).rejects.toBeInstanceOf(ProtocolError);

    const malformed = newClient({}, () => rawResponse({ 'subsonic-response': 'nope' }, 200));
    await expect(malformed.client.ping()).rejects.toBeInstanceOf(ProtocolError);
  });

  it('wraps a rejected fetch in a NetworkError', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const client = new SubsonicClient({
      server: 'http://music.example.com',
      username: 'alice',
      password: PASSWORD,
      saltFactory: () => SALT,
      cache: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.ping()).rejects.toBeInstanceOf(NetworkError);
  });

  it('throws RequestTimeoutError when the request exceeds timeoutMs', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(
      (_input: unknown, init?: RequestInit) =>
        new Promise<never>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const client = new SubsonicClient({
      server: 'http://music.example.com',
      username: 'alice',
      password: PASSWORD,
      saltFactory: () => SALT,
      cache: null,
      timeoutMs: 500,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const outcome = client.ping().then(
      () => 'resolved',
      (error: unknown) => error,
    );
    await vi.advanceTimersByTimeAsync(600);
    const error = await outcome;

    expect(error).toBeInstanceOf(RequestTimeoutError);
    expect((error as RequestTimeoutError).message).toContain('500ms');
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('SubsonicClient caching', () => {
  it('serves repeated metadata calls from the cache', async () => {
    const cache = new ResponseCache();
    const { client, fetchImpl } = newClient({ cache }, () =>
      envelope({ artists: { index: [{ name: 'A', artist: [{ id: '1', name: 'Alpha' }] }] } }),
    );

    const first = await client.getArtists();
    const second = await client.getArtists();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(second.artists.map((a) => a.id)).toEqual(['1']);
  });

  it('invalidate() with no arguments clears all cached metadata', async () => {
    const cache = new ResponseCache();
    const { client, fetchImpl } = newClient({ cache }, () => envelope({ artists: {} }));

    await client.getArtists();
    client.invalidate();
    await client.getArtists();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keys cache entries by request parameters', async () => {
    const cache = new ResponseCache();
    const { client, fetchImpl } = newClient({ cache }, (endpoint, url) =>
      envelope({ albumList2: { album: [{ id: url.searchParams.get('type') ?? '', name: 'A' }] } }),
    );

    await client.getAlbumList({ type: 'newest' });
    await client.getAlbumList({ type: 'newest' });
    await client.getAlbumList({ type: 'random' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('does not cache endpoints that bypass the cache (getRandomSongs)', async () => {
    const cache = new ResponseCache();
    const { client, fetchImpl } = newClient({ cache }, () =>
      envelope({ randomSongs: { song: [] } }),
    );
    await client.getRandomSongs();
    await client.getRandomSongs();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('keeps caches for different servers/users separate', async () => {
    const cache = new ResponseCache();
    const { fetchImpl } = newClient({ cache }, () => envelope({ artists: {} }));
    const a = new SubsonicClient({
      server: 'http://a.example.com',
      username: 'alice',
      password: PASSWORD,
      saltFactory: () => SALT,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache,
    });
    const b = new SubsonicClient({
      server: 'http://b.example.com',
      username: 'alice',
      password: PASSWORD,
      saltFactory: () => SALT,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      cache,
    });
    await a.getArtists();
    await b.getArtists();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('SubsonicClient.getSimilarSongs', () => {
  it('falls back to the legacy endpoint when similarSongs2 fails', async () => {
    const seen: string[] = [];
    const { client, fetchImpl } = newClient({}, (endpoint) => {
      seen.push(endpoint);
      if (endpoint === 'getSimilarSongs2') return failure(70, 'not supported');
      return envelope({ similarSongs: { song: [{ id: 't1', title: 'Legacy' }] } });
    });

    const tracks = await client.getSimilarSongs('seed', 5);
    expect(tracks.map((t) => t.id)).toEqual(['t1']);
    expect(seen).toEqual(['getSimilarSongs2', 'getSimilarSongs']);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(paramsOf(fetchImpl.mock.calls[1]![0]).get('count')).toBe('5');
  });

  it('rethrows AuthError instead of falling back', async () => {
    const seen: string[] = [];
    const { client } = newClient({}, (endpoint) => {
      seen.push(endpoint);
      return failure(40);
    });
    await expect(client.getSimilarSongs('seed')).rejects.toBeInstanceOf(AuthError);
    expect(seen).toEqual(['getSimilarSongs2']);
  });

  it('getSimilarSongsSafe returns [] on network failure', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const client = new SubsonicClient({
      server: 'http://music.example.com',
      username: 'alice',
      password: PASSWORD,
      saltFactory: () => SALT,
      cache: null,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    await expect(client.getSimilarSongsSafe('seed')).resolves.toEqual([]);
  });

  it('getSimilarSongsSafe returns [] when both endpoints fail the protocol', async () => {
    const { client } = newClient({}, () => failure(70, 'nope'));
    await expect(client.getSimilarSongsSafe('seed')).resolves.toEqual([]);
  });
});

describe('SubsonicClient payload shapes', () => {
  it('getAlbumList accepts albumList2.album', async () => {
    const { client } = newClient({}, () =>
      envelope({ albumList2: { album: [{ id: 'a1', name: 'One' }] } }),
    );
    const albums = await client.getAlbumList({ type: 'newest' });
    expect(albums.map((a) => a.id)).toEqual(['a1']);
  });

  it('getAlbumList accepts the legacy albumList.album shape', async () => {
    const { client } = newClient({}, () =>
      envelope({ albumList: { album: [{ id: 'a2', name: 'Two' }] } }),
    );
    const albums = await client.getAlbumList({ type: 'newest' });
    expect(albums.map((a) => a.id)).toEqual(['a2']);
  });

  it('getAlbumList accepts a single album object', async () => {
    const { client } = newClient({}, () =>
      envelope({ albumList2: { album: { id: 'a3', name: 'Three' } } }),
    );
    const albums = await client.getAlbumList({ type: 'newest' });
    expect(albums.map((a) => a.id)).toEqual(['a3']);
  });

  it('getStarred accepts starred2 and the legacy starred shape', async () => {
    const modern = newClient({}, () =>
      envelope({
        starred2: { artist: [{ id: 'ar1', name: 'A' }], song: [{ id: 't1', title: 'T' }] },
      }),
    );
    const first = await modern.client.getStarred();
    expect(first.artists.map((a) => a.id)).toEqual(['ar1']);
    expect(first.tracks.map((t) => t.id)).toEqual(['t1']);

    const legacy = newClient({}, () =>
      envelope({ starred: { album: [{ id: 'al1', name: 'Al' }] } }),
    );
    const second = await legacy.client.getStarred();
    expect(second.albums.map((a) => a.id)).toEqual(['al1']);
  });

  it('getStarred returns empty lists when the payload is empty', async () => {
    const { client } = newClient({}, () => envelope({ starred2: {} }));
    await expect(client.getStarred()).resolves.toEqual({ artists: [], albums: [], tracks: [] });
  });

  it('search3 accepts searchResult3 and the legacy searchResult2', async () => {
    const modern = newClient({}, () => envelope({ searchResult3: { song: [{ id: 't1' }] } }));
    expect((await modern.client.search3('q')).tracks.map((t) => t.id)).toEqual(['t1']);

    const legacy = newClient({}, () =>
      envelope({ searchResult2: { album: [{ id: 'a1', name: 'A' }] } }),
    );
    expect((await legacy.client.search3('q')).albums.map((a) => a.id)).toEqual(['a1']);
  });
});

describe('SubsonicClient mutations and invalidation', () => {
  function mutationClient() {
    const cache = new ResponseCache();
    return newClient({ cache }, (endpoint) => {
      if (endpoint === 'getStarred2') return envelope({ starred2: {} });
      if (endpoint === 'getAlbumList2') return envelope({ albumList2: { album: [] } });
      return envelope({});
    });
  }

  it('star() invalidates getStarred2 and getAlbumList2 cache entries', async () => {
    const { client, fetchImpl } = mutationClient();
    await client.getStarred();
    await client.getAlbumList({ type: 'newest' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await client.star({ id: 't1' });
    expect(paramsOf(fetchImpl.mock.calls[2]![0]).get('id')).toBe('t1');
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    await client.getStarred();
    await client.getAlbumList({ type: 'newest' });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('unstar() invalidates getStarred2 and getAlbumList2 cache entries', async () => {
    const { client, fetchImpl } = mutationClient();
    await client.getStarred();
    await client.getAlbumList({ type: 'newest' });
    await client.unstar({ albumId: 'a1' });
    expect(paramsOf(fetchImpl.mock.calls[2]![0]).get('albumId')).toBe('a1');
    await client.getStarred();
    await client.getAlbumList({ type: 'newest' });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('star/unstar reject when given nothing to act on', async () => {
    const { client, fetchImpl } = newClient();
    await expect(client.star({})).rejects.toBeInstanceOf(SubsonicError);
    await expect(client.unstar({})).rejects.toBeInstanceOf(SubsonicError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('star() forwards artistId', async () => {
    const { client, fetchImpl } = newClient();
    await client.star({ artistId: 'ar1' });
    expect(paramsOf(fetchImpl.mock.calls[0]![0]).get('artistId')).toBe('ar1');
  });

  it('scrobble() sends id/time', async () => {
    const { client, fetchImpl } = newClient();
    await client.scrobble({ id: 't1', time: 1234 });
    const params = paramsOf(fetchImpl.mock.calls[0]![0]);
    expect(params.get('id')).toBe('t1');
    expect(params.get('time')).toBe('1234');
  });

  it('scrobble() sends submission=1 for a full submission', async () => {
    // BUG (src/lib/api/client.ts:534): buildQuery stringifies the boolean with
    // String(value), so the Subsonic `submission` parameter is sent as "true"
    // instead of "1". The task contract (and the Subsonic wire convention) is
    // 1/0; strict servers that only accept integer booleans mis-read this.
    const { client, fetchImpl } = newClient();
    await client.scrobble({ id: 't1', time: 1234 });
    expect(paramsOf(fetchImpl.mock.calls[0]![0]).get('submission')).toBe('1');
  });

  it('scrobble({ submission: false }) sends submission=0', async () => {
    // BUG (src/lib/api/client.ts:534): same root cause — sends "false", not "0".
    const { client, fetchImpl } = newClient();
    await client.scrobble({ id: 't1', time: 1234, submission: false });
    expect(paramsOf(fetchImpl.mock.calls[0]![0]).get('submission')).toBe('0');
  });

  it('scrobble() defaults the time to the current epoch seconds', async () => {
    const { client, fetchImpl } = newClient();
    await client.scrobble({ id: 't1' });
    const time = Number(paramsOf(fetchImpl.mock.calls[0]![0]).get('time'));
    expect(Math.abs(time - Math.floor(Date.now() / 1000))).toBeLessThan(5);
  });
});

describe('SubsonicClient URL builders', () => {
  it('coverArtUrl includes the id and an optional size', async () => {
    const { client } = newClient();
    const plain = new URL(client.coverArtUrl('c1'));
    expect(plain.pathname).toBe('/rest/getCoverArt');
    expect(plain.searchParams.get('id')).toBe('c1');
    expect(plain.searchParams.has('size')).toBe(false);

    const sized = new URL(client.coverArtUrl('c1', 240));
    expect(sized.searchParams.get('size')).toBe('240');
  });

  it('streamUrl includes the id and omits maxBitRate when 0 or undefined', async () => {
    const { client } = newClient();
    const plain = new URL(client.streamUrl('t1'));
    expect(plain.pathname).toBe('/rest/stream');
    expect(plain.searchParams.get('id')).toBe('t1');
    expect(plain.searchParams.has('maxBitRate')).toBe(false);

    const zero = new URL(client.streamUrl('t1', { maxBitRate: 0 }));
    expect(zero.searchParams.has('maxBitRate')).toBe(false);
  });

  it('streamUrl forwards a positive maxBitRate and a format', async () => {
    const { client } = newClient();
    const url = new URL(client.streamUrl('t1', { maxBitRate: 128, format: 'mp3' }));
    expect(url.searchParams.get('maxBitRate')).toBe('128');
    expect(url.searchParams.get('format')).toBe('mp3');
  });

  it('downloadUrl includes the id', async () => {
    const { client } = newClient();
    const url = new URL(client.downloadUrl('t1'));
    expect(url.pathname).toBe('/rest/download');
    expect(url.searchParams.get('id')).toBe('t1');
  });

  it('publicUrl resolves relative paths against the server', async () => {
    const { client } = newClient();
    expect(client.publicUrl('/rest/stream?id=1')).toBe('http://music.example.com/rest/stream?id=1');
    expect(client.publicUrl('http://cdn.example.com/x')).toBe('http://cdn.example.com/x');
  });

  it('does not issue a request for URL builders', async () => {
    const { client, fetchImpl } = newClient();
    client.coverArtUrl('c1');
    client.streamUrl('t1');
    client.downloadUrl('t1');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('SubsonicClient decoding', () => {
  it('ping() maps server info and defaults missing fields', async () => {
    const full = newClient({}, () =>
      envelope({
        version: '1.16.1',
        serverVersion: '0.52.0',
        type: 'navidrome',
        openSubsonic: true,
      }),
    );
    await expect(full.client.ping()).resolves.toEqual({
      version: '1.16.1',
      serverVersion: '0.52.0',
      type: 'navidrome',
      openSubsonic: true,
    });

    const bare = newClient({}, () => rawResponse({ 'subsonic-response': { status: 'ok' } }));
    await expect(bare.client.ping()).resolves.toEqual({
      version: undefined,
      serverVersion: undefined,
      type: undefined,
      openSubsonic: false,
    });
  });

  it('requestRaw returns the raw subsonic-response payload', async () => {
    const { client } = newClient({}, () => envelope({ hello: 1 }));
    await expect(client.requestRaw('ping')).resolves.toMatchObject({ status: 'ok', hello: 1 });
  });

  it('getAlbum maps the album and sorts its tracks', async () => {
    const { client } = newClient({}, () =>
      envelope({
        album: {
          id: 'a1',
          name: 'Album',
          song: [
            { id: 't2', title: 'Second', track: 2 },
            { id: 't1', title: 'First', track: 1 },
          ],
        },
      }),
    );
    const album = await client.getAlbum('a1');
    expect(album.name).toBe('Album');
    expect(album.tracks?.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('getAlbum throws ProtocolError when the payload has no album', async () => {
    const { client } = newClient({}, () => envelope({}));
    await expect(client.getAlbum('a1')).rejects.toBeInstanceOf(ProtocolError);
  });

  it('getArtist maps the artist and sorts albums by year descending', async () => {
    const { client } = newClient({}, () =>
      envelope({
        artist: {
          id: 'ar1',
          name: 'Artist',
          album: [
            { id: 'old', name: 'Old', year: 1999 },
            { id: 'new', name: 'New', year: 2020 },
          ],
        },
      }),
    );
    const result = await client.getArtist('ar1');
    expect(result.artist.id).toBe('ar1');
    expect(result.albums.map((a) => a.id)).toEqual(['new', 'old']);
  });

  it('getArtist throws ProtocolError when the payload has no artist', async () => {
    const { client } = newClient({}, () => envelope({}));
    await expect(client.getArtist('ar1')).rejects.toBeInstanceOf(ProtocolError);
  });

  it('getArtistInfo2 maps the biography payload', async () => {
    const { client } = newClient({}, () =>
      envelope({ artistInfo2: { biography: 'bio', similarArtist: [{ id: 'ar2', name: 'Two' }] } }),
    );
    const bio = await client.getArtistInfo2('ar1');
    expect(bio.biography).toBe('bio');
    expect(bio.similarArtists.map((a) => a.id)).toEqual(['ar2']);
  });

  it('getArtistInfo2 degrades gracefully when the server omits the payload', async () => {
    const { client } = newClient({}, () => envelope({}));
    await expect(client.getArtistInfo2('ar1')).resolves.toEqual({ images: {}, similarArtists: [] });
  });

  it('getTopSongs and getRandomSongs map song lists', async () => {
    const top = newClient({}, () => envelope({ topSongs: { song: [{ id: 't1', title: 'T' }] } }));
    expect((await top.client.getTopSongs('Artist')).map((t) => t.id)).toEqual(['t1']);

    const random = newClient({}, () =>
      envelope({ randomSongs: { song: [{ id: 't2', title: 'R' }] } }),
    );
    expect((await random.client.getRandomSongs()).map((t) => t.id)).toEqual(['t2']);
  });

  it('treats a single song object as a one-element list', async () => {
    const { client } = newClient({}, () =>
      envelope({ topSongs: { song: { id: 't1', title: 'T' } } }),
    );
    expect((await client.getTopSongs('Artist')).map((t) => t.id)).toEqual(['t1']);
  });

  it('getPlaylists maps the playlist list', async () => {
    const { client } = newClient({}, () =>
      envelope({ playlists: { playlist: [{ id: 'p1', name: 'Mix' }] } }),
    );
    expect((await client.getPlaylists()).map((p) => p.id)).toEqual(['p1']);
  });

  it('getPlaylist maps a single playlist and rejects when absent', async () => {
    const present = newClient({}, () => envelope({ playlist: { id: 'p1', name: 'Mix' } }));
    await expect(present.client.getPlaylist('p1')).resolves.toMatchObject({
      id: 'p1',
      name: 'Mix',
    });

    const absent = newClient({}, () => envelope({}));
    await expect(absent.client.getPlaylist('p1')).rejects.toBeInstanceOf(ProtocolError);
  });
});
