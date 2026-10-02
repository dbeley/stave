# Android mobile shell — design

**Status:** draft for review
**Date:** 2026-10-02

## Summary

stave is one Svelte build with two audiences: desktop users drive it entirely by
keyboard (vim-style), Android users have no keyboard and get a terminal UI that
was never adapted. This spec defines a **touch shell** that layers onto the
existing components when a coarse pointer is detected, leaving the
keyboard-driven desktop path unchanged.

The work fixes the concrete gaps found in the current build: no bottom
navigation, a now-playing page whose queue is squeezed away, no long-press
context menu, no seekable progress bar, undersized touch targets, and no
hardware back-button handling.

## Background: what exists today

- Navigation on touch is a single `[:]` chip in `StatusBar.svelte` that opens
  `CommandPalette.svelte`. There is no persistent nav.
- `NowPlayingPage.svelte` stacks cover, metadata and queue in a `height: 100%`
  flex column; at ≤820px the columns collapse but the page itself cannot
  scroll, so the queue (a `grow` panel) receives a sliver or is pushed below the
  fold. `QueueOverlay` is a centred modal, reachable only by `Q` or the palette.
- `ActionMenu.svelte` and `ui.svelte.ts` both claim a long-press opens the
  action menu, but no pointer/touch handlers exist anywhere. On touch the menu
  is unreachable.
- `Meter.svelte` is a non-interactive `<span role="progressbar">`; the player
  already exposes `seekFraction()` (used by the `1`–`9` keys) but nothing wires
  a tap to it.
- The bottom `HintBar` is deliberately emptied on coarse pointers and falls
  through to rendering the literal text `key hints hidden (settings)`.
- Responsiveness is improvised: four pages have width breakpoints, `HintBar`
  uses `(pointer: coarse)`, `isNativePlatform()` is only used for blob storage.
- `@capacitor/app` is a dependency but is never imported, so the hardware back
  button is unhandled.
- Touch targets are undersized throughout (list rows have no `min-height`;
  palette rows are ~27px; tabs ~small).

## Goals

- Every primary flow — navigate, browse, play, inspect and edit the queue, act
  on an item, seek — is comfortable and reachable by thumb on an Android phone.
- The app feels like a touch player, without losing its terminal identity.
- Desktop at its normal width is unchanged: same bindings, same hint bar, same
  layout. Narrow desktop windows gain reflow only (never the touch shell).

## Non-goals

- A page-by-page mobile-first redesign. This is one cohesive shell pass; pages
  get shared reflow + touch sizing, not bespoke mobile layouts.
- Background playback / foreground service (a separate, documented limitation
  in `docs/ANDROID.md`).
- Tablet-specific layout beyond what the shared reflow provides.
- A user-facing manual override of the shell. The trigger is capability-only.

## Success criteria

- On a coarse-pointer device: a persistent bottom nav (Home · Albums · Artists ·
  Now playing), a mini-player, a full-height now-playing screen whose queue is
  fully usable, long-press action menus, tap/drag seeking, drag queue reorder,
  and a working hardware back button.
- On a fine-pointer device: no bottom nav, no mini-player, hints and keyboard
  bindings exactly as today.
- All touch targets on primary surfaces are at least 44px in their smallest
  dimension.

## Constraints

- One codebase, one component tree (Approach A). No forked mobile pages.
- The keyboard registry stays live in touch mode (a Bluetooth keyboard still
  works); only key hints are hidden.
- No new runtime dependency. `@capacitor/app` already exists in
  `package.json`.
- Follow existing patterns: stores are constructed in `app.svelte.ts`, theme
  tokens are mirrored onto `<html>` from an effect in `App.svelte`, Capacitor
  modules are imported lazily (see `offline/blobStore.ts`).

## Architecture

### Capability model — one source of truth

New store `src/lib/stores/capability.svelte.ts`:

- `touch: boolean`, derived from `matchMedia('(pointer: coarse)')`, with a
  listener on change. Absent `matchMedia` (tests, jsdom) defaults to **terminal**.
- `shell: 'touch' | 'terminal'` getter.
- The matcher is injectable so tests can drive it deterministically.

`App` owns the store in its constructor (composition root). `App.svelte` mirrors
`app.capability.shell` onto `<html>` as `data-shell="touch|terminal"`, exactly
as `applyThemeToDocument` writes `data-theme`/`data-crt`.

Why pointer and not width: a touchscreen laptop's primary pointer is its
trackpad, so it stays terminal; a phone is coarse and gets the shell. A narrow
desktop window keeps the terminal UI but still reflows (see below).

### Shell structure

In `App.svelte`, when `shell === 'touch'`:

- Do not render `HintBar`.
- Replace `NowPlayingBar` with `MiniPlayer`.
- Render `<BottomNav />` pinned at the bottom.
- The `now-playing` route renders `NowPlayingScreen` instead of the stacked
  terminal page.
- The login overlay suppresses both `MiniPlayer` and `BottomNav` (it already
  blocks the shell).

Order at the bottom: content → `MiniPlayer` → `BottomNav`. Both pad themselves
with `env(safe-area-inset-bottom)`.

### Navigation

Move `DESTINATIONS` out of `CommandPalette.svelte` into a shared
`src/lib/ui/destinations.ts`. The palette renders all destinations; `BottomNav`
renders the four-tab subset:

| tab | route |
| --- | --- |
| home | `{ name: 'home' }` |
| albums | `{ name: 'albums', sort: 'newest' }` |
| artists | `{ name: 'artists' }` |
| now playing | `{ name: 'now-playing' }` |

Sharing one table preserves the palette's existing guarantee that the
on-screen list and its mnemonics cannot drift.

Active-tab logic: `home`/`albums`/`artists`/`now-playing` match by route name;
`album` highlights albums and `artist` highlights artists; `playlist`, `search`
and `settings` highlight nothing. Active styling matches `TabStrip`'s
accent-filled chip.

### Hardware back button

New `src/lib/native/backButton.ts` lazily imports `@capacitor/app` and registers
`backButton`:

1. an overlay is open → close it;
2. else `router.back()` if it can;
3. else let the OS exit the app.

No-op on web (module unavailable). Registration happens from `App`/`main.ts`
after the router starts.

## Components

### New

- `BottomNav.svelte` — four tabs from the shared destinations table, ≥48px
  targets, safe-area padded, accent-filled active state.
- `MiniPlayer.svelte` — above the nav. Cover thumb (`CoverArt mode="image"`,
  ~40px), truncated title/artist, play/pause + next, and a progress line whose
  hit area is padded (~24px) while the line stays thin. Tapping the body opens
  the now-playing screen. Hidden when there is no track.
- `NowPlayingScreen.svelte` — full-height mobile presentation: compact hero
  (art ≈ 40–45vw, title/artist, favourite), `TransportControls`, `SeekBar`, then
  a segmented control `[ now playing | queue ]`. The queue segment is
  `QueueList scope="page"` filling the remaining height.
- `TransportControls.svelte` — extracted shared transport (previous, play/pause,
  next; optional ±10s), used by `NowPlayingBar`, `NowPlayingPage`,
  `MiniPlayer`, `NowPlayingScreen`.
- `SeekBar.svelte` — extracted progress bar. Keeps the block-character
  appearance but is interactive: pointer down/move/up map `clientX` to a
  clamped fraction and call `player.seekFraction`. Used by all player surfaces,
  including terminal (click-to-seek is additive there).

### Changed

- `ListView.svelte` — add `onLongPress?: (item, index) => void`, wired to the
  `longPress` action. Pages that already pass `onActivate` also pass the
  matching `actions.open*Actions`.
- `QueueList.svelte` — drag handle (pointer capture; target index from row
  midpoints; `queue.move(from, to)`), inline remove, long-press → track actions.
- `ActionMenu.svelte` — touch sizing; hide key badges under
  `[data-shell='touch']`, mirroring how `TabStrip` hides tips on coarse
  pointers.
- `ui.svelte.ts` — add transient `nowPlayingTab: 'info' | 'queue'`. The nav tab
  sets `info`; the palette's queue destination sets `queue`. Not persisted.
- `NowPlayingBar.svelte`, `NowPlayingPage.svelte` — reuse `TransportControls`
  and `SeekBar`.
- `app.css` — a `[data-shell='touch']` block: row `min-height: 44px`, larger
  button/tab padding, hide dense technical columns.
- Pages missing breakpoints (`AlbumsPage`, `ArtistsPage`, `FavoritesPage`,
  `PlaylistsPage`, `SearchPage`, `SettingsPage`, `ListenLaterPage`) get the same
  `.columns` collapse the adapted pages have; the settings form gets
  full-width touch controls.

### Shared gesture helper

`src/lib/utils/press.ts` exports a `longPress` Svelte action:

- `pointerdown` starts a ~500ms timer; cancels on >10px movement or
  `pointercancel`; ignores mouse/pen.
- On fire, sets a flag that swallows the trailing `click`, so a long-press never
  also triggers the row's activate action.

## Data flow

`matchMedia('(pointer: coarse)')` → `CapabilityStore.touch` → `data-shell` on
`<html>` → component branches and CSS. Nothing is persisted; a tablet gaining a
mouse flips the shell live in both directions.

Navigation reads `app.router.current` directly; `nowPlayingTab` is the only new
transient UI state. Playback is untouched: mobile surfaces read the same
`PlayerStore`/`QueueStore` and call the same methods (`seekFraction`, `move`,
`toggle`, `next`). `QueueStore.move(from, to)` already exists.

`T` (theme), `D` (auto-DJ) and friends stay global, so they remain scriptable by
a Bluetooth keyboard on a phone.

## Edge cases

- Login overlay: nav and mini-player suppressed.
- Empty queue: `QueueList`'s existing empty message; the queue segment shows it.
- No current track: mini-player hidden; now-playing screen shows the existing
  `StateMessage` empty state; nav remains.
- Unknown duration (`duration === 0`): tap-seek is ignored, never NaN.
- Drag handle: pointer capture + `touch-action` so reordering never scrolls the
  list. Long-press cancels past the 10px slop so scrolling is unaffected.
- Bluetooth keyboard on a phone: registry stays active (hints stay hidden). A
  first `keydown` could optionally reveal the hint bar; not in this pass.
- Safe areas: nav/mini-player pad bottom; now-playing screen pads top and
  bottom.
- `prefers-reduced-motion` already disables transitions app-wide.

## Testing

**Unit (vitest)**

- Capability store with an injected matcher: coarse → touch, absent → terminal,
  change event flips the shell.
- Destinations invariant: bottom-nav set ⊆ palette set; keys unique.
- `press.ts` with fake timers: fires after the threshold, cancels on slop,
  swallows the trailing click.
- Back-button handler: overlay → close; else `router.back()`; else exit.
- `SeekBar` fraction clamping; queue drag target-index math.

**Component (@testing-library/svelte)**

- `BottomNav` active state per route.
- `MiniPlayer` render/hide and tap-navigates.
- `NowPlayingScreen` segmented toggle honors `nowPlayingTab`.
- `ListView` long-press opens the correct menu.
- `ActionMenu` hides badges under `data-shell="touch"`.

**E2E (Playwright)**

- Extend `e2e/mobile.spec.ts` (existing Pixel 7 project): bottom nav visible and
  navigates; mini-player appears and opens now-playing; long-press opens
  actions; tapping the progress bar seeks; queue segment shows the queue.
- Add a desktop guard: no bottom nav, `j`/`k` and the hint bar still work.

Hardware back is covered by unit tests and stays a manual device check.

## Rollout

Three independently mergeable steps:

1. Capability store + shell + `BottomNav` + shared destinations.
2. `MiniPlayer` + `NowPlayingScreen` + `TransportControls`/`SeekBar` extraction.
3. Gestures: long-press, tap-seek, drag reorder, plus page reflow/touch sizing.

Everything is gated by `data-shell`, so the desktop path is unchanged; the
existing desktop E2E suite is the regression guard. Rollback is deleting the
touch components.

## Verification

- `pnpm verify` (format, lint, types, unit, build).
- `pnpm e2e`.
- Manual device pass for long-press feel, drag feel and the hardware back
  button; record the result in `docs/ANDROID.md` (which currently flags the back
  button as unverified).

## Decisions taken

- A Bluetooth-keyboard `keydown` on a touch device does **not** reveal the hint
  bar in this pass. The keyboard registry stays live; hints stay hidden.
- On touch, the now-playing hero keeps ASCII cover art (respecting the
  `asciiCoverArt` setting) but at a smaller column count, while the mini-player
  always uses a real image thumbnail. This keeps the terminal identity where
  there is room and avoids a slow, tall render in the 40px thumb.
