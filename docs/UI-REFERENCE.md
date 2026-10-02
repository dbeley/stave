# UI reference

Authoritative summary of the pieces every page is built from. If something here
disagrees with the code, the code wins — but then fix this file.

## Conventions

- **Svelte 5 runes only** (`$state`, `$derived`, `$effect`, `$props`). No stores
  with `$store` syntax, no `on:click` — use `onclick`, `oninput`, `onkeydown`.
- **Styling**: scoped `<style>` blocks using the design tokens
  (`var(--accent)`, `var(--fg)`, `var(--fg-dim)`, `var(--fg-faint)`,
  `var(--border)`, `var(--border-focus)`, `var(--bg)`, `var(--bg-elev)`,
  `var(--bg-elev-2)`, `var(--ok)`, `var(--warn)`, `var(--danger)`).
  No Tailwind utility classes in components. `0px` border radius, monospace.
- **Layout**: a page is `<main class="page">` with
  `display:flex; flex-direction:column; flex:1; min-height:0; padding:0.55rem; gap:0.5rem`.
  Every scrollable region is a `<Panel scroll grow>`.
- **Keyboard**: every interactive thing must be reachable without a mouse.
  Register bindings with `onMount(() => app.keyboard.registerAll([...]))`
  (the returned function is the unregister cleanup).
- **Loading data**: `$effect(() => { void app.library.loadX(id); })` — the stores
  de-duplicate in-flight requests and cache by key, so re-running is cheap.
- **Never format data in the template with ad-hoc code** — use
  `$lib/utils/format` (`formatDuration`, `formatLongDuration`, `formatCount`,
  `formatBytes`, `countAlbums`, `countTracks`, `truncate`, `pluralize`).

## `app` — `import { app } from '$lib/app.svelte'`

| member                                                                               | what                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.settings.state`                                                                 | `{theme, accent, crtEffects, asciiCoverArt, autoDj, autoDjThreshold, autoDjBatchSize, offlineCacheEnabled, scrobblingEnabled, streamMaxBitRate, volume, pageSize, keyHints, showTechnicalColumns}` |
| `app.settings.update(patch)`                                                         | patch + persist                                                                                                                                                                                    |
| `app.settings.toggle('autoDj'\|'offlineCacheEnabled'\|…)`                            | booleans                                                                                                                                                                                           |
| `app.settings.cycleTheme() / cycleAccent()`                                          | cycles                                                                                                                                                                                             |
| `app.setOfflineCacheEnabled(bool)`                                                   | enables caching _and_ starts downloading listen-later albums                                                                                                                                       |
| `app.clearOfflineCache()`                                                            | wipes cached audio                                                                                                                                                                                 |
| `app.connection`                                                                     | `{status:'disconnected'\|'connecting'\|'connected'\|'error', error, serverVersion, openSubsonic}`                                                                                                  |
| `app.isConnected`, `app.getClient()`, `app.requireClient()`                          | connection                                                                                                                                                                                         |
| `app.connect(creds, {remember})`                                                     | login (used by LoginOverlay)                                                                                                                                                                       |
| `app.disconnect()`                                                                   | sign out                                                                                                                                                                                           |
| `app.router.current`                                                                 | discriminated `Route` (see `$lib/stores/router.svelte`)                                                                                                                                            |
| `app.router.navigate(route)`                                                         | e.g. `{name:'album', id}`, `{name:'albums', sort}`                                                                                                                                                 |
| `app.ui.state.overlay`, `openOverlay(kind)`, `closeOverlay()`, `openActions(target)` | overlays: `'help'`, `'queue'`, `'login'`, `'actions'`                                                                                                                                              |
| `app.toasts.info/ok/warn/error(msg)`                                                 | status line                                                                                                                                                                                        |
| `app.keyboard.registerAll(bindings)`                                                 | register page bindings                                                                                                                                                                             |
| `app.refreshCurrentView()`                                                           | reload the current route's data                                                                                                                                                                    |

## Stores

### `app.library` (`LibraryStore`)

- `list(sort)` → `{items: Album[], loading, error, hasMore, offset, loadedAt}`
- `loadAlbumList(sort, {refresh?})`, `loadMoreAlbums(sort)` (paginated sorts only)
- `artists` → `{listing?: {indexes: {name, artists}[], artists, ignoredArticles}, loading, error}`
- `loadArtistsList({refresh?})`
- `albumDetail(id)` → `{album?, loading, error}`; `loadAlbum(id, {refresh?})`
- `artistDetail(id)` → `{artist?, albums: Album[], topSongs: Track[], bio?: ArtistBio, bioUnavailable: boolean, loading, error}`
- `loadArtist(id, {refresh?})` — bio/topSongs failures degrade, they do not throw
- `invalidate('album'|'artist'|'list'|'all', id?)`

### `app.favorites`

- `state.{albums, artists, tracks, loading, error}`, `load({refresh?})`
- `isAlbumStarred(album)`, `isArtistStarred(artist)`, `isTrackStarred(track)`
- `toggleAlbum(album)`, `toggleArtist(artist)`, `toggleTrack(track)` (optimistic)

### `app.listenLater` (local, albums only)

- `state.entries` → `{album: Album, addedAt: number}[]`, `albums`, `count`, `isEmpty`
- `has(albumId)`, `add(album)`, `toggle(album)` → boolean, `remove(albumId)`, `move(from,to)`, `clear()`

### `app.downloads` (offline cache)

- `entries` → `{albumId, albumName, status:'queued'|'downloading'|'cached'|'failed', total, done, bytes, error, updatedAt}[]`
- `entry(albumId)`, `isCached(albumId)`, `cachedBytes`
- `enqueue(album)`, `retry(albumId)`, `cancel(albumId)`, `remove(albumId)`, `hydrate()`

### `app.resolver`

- `isCached(trackId)` (synchronous), `cachedCount`, `prime()`, `resolve(trackId)` → `{url, source:'cache'|'stream'}`

### `app.search`

- `state.{query, results: {artists, albums, tracks}, resultsFor, loading, error, total}`
- `hasQuery`, `setQuery(q)` (debounced), `submit(q?)`, `clear()`

### `app.player`

- `state.{status:'idle'|'loading'|'playing'|'paused'|'error', track, position, duration, source, error, autoDjAdded}`
- `history` (recent tracks), `isPlaying`, `progress` (0..1), `remainingSec`, `volume`, `muted`
- `playTracks(tracks, index)`, `playNow(track, {tracks,index}?)`, `playAlbum(album)`
- `enqueue(tracks, 'end'|'next')`, `enqueueAlbum(album, 'end'|'next')`
- `play()`, `pause()`, `toggle()`, `stop()`, `next()`, `previous()`
- `seek(s)`, `seekBy(s)`, `seekFraction(f)`, `setVolume(v)`, `volumeBy(d)`, `toggleMute()`
- `toggleShuffle()`, `cycleRepeat()`, `repeatMode`

## `actions` — `import { actions } from '$lib/ui/actionsRegistry.svelte'`

`playTrackNow(track, context?)` · `playAlbumNow(album)` · `playArtistNow(artist)` ·
`enqueueTrack(track, mode)` · `enqueueTracks(tracks, mode, label?)` ·
`enqueueAlbum(album, mode)` · `playAlbumNext(album)` · `toggleAlbumFavorite(album)` ·
`toggleArtistFavorite(artist)` · `toggleTrackFavorite(track)` ·
`toggleListenLater(album)` → boolean · `toggleListenLaterForTrack(track)` ·
`openAlbum(id)` · `openArtist(id)` · `openPlaylist(id)` · `openSearch(q)` ·
`openAlbumActions(album)` · `openTrackActions(track)` · `openArtistActions(artist)`

`TrackContext = {tracks: Track[], index: number, label?: string}`.

## Keyboard helpers — `$lib/keyboard/list.svelte`

```ts
const cursor = new ListCursor();
onMount(() =>
  app.keyboard.registerAll([
    ...listNavigationBindings(cursor, { hint: true }), // j k gg G ^d ^u, enter if onActivate
    ...albumListBindings(cursor, () => albums), // enter p a f L o y
    ...trackListBindings(cursor, () => tracks, { context: () => ctx }),
  ]),
);
```

- `listNavigationBindings(cursor, {onActivate?, onOpen?, scope?, hint?})`
  binds `j/k/↓/↑`, `gg/home`, `G/end`, `ctrl+d/pagedown`, `ctrl+u/pageup`,
  plus `enter` when `onActivate` is given and `o` when `onOpen` is given.
- `albumListBindings(cursor, () => Album[], {onOpen?, scope?, group?})` —
  `enter` open (default: album page), `p` play now, `a` append,
  `f` favourite, `L` listen later, `o` action menu, `y` go to artist. "Play
  next" lives in the `o` menu so the global `n` stays "next track" on lists.
- `trackListBindings(cursor, () => Track[], {context?, onActivate?, scope?, group?})` —
  `enter` play now (replaces the queue with `context` when given), `a`, `f`,
  `L`, `o`, `y`.
- Scope rules: with no overlay the router consults `page` → `global`; with one
  open it consults `overlay` → `queue` (queue window only) → `global`. An open
  overlay is modal, so page shortcuts do not fire behind it. Cursor movement is
  clamped.
- Keys are chords: `'g g'` is a two-key sequence, `'G'` is shift+g (capital in
  the binding), modifiers are written `'ctrl+d'`. Printable keys encode Shift in
  the character, so never write `'shift+g'` — write `'G'`.
- Headings/separators inside a flat list must be skipped: see how
  `SearchPage.svelte` filters in an `$effect`.

## Components — `$lib/components/`

| component      | props                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `Panel`        | `title`, `note?: string\|number`, `active?`, `scroll?`, `grow?`, children                                                         |
| `ListView`     | `items`, `cursor`, `keyOf?(item,index)`, `onActivate?(item,index)`, `ariaLabel?`; renders `{#snippet row(item, index, selected)}` |
| `AlbumRow`     | `album`, `showArtist?`                                                                                                            |
| `TrackRow`     | `track`, `index?`, `showAlbum?`, `technical?`                                                                                     |
| `ArtistRow`    | `artist`, `index?`                                                                                                                |
| `CoverArt`     | `coverArtId?`, `seed` (required), `size?`, `columns?`, `mode?: 'auto'\|'ascii'\|'image'`, `ascii?`, `alt?`                        |
| `AsciiArt`     | `src?`, `seed`, `columns?`, `rows?`, `color?`                                                                                     |
| `StateMessage` | `kind: 'loading'\|'empty'\|'error'\|'info'`, `message`, `hint?`, `detail?`                                                        |
| `Meter`        | `value` (0..1), `width?`, `showPercent?`, `label?`                                                                                |
| `Overlay`      | `title`, `note?`, `width?`, `closeOnBackdrop?`, children, `footer?`                                                               |
| `LoginOverlay` | `blocking?`                                                                                                                       |

## Behaviour contract (from the product spec — do not vary per page)

- **Clicking a track** replaces the queue and plays it (with the surrounding
  list as the queue when there is one).
- **Clicking an album** opens the album page; **clicking an artist** opens the
  artist page.
- Every album/track row supports: play now, play next, add to end of queue,
  toggle favourite (server), toggle listen later (local, albums only).
- Listen later is **albums only** and is never sent to the server.
- Search results additionally show explicit queue buttons.
