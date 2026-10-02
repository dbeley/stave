# Android Mobile Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Layer a touch shell (bottom nav, mini-player, segmented now-playing, long-press/seek/drag) onto stave when a coarse pointer is present, leaving the keyboard-driven desktop unchanged.

**Architecture:** One component tree. A `CapabilityStore` resolves `(pointer: coarse)` once and mirrors it to `data-shell` on `<html>`; components render touch variants and CSS targets `[data-shell='touch']`. New mobile-only components (`BottomNav`, `MiniPlayer`, `NowPlayingScreen`) are mounted by `App.svelte` under that shell. Playback and the keyboard registry are untouched.

**Tech Stack:** Svelte 5 runes, TypeScript, Vitest + @testing-library/svelte, Playwright (Pixel 7 project), Tailwind v4 + hand-written CSS, Capacitor 8.

**Spec:** `docs/superpowers/specs/2026-10-02-android-mobile-shell-design.md`

## Global Constraints

- One component tree, no forked mobile pages.
- No new runtime dependency; `@capacitor/app` is already in `package.json`.
- The keyboard registry stays live under the touch shell; only hints are hidden.
- Desktop at normal width is unchanged; narrow desktop windows may reflow but never get the touch shell.
- Touch targets on primary surfaces are ≥44px in their smallest dimension.
- Touch-only behavior must be gated on `capability.shell === 'touch'`, never on width alone.
- Tests import via the `$lib` alias; stores are constructed in `App`'s composition root.
- Run a single test with `pnpm exec vitest run <path>`; full gates are `pnpm verify` and `pnpm e2e`.

## Review Focus

Most likely failure modes for a person using this, each pinned to the owning task's tests:

1. **Long-press vs. scroll** — a press that drifts past the slop while scrolling a list must not open the action menu (Task 8/9).
2. **Tap-seek with unknown duration** — `duration === 0` must ignore the tap and never produce NaN (Task 5).
3. **Reordering the playing row** — `queue.move()` must keep the playing item (and cursor) on the same track (Task 10, using the existing `QueueStore.move`).
4. **Shell/live flip** — nav and mini-player appear/hide correctly across routes, login and pointer-capability changes (Tasks 3, 4, 6).
5. **Back-button priority** — an open overlay closes before route history; running out of history must not crash (Task 13).

---

## File Structure

**New**
- `src/lib/stores/capability.svelte.ts` — coarse-pointer capability + `data-shell` writer.
- `src/lib/ui/destinations.ts` — one destination table for palette + bottom nav.
- `src/lib/components/BottomNav.svelte`
- `src/lib/components/MiniPlayer.svelte`
- `src/lib/components/NowPlayingScreen.svelte`
- `src/lib/components/TransportControls.svelte`
- `src/lib/components/SeekBar.svelte`
- `src/lib/utils/press.ts` — `longPress` action + `dropIndex` helper.
- `src/lib/native/backButton.ts` — Capacitor back-button glue.

**Modified**
- `src/App.svelte`, `src/lib/app.svelte.ts`, `src/main.ts`
- `src/lib/stores/ui.svelte.ts`
- `src/lib/components/{CommandPalette,NowPlayingBar,ListView,QueueList,ActionMenu}.svelte`
- `src/lib/pages/{HomePage,AlbumsPage,AlbumPage,ArtistsPage,ArtistPage,FavoritesPage,PlaylistsPage,PlaylistPage,ListenLaterPage,SearchPage,SettingsPage,NowPlayingPage}.svelte`
- `src/app.css`, `docs/ANDROID.md`
- tests under `tests/lib/**`, `e2e/mobile.spec.ts`

---

# Phase 1 — Shell foundation

### Task 1: Capability store

**Files:**
- Create: `src/lib/stores/capability.svelte.ts`
- Test: `tests/lib/stores/capability.test.ts`

**Interfaces:**
- Produces:
  - `type Shell = 'touch' | 'terminal'`
  - `interface MediaQueryLike { matches: boolean; addEventListener?(type: 'change', listener: () => void): void; removeEventListener?(type: 'change', listener: () => void): void }`
  - `interface CapabilityOptions { matchMedia?: (query: string) => MediaQueryLike | null }`
  - `class CapabilityStore { constructor(options?: CapabilityOptions); get touch(): boolean; get shell(): Shell; refresh(): void; dispose(): void }`
  - `function applyShellToDocument(shell: Shell, root?: HTMLElement | null): void` (defaults to `document.documentElement`; sets `root.dataset.shell`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/stores/capability.test.ts
import { describe, expect, it, vi } from 'vitest';
import { CapabilityStore, applyShellToDocument, type MediaQueryLike } from '$lib/stores/capability.svelte';

function fakeQuery(matches: boolean) {
  const listeners: (() => void)[] = [];
  const query: MediaQueryLike = {
    matches,
    addEventListener: (_t, l) => listeners.push(l),
    removeEventListener: () => {},
  };
  return { query, fire: () => { query.matches = !query.matches; listeners.forEach((l) => l()); } };
}

describe('CapabilityStore', () => {
  it('is touch when the coarse-pointer query matches', () => {
    const { query } = fakeQuery(true);
    expect(new CapabilityStore({ matchMedia: () => query }).shell).toBe('touch');
  });

  it('is terminal when the query does not match', () => {
    const { query } = fakeQuery(false);
    expect(new CapabilityStore({ matchMedia: () => query }).shell).toBe('terminal');
  });

  it('is terminal when matchMedia is unavailable', () => {
    expect(new CapabilityStore({ matchMedia: () => null }).shell).toBe('terminal');
  });

  it('flips when the query changes', () => {
    const { query, fire } = fakeQuery(false);
    const store = new CapabilityStore({ matchMedia: () => query });
    fire();
    expect(store.shell).toBe('touch');
  });

  it('writes data-shell onto the document element', () => {
    const root = document.createElement('html');
    applyShellToDocument('touch', root);
    expect(root.dataset.shell).toBe('touch');
    applyShellToDocument('terminal', root);
    expect(root.dataset.shell).toBe('terminal');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/stores/capability.test.ts`
Expected: FAIL — cannot resolve `$lib/stores/capability.svelte`.

- [ ] **Step 3: Implement `capability.svelte.ts`**

Use a private `$state` field with a public getter (avoid a field/getter name clash):

```ts
export class CapabilityStore {
  private readonly resolve: (query: string) => MediaQueryLike | null;
  private readonly query: MediaQueryLike | null;
  private touchState = $state(false);

  constructor(options: CapabilityOptions = {}) {
    this.resolve = options.matchMedia
      ?? ((q) => (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(q) : null));
    this.query = this.resolve('(pointer: coarse)');
    this.touchState = this.query?.matches ?? false;
    this.query?.addEventListener?.('change', this.onChange);
  }
  private onChange = () => { this.touchState = this.query?.matches ?? false; };
  get touch(): boolean { return this.touchState; }
  get shell(): Shell { return this.touchState ? 'touch' : 'terminal'; }
  refresh(): void { this.onChange(); }
  dispose(): void { this.query?.removeEventListener?.('change', this.onChange); }
}

export function applyShellToDocument(shell: Shell, root: HTMLElement | null = globalThis.document?.documentElement ?? null): void {
  if (root) root.dataset.shell = shell;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/lib/stores/capability.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/capability.svelte.ts tests/lib/stores/capability.test.ts
git commit -m "feat(shell): add coarse-pointer capability store"
```

---

### Task 2: Shared destinations table

**Files:**
- Create: `src/lib/ui/destinations.ts`
- Modify: `src/lib/components/CommandPalette.svelte` (replace the inline `DESTINATIONS` with the import)
- Test: `tests/lib/ui/destinations.test.ts`

**Interfaces:**
- Consumes: `app` from `$lib/app.svelte`.
- Produces:
  - `interface Destination { key: string; label: string; hint: string; run: () => void; nav?: { activeOn: Route['name'][] } }`
  - `const DESTINATIONS: Destination[]` — moved verbatim from `CommandPalette.svelte`, with `nav` added to `home` (`['home']`), `albums` (`['albums','album']`), `artists` (`['artists','artist']`), `now-playing` (`['now-playing']`).
  - `const NAV_DESTINATIONS: Destination[]` — `DESTINATIONS.filter((d) => d.nav)` in table order.

- [ ] **Step 1: Write the failing test**

```ts
// tests/lib/ui/destinations.test.ts
import { describe, expect, it, vi } from 'vitest';
vi.mock('$lib/app.svelte', () => ({ app: { router: { navigate: vi.fn() }, focusSearch: vi.fn(), ui: { openOverlay: vi.fn() }, search: { state: { query: '' } }, capability: { shell: 'terminal' } }, App: class {} }));
import { DESTINATIONS, NAV_DESTINATIONS } from '$lib/ui/destinations';

describe('destinations', () => {
  it('has unique mnemonic keys', () => {
    const keys = DESTINATIONS.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('nav destinations are a subset of all destinations', () => {
    for (const d of NAV_DESTINATIONS) expect(DESTINATIONS).toContain(d);
  });
  it('exposes the four expected tabs in order', () => {
    expect(NAV_DESTINATIONS.map((d) => d.label)).toEqual(['home', 'albums', 'artists', 'now playing']);
  });
  it('maps detail routes to their parent tab', () => {
    const albums = NAV_DESTINATIONS.find((d) => d.label === 'albums')!;
    expect(albums.nav!.activeOn).toContain('album');
    const artists = NAV_DESTINATIONS.find((d) => d.label === 'artists')!;
    expect(artists.nav!.activeOn).toContain('artist');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/ui/destinations.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `destinations.ts` and rewire `CommandPalette.svelte`**

Move the `Destination` interface and `DESTINATIONS` array out of `CommandPalette.svelte` unchanged, add `nav` per the Interfaces block, and export `NAV_DESTINATIONS`. In `CommandPalette.svelte`, delete the local copies and `import { DESTINATIONS } from '$lib/ui/destinations';`. Do not change `choose`, the bindings, or the markup.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/lib/ui/destinations.test.ts tests/lib/components/CommandPalette.test.ts`
Expected: PASS (the existing palette tests must be unchanged and green).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ui/destinations.ts src/lib/components/CommandPalette.svelte tests/lib/ui/destinations.test.ts
git commit -m "refactor(ui): one destination table for palette and nav"
```

---

### Task 3: BottomNav component

**Files:**
- Create: `src/lib/components/BottomNav.svelte`
- Test: `tests/lib/components/BottomNav.test.ts`

**Interfaces:**
- Consumes: `NAV_DESTINATIONS` (Task 2), `app.router.current`, `app.capability.shell`.
- Produces: a `BottomNav` component with no props. Each tab is a `<button aria-label="go to {label}" aria-current={active ? 'page' : undefined}>` whose click calls the destination's `run()`.

- [ ] **Step 1: Write the failing test**

Mock `$lib/app.svelte` as in `NowPlayingBar.test.ts` (`vi.hoisted` + `vi.mock`), supplying `router.current`, `router.navigate`, `capability`, `ui`, `focusSearch`, `search`. Render `BottomNav` and assert:

```ts
it('renders the four tabs', ...);            // buttons home/albums/artists/now playing
it('marks the current route active', ...);   // current {name:'album'} ⇒ albums has aria-current="page"
it('navigates on tap', ...);                 // click albums ⇒ router.navigate({name:'albums',sort:'newest'})
it('activates the artists tab on an artist route', ...); // current {name:'artist',id:'x'}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/components/BottomNav.test.ts`
Expected: FAIL — cannot resolve component.

- [ ] **Step 3: Implement `BottomNav.svelte`**

Render `NAV_DESTINATIONS`; active = `destination.nav!.activeOn.includes(app.router.current.name)`; `onclick={() => destination.run()}`. Style: fixed-height flex row, accent fill for active, `padding-bottom: calc(... + env(safe-area-inset-bottom, 0px))`, each button `min-height: 48px`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/lib/components/BottomNav.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/BottomNav.svelte tests/lib/components/BottomNav.test.ts
git commit -m "feat(shell): add bottom navigation"
```

---

### Task 4: Wire the shell into App

**Files:**
- Modify: `src/lib/app.svelte.ts` (construct `capability`), `src/App.svelte`
- Test: `tests/lib/app.test.ts` (add one case)

**Interfaces:**
- Consumes: `CapabilityStore`, `applyShellToDocument` (Task 1), `BottomNav` (Task 3).
- Produces: `App.capability: CapabilityStore`.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/app.test.ts`:

```ts
it('exposes a terminal shell under jsdom defaults', () => {
  expect(makeApp().capability.shell).toBe('terminal');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/app.test.ts`
Expected: FAIL — `capability` is undefined.

- [ ] **Step 3: Implement**

In `App`: `readonly capability = new CapabilityStore();`. In `App.svelte`: `let shell = $derived(app.capability.shell);`, an `$effect` calling `applyShellToDocument(shell)`, render `HintBar` only when `shell === 'terminal'`, and render `<BottomNav />` when `shell === 'touch' && !needsLogin && app.ui.state.overlay !== 'login'`. Keep `NowPlayingBar` for now.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm exec vitest run tests/lib/app.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/app.svelte.ts src/App.svelte tests/lib/app.test.ts
git commit -m "feat(shell): mount bottom nav under the touch shell"
```

---

# Phase 2 — Player surfaces

### Task 5: TransportControls and SeekBar

**Files:**
- Create: `src/lib/components/TransportControls.svelte`, `src/lib/components/SeekBar.svelte`
- Modify: `src/lib/components/NowPlayingBar.svelte`, `src/lib/pages/NowPlayingPage.svelte`
- Test: `tests/lib/components/SeekBar.test.ts`, `tests/lib/components/TransportControls.test.ts`

**Interfaces:**
- `TransportControls` props: `{ seek10?: boolean }`. Renders previous, play/pause, next (+ ±10s when `seek10`). Calls `player.previous/toggle/next/seekBy`.
- `SeekBar` props: `{ width?: number; showTimes?: boolean; label?: string }`. Renders `role="slider"` with `aria-valuemin/max/now`; pointer down/move/up map `clientX` to a clamped fraction and call `player.seekFraction`. Renders `Meter` for the fill. No-op when `duration <= 0`.

- [ ] **Step 1: Write the failing tests**

`SeekBar.test.ts`: mock `$lib/app.svelte` with a fake `player` (`state:{position,duration}`, `progress`, `seekFraction: vi.fn()`). Override `getBoundingClientRect` on the slider to `{left:0,width:200}`. Assert:

```ts
it('seeks to the tapped fraction', ...);          // pointerDown/pUp at clientX 100 ⇒ seekFraction(0.5)
it('ignores a tap when duration is unknown', ...); // duration 0 ⇒ seekFraction not called
it('exposes the position as an accessible slider', ...); // aria-valuenow = round(progress*100)
```

`TransportControls.test.ts`: assert the three transport buttons call `toggle/next/previous`, and with `seek10` the ±10s buttons call `seekBy(10)`/`seekBy(-10)`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/lib/components/SeekBar.test.ts tests/lib/components/TransportControls.test.ts`
Expected: FAIL — components missing.

- [ ] **Step 3: Implement both components and refactor the two existing surfaces**

Move the transport markup out of `NowPlayingBar.svelte` and `NowPlayingPage.svelte` into `TransportControls`; replace their `Meter` usage with `SeekBar`. Preserve every `aria-label` and visible string so `NowPlayingBar.test.ts` and existing page tests keep passing (e.g. `play or pause`, `previous track`, `next track`, `1:05/3:35` must still render — put the times in `SeekBar` when `showTimes`).

- [ ] **Step 4: Run the affected suites**

Run: `pnpm exec vitest run tests/lib/components/`
Expected: PASS, including the pre-existing `NowPlayingBar.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/TransportControls.svelte src/lib/components/SeekBar.svelte src/lib/components/NowPlayingBar.svelte src/lib/pages/NowPlayingPage.svelte tests/lib/components/SeekBar.test.ts tests/lib/components/TransportControls.test.ts
git commit -m "refactor(player): share transport and add a seekable progress bar"
```

---

### Task 6: MiniPlayer

**Files:**
- Create: `src/lib/components/MiniPlayer.svelte`
- Modify: `src/App.svelte` (render it instead of `NowPlayingBar` under the touch shell)
- Test: `tests/lib/components/MiniPlayer.test.ts`

**Interfaces:**
- Consumes: `app.player`, `app.router.navigate`, `SeekBar`/`TransportControls` (Task 5), `CoverArt`.
- Produces: `MiniPlayer` component (no props). Renders nothing when `app.player.state.track` is undefined.

- [ ] **Step 1: Write the failing test**

Mirror `NowPlayingBar.test.ts`'s mock. Assert:

```ts
it('renders nothing without a current track', ...);   // container is empty
it('shows title and artist', ...);
it('opens now playing when the body is tapped', ...); // router.navigate({name:'now-playing'})
it('drives play/pause and next', ...);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/components/MiniPlayer.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `MiniPlayer.svelte`**

`CoverArt` with `mode="image"`, `size={80}`, a 40px box; truncated title/artist; `TransportControls`; an interactive `SeekBar` behind a padded hit area. The whole body is a button (`aria-label="open now playing"`) except the controls. Show a source badge (`▣`/`≈`) like the terminal bar.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run tests/lib/components/MiniPlayer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/MiniPlayer.svelte src/App.svelte tests/lib/components/MiniPlayer.test.ts
git commit -m "feat(player): add touch mini-player"
```

---

### Task 7: Now-playing screen with segmented queue

**Files:**
- Create: `src/lib/components/NowPlayingScreen.svelte`
- Modify: `src/lib/stores/ui.svelte.ts`, `src/lib/ui/destinations.ts`, `src/App.svelte`
- Test: `tests/lib/stores/ui.test.ts`, `tests/lib/components/NowPlayingScreen.test.ts`

**Interfaces:**
- `UiState` gains `nowPlayingTab: 'info' | 'queue'` (default `'info'`).
- `UiStore.showNowPlayingTab(tab: 'info' | 'queue'): void`; `reset()` sets it back to `'info'`.
- `NowPlayingScreen` (no props) renders a segmented control `[now playing | queue]` bound to `app.ui.state.nowPlayingTab`. `info` shows hero + `TransportControls` + `SeekBar` + flags; `queue` renders `QueueList scope="page"`.
- Destinations: `now-playing.run` sets tab `info` then navigates; `queue.run` sets tab `queue` then navigates on touch, else opens the queue overlay.

- [ ] **Step 1: Write the failing tests**

`ui.test.ts` additions:

```ts
it('defaults the now-playing tab to info and resets it', ...);
it('shows the requested now-playing tab', ...);
```

`NowPlayingScreen.test.ts`: mock `$lib/app.svelte` with `player`, `queue`, `ui.state.nowPlayingTab`, `favorites`, `resolver`, `settings`, `keyboard.registerAll`. Assert:

```ts
it('renders both segments and shows info by default', ...);
it('shows queue rows when the queue segment is selected', ...); // switch ui.state.nowPlayingTab='queue'
it('renders an empty state with no track', ...);
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/lib/stores/ui.test.ts tests/lib/components/NowPlayingScreen.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add the `UiStore` field/setter/reset. Implement `NowPlayingScreen` reusing `TransportControls`, `SeekBar`, `QueueList`, `CoverArt mode="auto"` (small columns on touch). In `App.svelte`, render `NowPlayingScreen` for the `now-playing` route when `shell === 'touch'`, else `NowPlayingPage`. Apply the destination `run` changes. Update `CommandPalette`/destination tests' app mocks to include `ui.showNowPlayingTab` and `capability` if the queue row is exercised.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run tests/lib/stores/ui.test.ts tests/lib/components/NowPlayingScreen.test.ts tests/lib/ui/destinations.test.ts tests/lib/components/CommandPalette.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stores/ui.svelte.ts src/lib/ui/destinations.ts src/lib/components/NowPlayingScreen.svelte src/App.svelte tests/lib/stores/ui.test.ts tests/lib/components/NowPlayingScreen.test.ts
git commit -m "feat(player): full-screen now playing with a queue segment"
```

---

# Phase 3 — Touch interactions and polish

### Task 8: longPress action + dropIndex helper

**Files:**
- Create: `src/lib/utils/press.ts`
- Test: `tests/lib/utils/press.test.ts`

**Interfaces:**
- `function longPress(node: HTMLElement, params: { onLongPress: () => void; delay?: number; slop?: number }): { update(p: typeof params): void; destroy(): void }` — touch/pen only; fires after `delay` (default 500ms); cancels on movement past `slop` (default 10px) or `pointercancel`; after firing, swallows the next `click` via a capture listener.
- `function dropIndex(clientY: number, rects: { top: number; bottom: number }[]): number` — nearest-row index for a drag.

- [ ] **Step 1: Write the failing test**

Use `vi.useFakeTimers()`. Assert:

```ts
it('fires after the delay on a touch pointer', ...);        // pointerdown, advance 500ms ⇒ called
it('cancels when the pointer moves past the slop', ...);    // pointerdown, pointermove +30px, advance ⇒ not called
it('ignores mouse pointers', ...);                          // pointerType 'mouse' ⇒ not called
it('swallows the click that follows a fired long-press', ...); // subsequent click event has defaultPrevented
it('returns the nearest row index for a drag position', ...);  // dropIndex(45, [{0,20},{20,40},{40,60}]) === 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/utils/press.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement `press.ts`**

Register `pointerdown` on the node; ignore `event.pointerType === 'mouse'`; start a timer; a `pointermove` beyond slop in either axis cancels; on fire, add a one-shot `window.addEventListener('click', h, { capture: true })` that calls `preventDefault()`/`stopPropagation()`. Clean up all listeners in `destroy`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run tests/lib/utils/press.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/press.ts tests/lib/utils/press.test.ts
git commit -m "feat(ui): add long-press action and drop-index helper"
```

---

### Task 9: ListView long-press and page wiring

**Files:**
- Modify: `src/lib/components/ListView.svelte`, and the pages listed below
- Test: `tests/lib/components/ListView.test.ts`

**Interfaces:**
- `ListView` props gain `onLongPress?: (item: T, index: number) => void`. On long-press the cursor moves to the row first, then the callback fires.

- [ ] **Step 1: Write the failing test**

Add to `ListView.test.ts`:

```ts
it('long-pressing a row moves the cursor and fires onLongPress', async () => {
  const onLongPress = vi.fn();
  const { cursor } = renderList({ onLongPress });
  const row = options()[1]!;
  row.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
  await vi.advanceTimersByTimeAsync(500);
  expect(onLongPress).toHaveBeenCalledWith(items[1], 1);
  expect(cursor.index).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/components/ListView.test.ts`
Expected: FAIL — `onLongPress` ignored.

- [ ] **Step 3: Implement and wire**

Apply `use:longPress` on both the virtualised and plain rows. Then add `onLongPress` next to `onActivate` in:

- `HomePage.svelte` (both lists) → `actions.openAlbumActions`
- `AlbumsPage.svelte`, `ListenLaterPage.svelte` → `actions.openAlbumActions`
- `AlbumPage.svelte`, `PlaylistPage.svelte` (tracks) → `actions.openTrackActions`
- `FavoritesPage.svelte` (artists/albums/tracks) → `openArtistActions`/`openAlbumActions`/`openTrackActions`
- `ArtistPage.svelte` (albums/tracks/similar) → the matching `actions.open*`
- `ArtistsPage.svelte` → `actions.openArtistActions`
- `SearchPage.svelte` → open the matching actions by `row.kind`

Leave `SettingsPage.svelte` untouched (its rows are settings, not media).

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm exec vitest run tests/lib/components/ListView.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ListView.svelte src/lib/pages tests/lib/components/ListView.test.ts
git commit -m "feat(ui): long-press a list row to open its actions"
```

---

### Task 10: Queue drag-reorder, remove and long-press

**Files:**
- Modify: `src/lib/components/QueueList.svelte`
- Test: `tests/lib/components/QueueOverlay.test.ts` (or a new `QueueList.test.ts` if the overlay harness is awkward)

**Interfaces:**
- Consumes: `dropIndex` (Task 8), `app.queue.move(from, to)`, `app.queue.remove([uid])`, `actions.openTrackActions`.
- Produces: each queue row gains a drag handle (`aria-label="reorder {title}"`), a remove button (`aria-label="remove {title}"`), and long-press → track actions. Existing click-to-play and keyboard bindings are unchanged.

- [ ] **Step 1: Write the failing test**

With a mocked `$lib/app.svelte` exposing `queue.items`, `queue.state.index`, and `queue.move`/`remove` as `vi.fn()`:

```ts
it('removes a row from its remove button', ...);      // remove([uid]) called
it('long-presses a row to open track actions', ...);  // actions.openTrackActions called
it('reorders via a drag handle drop', ...);           // pointer drag from row 0 to row 2 ⇒ queue.move(0, 2)
```

Also add a store-level test to `tests/lib/stores/queue.test.ts` pinning Review Focus 3:

```ts
it('keeps the playing item when it is moved', () => {
  const queue = new QueueStore({ persist: false });
  queue.set([t1, t2, t3], 1);          // t2 playing at index 1
  const uid = queue.current!.uid;
  queue.move(1, 2);
  expect(queue.current!.uid).toBe(uid);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/lib/stores/queue.test.ts tests/lib/components/QueueList.test.ts`
Expected: FAIL — no handle/remove markup.

- [ ] **Step 3: Implement**

Add the drag handle with `pointerdown`/`pointercapture`; compute the target via `dropIndex(clientY, rowRects)` and call `queue.move(from, target)`. Add the remove button calling `queue.remove([item.uid])`. Add `use:longPress` on the row for `actions.openTrackActions(item.track)`. Give the handle and remove button `min-height/min-width: 44px` under the touch shell.

- [ ] **Step 4: Run tests**

Run: `pnpm exec vitest run tests/lib/stores/queue.test.ts tests/lib/components/QueueList.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/QueueList.svelte tests/lib/components/QueueList.test.ts tests/lib/stores/queue.test.ts
git commit -m "feat(queue): touch reorder, remove and long-press actions"
```

---

### Task 11: ActionMenu on touch

**Files:**
- Modify: `src/lib/components/ActionMenu.svelte`
- Test: `tests/lib/components/ActionMenu.test.ts`

**Interfaces:**
- The `[key]` badge is rendered only when `app.capability.shell !== 'touch'`; rows get 44px touch height under the touch shell.

- [ ] **Step 1: Write the failing test**

Add to `ActionMenu.test.ts` (mock `app.capability`):

```ts
it('hides the key badges on a touch shell', ...);     // capability.shell='touch' ⇒ no '[p]' text
it('still shows the key badges on the terminal shell', ...);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/components/ActionMenu.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Wrap the badge in `{#if app.capability.shell !== 'touch'}` and add touch row sizing. Confirm the existing ActionMenu tests still pass (their mock will need a `capability` field — add `capability: { shell: 'terminal' }` to the mock).

- [ ] **Step 4: Run test**

Run: `pnpm exec vitest run tests/lib/components/ActionMenu.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/ActionMenu.svelte tests/lib/components/ActionMenu.test.ts
git commit -m "feat(ui): touch-friendly action menu"
```

---

### Task 12: Touch sizing and page reflow

**Files:**
- Modify: `src/app.css`, `src/lib/pages/SettingsPage.svelte`, `src/lib/pages/PlaylistPage.svelte`, `e2e/mobile.spec.ts`
- Test: `e2e/mobile.spec.ts`

**Interfaces:**
- `[data-shell='touch']` global rules: list rows `min-height: 44px`; hide the dense `.tech` column; larger tab padding.
- `SettingsPage` label grid (`10ch 1fr`) and `PlaylistPage` meta grid (`8ch 1fr`) collapse to one column below 640px.

- [ ] **Step 1: Write the failing e2e assertion**

Add to `e2e/mobile.spec.ts`:

```ts
test('list rows are large enough to tap', async ({ page }) => {
  await login(page);
  const row = page.locator('.row').first();
  const box = await row.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm e2e e2e/mobile.spec.ts`
Expected: FAIL — row height < 44 (unless a row is naturally taller; assert on a list page with tracks).

- [ ] **Step 3: Implement the CSS and the two breakpoints**

Add the `[data-shell='touch']` block to `app.css`; add `@media (max-width: 640px)` overrides to the two grid styles.

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm e2e e2e/mobile.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app.css src/lib/pages/SettingsPage.svelte src/lib/pages/PlaylistPage.svelte e2e/mobile.spec.ts
git commit -m "feat(shell): touch sizing and narrow-screen reflow"
```

---

### Task 13: Hardware back button

**Files:**
- Create: `src/lib/native/backButton.ts`
- Modify: `src/lib/app.svelte.ts` (add `handleBack()`), `src/main.ts`
- Test: `tests/lib/app.test.ts`

**Interfaces:**
- `App.handleBack(): boolean` — if an overlay is open, close it and return `true`; else return `router.back()`.
- `registerBackButton(opts: { onBack: () => boolean }): Promise<() => void>` — lazily imports `@capacitor/app`; returns a no-op when unavailable; on `backButton`, calls `onBack()`; if it returns false, calls the plugin's `exitApp()`.

- [ ] **Step 1: Write the failing test**

Add to `tests/lib/app.test.ts`:

```ts
it('closes an overlay before walking history', () => {
  const app = makeApp();
  app.ui.openOverlay('queue');
  expect(app.handleBack()).toBe(true);
  expect(app.ui.anyOverlayOpen).toBe(false);
});
it('returns false when there is no overlay and no history', () => {
  expect(makeApp().handleBack()).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/lib/app.test.ts`
Expected: FAIL — `handleBack` undefined.

- [ ] **Step 3: Implement**

Add `handleBack()` to `App`. Create `backButton.ts` using a dynamic `import('@capacitor/app')` guarded in `try/catch` (same lazy pattern as `offline/blobStore.ts`). Call `void registerBackButton({ onBack: () => app.handleBack() })` from `main.ts` after `app.start()`.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm exec vitest run tests/lib/app.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/native/backButton.ts src/lib/app.svelte.ts src/main.ts tests/lib/app.test.ts
git commit -m "feat(android): handle the hardware back button"
```

---

### Task 14: End-to-end coverage and docs

**Files:**
- Modify: `e2e/mobile.spec.ts`, `docs/ANDROID.md`
- Test: `e2e/mobile.spec.ts`

**Interfaces:**
- No new production interfaces.

- [ ] **Step 1: Write the failing tests**

Extend `e2e/mobile.spec.ts` (Pixel 7):

```ts
test('bottom nav navigates between sections', ...);      // tap albums/artists/home
test('mini-player opens the now-playing screen', ...);   // start playback, tap it, expect the queue segment
test('long-pressing a row opens its action menu', ...);  // pointer long-press on a track row
test('tapping the progress bar seeks', ...);             // click mid slider, assert aria-valuenow changes
```

Add a desktop guard (default project):

```ts
test('desktop has no bottom nav and keeps vim keys', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('navigation', { name: 'sections' })).toHaveCount(0);
  await page.keyboard.press('g'); await page.keyboard.press('a');
  await expect(page.locator('header')).toContainText('albums');
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm e2e`
Expected: FAIL on the new mobile cases.

- [ ] **Step 3: Implement any gaps, then document**

Fix whatever the tests surface. Update `docs/ANDROID.md`: replace the "not verified" back-button note with the implemented behavior, and add a short "touch shell" section (trigger, nav, mini-player, queue, gestures).

- [ ] **Step 4: Run the full gate**

Run: `pnpm verify && pnpm e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add e2e/mobile.spec.ts docs/ANDROID.md
git commit -m "test(android): cover the touch shell end to end"
```

---

## Self-Review

- **Spec coverage:** capability model (T1), `data-shell` (T1/T4), shell structure (T4), navigation + shared table (T2/T3), active-tab logic (T2/T3), back button (T13), BottomNav (T3), MiniPlayer (T6), NowPlayingScreen + segmented queue + `nowPlayingTab` (T7), TransportControls/SeekBar (T5), longPress (T8), ListView wiring (T9), queue drag/remove/long-press (T10), ActionMenu touch (T11), touch sizing + reflow (T12), reduced-motion/edge cases (covered by existing global CSS + T5/T7 tests), testing/rollout (all tasks), docs (T14). Every spec section maps to a task.
- **Step scan:** each step is one action; code blocks are the failing tests and short implementation notes, not transcripts.
- **Type consistency:** `CapabilityStore.shell`/`touch`, `Destination.nav.activeOn`, `UiStore.showNowPlayingTab`, `ListView.onLongPress`, `App.handleBack`, `dropIndex`, `registerBackButton` are used with the same names/shapes across tasks.
- **Review Focus:** (1) slop/scroll → T8 steps 1; (2) unknown duration → T5 step 1; (3) moving the playing row → T10 step 1; (4) shell/live flip → T1/T3/T4/T6/T7; (5) back priority → T13 step 1.
- **Proportion:** plan is longer than the spec but carries the decisions (files, signatures, test names) rather than full bodies.
