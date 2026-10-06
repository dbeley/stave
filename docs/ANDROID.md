# Android notes

The Android app is the same Svelte build, wrapped by Capacitor 8 and built with
Gradle/JDK 21 — all supplied by the flake dev shell.

## Building

```sh
nix develop                 # JDK 21, android-tools, patchelf, Node, pnpm
pnpm exec cap add android   # once per clone: android/ is git-ignored
just android-sync           # build the web assets, cap sync
just android-build          # debug APK (signed with the debug key)
just android-release        # release APK (needs a keystore — see below)
just android-bundle         # release AAB
```

`android/` is **not** in the repository: Capacitor regenerates it, so a fresh clone
must run `cap add android` once before any of the Gradle recipes work.

Outputs land in `android/app/build/outputs/{apk,bundle}/`.

### What the scripts do

`just android-build` is `pnpm build && cap sync android && sh scripts/patch-aapt2.sh && cd android && ./gradlew assembleDebug`.

The `patch-aapt2.sh` step matters **only on NixOS**: `aapt2` ships as a
glibc-linked prebuilt binary whose interpreter path does not exist on Nix, so
resource compilation fails with a confusing error. The script rewrites its
interpreter and rpath with `patchelf`. It is a no-op elsewhere.

On first run the SDK is downloaded into `./android-sdk` (git-ignored) unless
`ANDROID_HOME` is already set; the dev shell writes `android/local.properties`
and accepts the SDK licences so Gradle can find it.

### Signing a release

**Capacitor's template does not sign release builds.** Left alone, `assembleRelease`
produces `app-release-unsigned.apk`, which Android refuses to install
(`apksigner verify` → _Missing META-INF/MANIFEST.MF_ — measured on a real 3.2 MB
build). Two consequences shaped how this repo handles it:

- the release recipes splice in a signing configuration (below), so the artifact
  becomes `app-release.apk` and verifies;
- `just release` attaches **only** that signed file. An unsigned APK looks like a
  plausible download and is useless, so it is never published.

Caveat worth knowing: because `android/` is regenerated, this repo needs the
signing configuration to live _outside_ it — a change inside `android/` would be
lost on the next `cap sync`. It lives in `scripts/android/signing.gradle`, and
`scripts/android-sign-setup.sh` appends `apply from:` to the generated
`android/app/build.gradle`. `pnpm android:release` runs that automatically.

Create a key once:

```sh
nix develop
scripts/android-keystore.sh ~/keys/stave-release.jks   # writes android/keystore.properties
$EDITOR android/keystore.properties                    # put in the real passwords
just android-release                                   # -> app-release.apk (signed)
```

Or skip the properties file and pass everything through the environment:

```sh
export ANDROID_KEYSTORE_PATH=~/keys/stave-release.jks
export ANDROID_KEYSTORE_PASSWORD=…
export ANDROID_KEY_ALIAS=…
export ANDROID_KEY_PASSWORD=…
just android-release
```

Both `android/keystore.properties` and `*.jks` are git-ignored — keep the keystore
out of the repository. **Back it up:** it is the app's identity, and Android refuses
to update an installed app whose signature changed, so losing the key means users
must uninstall before they can update.

A debug APK (`just android-build`) needs none of this; it is signed with the debug
key automatically and is what CI produces.

Check what you built before shipping it:

```sh
apksigner verify --print-certs android/app/build/outputs/apk/release/app-release.apk
```

`just bump <version>` updates `versionName` and derives `versionCode` as
`major*10000 + minor*100 + patch`, so `just release 0.2.0` keeps the web app,
the flake and the APK in step.

## Configuration choices

- **`androidScheme: 'http'`** — a plain-http scheme so the WebView can talk to a
  Subsonic server on your LAN without mixed-content blocking. A **HTTPS origin
  is strongly preferred**; put the server behind TLS (and serve the app from
  HTTPS) when you can, or the credentials and audio travel in the clear.
- **`allowMixedContent: true`** — same reason as above (http audio from an https
  page).
- **`CapacitorHttp` is deliberately left disabled.** Streaming (and the offline
  download) use `<audio>`/`fetch` with **range requests**; CapacitorHttp
  replaces `window.fetch` and does not preserve that behaviour, which breaks
  seeking.
- **Edge-to-edge / safe-area insets.** Android 15+ (the app targets SDK 36)
  forces the WebView to draw underneath the status and navigation bars, so the
  app's own top `StatusBar` and bottom `HintBar` were being overlapped. The core
  `SystemBars` plugin is configured (`insetsHandling: 'css'`,
  `initialViewportFitValueHint: 'cover'`) to feed the insets, and the two bars
  pad themselves with `env(safe-area-inset-*)` so their background extends under
  the system bars while their content clears them. The legacy `StatusBar`
  plugin is kept for Android <= 14, where it can still set the bar colour; on
  15+ the colour is ignored by the OS.
- CORS: the browser (and the WebView) fetch the Subsonic API directly, so the
  server must allow the app's origin. Navidrome does by default; if you front it
  with a proxy, forward `Access-Control-Allow-Origin`.

## Background playback and the media notification

The Android WebView implements **no part** of the Web Media Session API, so
`navigator.mediaSession` — the thing that gives you controls in Zen — is a silent
no-op there. That is why the Android build had no notification and no lock-screen
controls, and it is also why playback died when the app went to the background:
with nothing holding the process, Android suspends the WebView, its timers
throttle and the audio stops.

Both are one fix: `@capgo/capacitor-media-session`. It publishes metadata and
action handlers through a native `MediaSession`, and it runs a **`mediaPlayback`
foreground service** for as long as the session is playing or paused — the
service is what keeps the process, and therefore the WebView and its audio, alive.

How it is wired:

- `NativeMediaSession` (`src/lib/player/mediaSession.ts`) implements the existing
  `MediaSessionPort` by delegating to the plugin, so there is still one port with
  two backends: the browser keeps `BrowserMediaSession`, Android gets the native
  one. `defaultMediaSession()` in `src/lib/app.svelte.ts` picks between them.
- `FOREGROUND_SERVICE_MEDIA_PLAYBACK` is declared by
  `scripts/android-media-session.sh`, which the Android recipes run right after
  `cap sync`. `android/` is generated and git-ignored, so this cannot be a hand
  edit — a regeneration would drop it and the failure only shows up on a device.
  The plugin declares its own service and `FOREGROUND_SERVICE`, but not this
  permission, and without it starting a `mediaPlayback` service throws
  `SecurityException` on Android 14+.
- No plugin configuration is set, deliberately. Its default — start the service
  when playback starts, stop it when the session goes idle — is what we want: the
  notification appears when you press play and disappears when you stop, rather
  than leaving a permanent "playing" entry in the shade. (`foregroundService:
'always'` is the alternative if a persistent service is ever needed.)

**What this does not fix.** The service keeps the _process_ alive; it does not
stop Android from throttling the WebView's JavaScript once the app has been
backgrounded for a while. If that bites, the symptoms are a stale progress
indicator and a track that ends without the next one starting. The fix for that is
to move playback itself off the WebView — a native engine (Media3/ExoPlayer)
behind the same injected `AudioPort` — which is a larger change and only worth it
if the throttling actually shows up on your device.

**Verification status.** The build, the spliced permission, the merged manifest
and the assembled APK are checked mechanically (see the `android:release` recipe).
On-device behaviour cannot be checked from here — no device — so the notification
and the background behaviour need one confirmation on a real phone.

## Navigating without a keyboard

Every destination in this app is a keyboard chord (`g h`, `g a`, `g r`, …), which
a phone does not have. Before the palette existed, the only reachable flow on
Android was the one you started in — home → album → artist — and search,
playlists, favourites, listen later and settings were **unreachable**, including
settings, where the offline cache and theme live.

So there is one deliberately touch-shaped affordance: the **`[:]` chip in the
status bar** (left cluster, where a narrow screen cannot clip it). Tapping it
opens the "go to" palette (`src/lib/components/CommandPalette.svelte`) listing
every destination as a button with a comfortable hit area. The same palette opens
with `:` on a keyboard, and each row also has a mnemonic (`h`, `a`, `r`, `p`,
`f`, `l`, `/`, `Q`, `?`, `s`) that matches its `g`-chord, so muscle memory
transfers in both directions.

Everything else on touch already worked: rows open their page, the album toolbar
and the now-playing transport are buttons, and overlays close when you tap the
backdrop.

Two related details:

- The hint bar is hidden on coarse pointers (`matchMedia('(pointer: coarse)')`)
  because it names keys that do not exist there; the message line stays, since it
  is the only place transient feedback appears. The `keyHints` setting still
  controls it on a desktop. A Bluetooth keyboard works regardless — it just does
  not bring the hints back.
- The status bar drops the version and clock below 640px so the route and the
  `[:]` chip survive its `overflow: hidden`.

The hardware **back** button is wired in `src/main.ts` →
`registerBackButton` (`src/lib/native/backButton.ts`) → `app.handleBack()`. It
closes any open overlay first (overlays are modal), then walks the router's
in-app history one entry at a time; when there is nothing left it returns
`false` and the plugin lets the OS exit the app. `@capacitor/app` is imported
lazily so the web/PWA build and the test suite never depend on the native
runtime — there it degrades to a no-op and the PWA's own history is untouched.
The overlay-before-history priority is unit tested in `tests/lib/app.test.ts`;
the plugin bridge itself still wants a real device to confirm end to end.

## The touch shell

On a coarse pointer (`matchMedia('(pointer: coarse)')`, true on any phone or
tablet touchscreen) the app swaps its terminal chrome for a touch shell — the
same routes, data and keyboard bindings, but a different set of affordances.
`CapabilityStore.shell` (`src/lib/stores/capability.svelte.ts`) is the single
source of truth; `App.svelte` puts `data-shell="touch"` on `<html>` so CSS can
react, and it re-reads the media query on change, so plugging a mouse into an
Android device flips back to the terminal.

- **Bottom nav.** `BottomNav.svelte` renders a home/albums/artists/now-playing
  tab bar, generated from the same destination table as the `:` palette, so the
  two cannot drift. The active tab follows the current route.
- **Mini-player.** Where the desktop has the dense one-line now-playing bar,
  touch gets `MiniPlayer.svelte`: a real image thumb, a two-line title/artist
  and thumb-sized transport targets, plus a thin seek line. It renders only
  while a track is loaded; its body opens the full now-playing screen.
- **Now-playing screen.** `NowPlayingScreen.svelte` is a full-height screen with
  a `[now playing | queue]` segmented control instead of the terminal's
  two-column layout, so the queue is never squeezed off-screen on a phone. The
  queue segment shows the shared `QueueList` — the same component the desktop
  queue window uses — so queue behaviour cannot drift.
- **Gestures.** A long-press on any list row opens its action menu (the same
  menu the `o` key opens); a drag on the queue's `≡` handle reorders, and `✕`
  removes. The progress bar is a slider: tapping or dragging it seeks.

This is covered end to end by `e2e/mobile.spec.ts` on a Pixel 7 viewport, with a
desktop counter-guard in the same file proving the terminal shell keeps its
keyboard layout (no bottom nav, `g a` still reaches albums).
