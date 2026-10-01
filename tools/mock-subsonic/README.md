# mock-subsonic

A **zero-dependency** mock [Subsonic](https://www.subsonic.org/pages/api.jsp) /
Navidrome server for developing and end-to-end testing
[stave](../../) without a real server.

It scans a real music library from disk — parsing **ID3v2 tags from MP3** and
**Vorbis comments from FLAC** (plus embedded cover art), computing durations
from MPEG frames / FLAC STREAMINFO — and serves the subset of the Subsonic REST
API **v1.16.1** the app uses. No npm packages, no `ffprobe`, no external
runtime: just `node`.

## Quick start

```sh
# 1. generate the demo library (once)
nix shell nixpkgs#ffmpeg -c bash scripts/seed-library.sh testdata/music

# 2. run the mock server
node tools/mock-subsonic/server.mjs --music testdata/music --port 4534
# or through the flake:  nix run .#mock-server -- --music testdata/music --port 4534
```

```
mock-subsonic listening on http://127.0.0.1:4534
music:   /…/testdata/music (43 tracks, 9 albums, 6 artists)
auth:    admin / admin (token md5)
```

Default credentials are **`admin` / `admin`** (same as
`scripts/dev-navidrome.sh`). Point stave's server field at
`http://localhost:4534`.

Smoke test:

```sh
curl 'http://127.0.0.1:4534/rest/ping?u=admin&t=x&s=y&v=1.16.1&c=curl&f=json'
```

## CLI flags

| Flag | Env | Default | Meaning |
| --- | --- | --- | --- |
| `-m, --music <dir>` | `MOCK_MUSIC` | `testdata/music` | Library root (scanned recursively) |
| `-p, --port <n>` | `MOCK_PORT` | `4534` | Listen port |
| `--host <addr>` | `MOCK_HOST` | `127.0.0.1` | Listen address |
| `-u, --user <name>` | `MOCK_USER` | `admin` | Accepted username |
| `-w, --password <pass>` | `MOCK_PASSWORD` | `admin` | Accepted password |
| `--state <file>` | `MOCK_STATE_FILE` | *(memory only)* | Persist stars / play counts as JSON |
| `--seed <n>` | `MOCK_SEED` | `1337` | PRNG seed for `random` lists |
| `--no-auth` | — | off | Accept any credentials |
| `--no-playlists` | `MOCK_PLAYLISTS=0` | off | Return no playlists |
| `--quiet` / `--verbose` | — | off | Request logging off / per-request + auth + stream logs |
| `-h, --help` | — | — | Usage |

`MOCK_ARTWORK=0` omits all `coverArt` ids; `MOCK_EMPTY=1` serves a valid but
empty library; `MOCK_OPENSUBSONIC=0` sets `openSubsonic:false`;
`MOCK_VERSION` / `MOCK_SERVER_VERSION` / `MOCK_TYPE` override the envelope
metadata (`type` defaults to `navidrome`).

## Endpoints

Routes accept `/rest/<name>`, `/rest/<name>.view`, and bare `/<name>`; unknown
endpoints return HTTP 404 with Subsonic error 70. `GET` and `HEAD` are
supported (HEAD returns headers, no body).

| Endpoint | Notes |
| --- | --- |
| `ping` | version, type, serverVersion, openSubsonic |
| `getAlbumList2` | `random`, `newest`, `alphabeticalByName`, `alphabeticalByArtist`, `frequent`, `recent`, `starred`, `byYear`, `byGenre`; `size`/`offset` |
| `getAlbum` | full album incl. `song[]` |
| `getArtists` | index buckets by initial letter |
| `getArtist` | artist + `album[]` |
| `getArtistInfo2` | generated biography + `similarArtist` (no image URLs) |
| `getTopSongs` | by artist name, play-count ordered |
| `getSimilarSongs` / `getSimilarSongs2` | genre/artist/album affinity + deterministic tie-break |
| `getRandomSongs` | `size`, `genre`, `fromYear`, `toYear` |
| `search3` | case-insensitive over title/artist/album; `*` matches all |
| `getPlaylists` / `getPlaylist` | 4 synthesised playlists (see below) |
| `getStarred2`, `star`, `unstar` | in-memory (persist with `--state`) |
| `scrobble` | `submission=false` is a no-op; `true` bumps play count |
| `getCoverArt` | album `folder.png` / embedded picture; `size` accepted but ignored |
| `stream` / `download` | raw file bytes, `Accept-Ranges`/`206` range support, correct `Content-Type` |
| `getGenres` | genre value + song/album counts |

Authentication supports the token scheme `t = md5(password + salt)` (with
`s`, `u`) **and** the legacy `p=<plain>` / `p=enc:<hex>` forms. Failures return
Subsonic error 40 (or 10 when credentials are absent); the client's 401/403
path is exercised with `MOCK_HTTP_STATUS`.

## Fault injection

Every fault is **env-driven**. Endpoint lists are comma/space separated; an
empty/absent list means *all* endpoints apply; `*` is a wildcard. Endpoint names
are matched case-insensitively against the route name (e.g. `getAlbum`,
`stream`).

| Variable | Effect |
| --- | --- |
| `MOCK_FAIL_ENDPOINTS` | Return a `status:failed` Subsonic error for these endpoints |
| `MOCK_FAIL_CODE`, `MOCK_FAIL_MESSAGE` | Error code (default `0`) and message used above / for HTTP status |
| `MOCK_FAIL_FIRST_N` | Fail the first *N* API requests, then succeed (retry/backoff tests) |
| `MOCK_HTTP_STATUS` | Force an HTTP status (e.g. `500`, `503`, `401`) |
| `MOCK_HTTP_STATUS_ENDPOINTS` | Which endpoints get that status |
| `MOCK_MALFORMED_ENDPOINTS` | Return `text/html` instead of JSON (triggers `ProtocolError`) |
| `MOCK_LATENCY_MS` | Delay every matching response by N ms |
| `MOCK_LATENCY_ENDPOINTS` | Which endpoints are delayed |
| `MOCK_HANG_ENDPOINTS` | Accept the request and never respond (client timeout) |
| `MOCK_HANG_MS` | If `>0`, respond after N ms instead of hanging forever |
| `MOCK_DROP_ENDPOINTS` | Destroy the socket mid-request (connection reset) |
| `MOCK_REJECT_AUTH` | Force Subsonic error 40 on every endpoint |
| `MOCK_EMPTY` | Serve an empty (but well-formed) library |
| `MOCK_STREAM_GARBAGE` | `stream`/`download` return `text/plain` non-audio |
| `MOCK_TRUNCATE_STREAM_BYTES` | Send only the first N bytes of audio |

Example — a server that is slow, fails `getCoverArt`, and 503s `stream`:

```sh
MOCK_LATENCY_MS=250 \
MOCK_FAIL_ENDPOINTS=getCoverArt MOCK_FAIL_CODE=0 MOCK_FAIL_MESSAGE="no art today" \
MOCK_HTTP_STATUS=503 MOCK_HTTP_STATUS_ENDPOINTS=stream \
node tools/mock-subsonic/server.mjs --music testdata/music --port 4534
```

### Per-request overrides (dev extension)

For tests that can't restart the server, these query params override the
matching env var **for one request** (real servers ignore them, so only use them
against the mock): `mock_fail=1`, `mock_error_code`, `mock_error_message`,
`mock_http_status`, `mock_malformed=1`, `mock_empty=1`, `mock_latency_ms`,
`mock_drop=1`, `mock_hang=1`, `mock_truncate=<bytes>`.

## Fidelity notes / limitations

- **No transcoding.** `stream` ignores `format` and `maxBitRate` and serves the
  original file (correct `Content-Type` and range support, so `<audio>` seeking
  works).
- **`getCoverArt` ignores `size`** — the full image is returned for every size.
- **No Last.fm.** `getArtistInfo2` returns a generated biography and similar
  artists, without external image URLs.
- **Synthesised playlists** (`Mock: Recently Added`, `Mock: Ambient Focus`,
  `Mock: Jazz Night`, `Mock: Everything`) so the playlist UI has data; disable
  with `--no-playlists` (a fresh Navidrome has none).
- **Search is more permissive than Navidrome.** This server matches
  single-character queries; Navidrome 0.64 requires at least two characters and
  returns an empty result set for `query=a`. Tests that must behave identically
  against both should use a two-character query (see
  `tests/interop/navidrome.test.ts`).
- **`created` timestamps are derived from tag year**, so `newest`/`recent`
  ordering is meaningful without waiting for file mtimes.
- **Tracks with no album tag** are grouped into an album named after their
  folder (e.g. `Loose Tracks`); such albums with no `folder.png`/embedded art
  have no `coverArt` id, and `getCoverArt` returns error 70.
- **`random` output is deterministic** per seed (and per call counter), rather
  than truly random, for reproducible tests.
- The demo library produced by `scripts/seed-library.sh` currently gives every
  album track the same title (`lattice nocturne`) because of a subshell/seed
  quirk in that script — search by *artist* and *album* still exercises the
  full path; fix belongs in the seed script, not here.

## Programmatic use

```js
import { buildLibrary, startServer } from './tools/mock-subsonic/server.mjs';

const { server, library } = startServer({ music: 'testdata/music', port: 4534, auth: false });
// …library.tracks / library.albums / library.artists are plain objects
```

The tag parsers (`parseId3v2`, `parseFlac`, `mp3Duration`, `tagsFromId3`) are
exported too and can be unit-tested directly.
