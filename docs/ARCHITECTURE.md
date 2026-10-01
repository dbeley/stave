# Architecture

## The shape of it

```
                 ┌──────────────────────────────────────────────┐
  pages/         │ Home  Albums  Album  Artists  Artist  Search │
  components/    │ Panel ListView rows overlays StatusBar …     │
                 └───────────────┬──────────────────────────────┘
                                 │ reads state, calls actions
                 ┌───────────────▼──────────────────────────────┐
  ui/            │ actions.svelte.ts — one place that encodes   │
                 │ "what clicking an album/track does"          │
                 └───────────────┬──────────────────────────────┘
                                 │
  stores/        ┌──────────────▼───────────────┐   player/
  (runes)        │ settings credentials router  │   player.svelte.ts
                 │ queue library favorites      │   autodj.ts
                 │ listenLater search ui toast  │   mediaSession.ts
                 └──────────────┬───────────────┘
                                │
  offline/       ┌─────────────▼────────────────┐
                 │ db  blobStore  downloads     │
                 │ resolve (cache-aware URLs)   │
                 └─────────────┬────────────────┘
                               │
  api/           ┌────────────▼─────────────────┐
                 │ client.ts  (token auth,      │
                 │ typed errors, cache)         │
                 │ normalize.ts → domain/       │
                 └──────────────────────────────┘
```

`app.svelte.ts` is the composition root: it constructs every store and wires the
dependency arrows explicitly. Components import the `app` singleton; nothing
reaches into a hidden global.

## Why the layers exist

**`api/` vs `domain/`** — the wire format is not the app's vocabulary. Subsonic
sends `duration` in seconds, sometimes omits `songCount`, returns a bare object
where an array is expected, and has two spellings of most endpoints. All of that
is absorbed in `normalize.ts` (pure functions, heavily unit tested) so no
component ever writes a defensive check. Every store and page deals only with
`Album`, `Artist`, `Track`, `Playlist` from `domain/types.ts`.

**Injected dependencies.** The client takes a `fetch`, a clock and a cache; the
player takes an `AudioPort`, a URL resolver and client accessors; the download
manager takes a blob store and a scheduler. That is why playback, the auto-DJ,
the offline cache and the keyboard can be tested without a browser, a server or
a network.

**One action module.** "Playing a track replaces the queue", "adding an album
queues its tracks", "listen later is albums only" are requirements that would
otherwise be re-implemented in every page. They live once, in
`ui/actions.svelte.ts`, and every surface calls them — including the action menu.

**One binding table.** `keyboard/registry.svelte.ts` holds bindings that carry their own
description and group. The router executes them, the hint bar renders the ones
marked `hint`, and the help overlay renders all of them. A shortcut cannot exist
without being documented because they are the same record.

## State: runes, not stores

All app state is Svelte 5 runes inside `.svelte.ts` classes
(`$state`/`$derived`), not `svelte/store` writables. Two reasons: a class can be
instantiated per test (`new QueueStore({ persist: false })`) instead of leaking
module-level singletons, and `.svelte.ts` modules compile under vitest, so the
store logic is testable without mounting a component.

Rules that the code follows:

- state is written through methods, never by reaching into a store's fields from
  a component (the fields are public for reading only by convention);
- collections that hold _behaviour_ (the keyboard binding registry) use
  `$state.raw`, not `$state`: deep proxying replaces every element with a proxy,
  which silently breaks identity — and identity is what `unregister()` and the
  overlay checks rely on. Data collections (queue items, albums) use plain
  `$state`, and are compared by `id` rather than by reference;
- anything persisted goes through `utils/persist.ts`, which wraps values in a
  `{v, data}` envelope so the schema can be migrated, and which **deep-copies
  through JSON** — Svelte 5 `$state` proxies throw `DataCloneError` in
  IndexedDB and serialise oddly elsewhere;
- `<html>` gets `data-theme` / `data-accent` / `data-crt` from one `$effect` in
  `App.svelte`, and all colour lives in CSS custom properties in `app.css`.

## Sequence: mounting, connecting and loading

The shell (and the page it is showing) mounts _before_ the first successful
connection, because the login overlay is part of the same tree. A page's initial
`$effect` therefore runs with no client. `App.onConnected()` finishes by
refreshing the current view, which is what turns the initial "not connected"
panes into real data exactly once — the alternative (each page watching the
connection itself) is nine places to get wrong instead of one.

The same shape applies to `/`: the shortcut navigates _and_ asks for focus in the
same tick, so the search page counts focus requests from zero rather than
snapshotting the current counter at mount time (which would already include the
request that created it).

## Playback

`PlayerStore` owns exactly one audio element (behind `AudioPort`) and translates
intent into queue operations, URL resolution, scrobbles and auto-DJ refills.

- **Queue**: `QueueStore` is pure list manipulation plus a cursor — `set`,
  `append`, `insertAfterCurrent`, `remove`, `move`, `next`/`previous`, repeat
  modes, and shuffle that shuffles only the _tail_ (so the current track keeps
  playing) while remembering the pristine order to restore.
- **URL resolution**: the player asks an injected resolver, which returns either
  a stream URL or a local blob URL. This is the seam that makes the offline
  cache invisible to the rest of the app.
- **Scrobbling**: "now playing" (`submission=false`) on start, a real scrobble
  at 50% or 4 minutes (whichever comes first), short tracks on completion.
  Failures are swallowed — scrobbling must never interrupt playback.
- **Auto-DJ** (`player/autodj.ts`): strategy order is server similarity
  (`getSimilarSongs2`, seeded by the last few played tracks) → local heuristics
  over a random sample (genre/era/artist/album scoring, all pure and tested) →
  anything from the library. It never stalls, and it refills when the queue is
  _nearly_ empty rather than only at the end, so playback does not gap.

## Offline cache

- `offline/db.ts` — IndexedDB with two stores: small metadata rows (indexed by
  `albumId`) and the audio blobs, kept apart so a presence check never loads
  audio. Presence checks use **key-only** queries (`getAllKeys`, index key
  ranges) because bulk-reading a store of `ArrayBuffer`s is what kills a mobile
  WebView.
- `offline/blobStore.ts` — where bytes physically live: IndexedDB on the web,
  the Capacitor app data directory on Android, in memory for tests.
- `offline/downloads.svelte.ts` — a cancellable, concurrency-limited queue. The
  cancellation token is registered _synchronously before the first await_ and
  re-checked before **every** write, so cancelling or removing an album cannot
  be raced into resurrecting its data. Only `downloading` (interrupted) entries
  resume on start-up; `failed` ones wait for an explicit retry.
- `offline/resolve.ts` — mirrors readiness in an in-memory `Set` so the UI can
  ask "is this cached?" synchronously while rendering, and caps live blob URLs
  (revoking the oldest) because each one pins its whole file in memory.

## Error handling

`api/errors.ts` defines the taxonomy: `AuthError` (wrong credentials — the app
asks you to sign in again), `ProtocolError` (not actually a Subsonic server),
`NetworkError`, `RequestTimeoutError`. Stores surface a message and keep the
last good data, so a flaky request degrades one pane instead of blanking a page.
Artist pages fetch biography, top songs and similar artists **independently**:
servers without Last.fm configured return an empty biography, and the page says
so rather than pretending the feature is broken.

## Testing

| level            | what it covers                                                                                                                                                             |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| unit             | `md5` (RFC vectors), URL/auth building, wire→domain mapping, cache TTL/LRU, error taxonomy, formatting, persistence envelopes, route parsing                               |
| logic            | queue manipulation and shuffle/unshuffle, auto-DJ scoring and fallbacks, scrobble thresholds, download race/cancel, resolver object-URL cap, binding routing and sequences |
| component        | list rendering and cursor behaviour, row badges, overlays, settings toggles                                                                                                |
| e2e (Playwright) | the real production build against the mock Subsonic server, driven entirely by the keyboard: login, browse, open an album, play, queue, search, help                       |

The mock server (`tools/mock-subsonic/`) is dependency-free: it parses real
ID3v2 and FLAC tags from a generated library, supports range requests (so
seeking works), implements the token and legacy auth schemes, and offers
env-driven fault injection (latency, malformed JSON, 503s, dropped sockets,
truncated streams) so the client's unhappy paths are exercised deterministically.

`tests/interop/` runs the same client against a **real Navidrome** (opt in with
`STAVE_IT=1` after `just navidrome`) to catch the places where the mock is more
forgiving than the real server. Two such differences are pinned there:

- Navidrome ignores single-character search queries (the mock matches them), and
- it returns an empty biography rather than an error when Last.fm is not
  configured — which is why artist pages degrade instead of failing.

`nix flake check` runs the unit tests _and_ evaluates both NixOS modules in a
real system configuration, which catches option typos that would otherwise only
appear on a deploy.

## Adding things

**A page**: create `src/lib/pages/X.svelte`, take a route in
`stores/router.svelte.ts`, register it in `App.svelte`, register its keys with
`keyboard/list.svelte.ts` helpers (`listNavigationBindings`, `albumListBindings`,
`trackListBindings`) so it behaves like every other list. `docs/UI-REFERENCE.md`
documents the whole API surface.

**A key binding**: add it to the binding array of the scope it belongs to —
never add a raw `keydown` listener. It then appears in the help overlay and, if
you set `hint: true`, in the hint bar.

**A server endpoint**: add the endpoint name, a workspace type, a normaliser and
a client method; keep it cached by default and call `invalidate()` from the
mutations that affect it.
