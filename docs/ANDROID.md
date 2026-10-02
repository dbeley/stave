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
(`apksigner verify` → *Missing META-INF/MANIFEST.MF* — measured on a real 3.2 MB
build). Two consequences shaped how this repo handles it:

- the release recipes splice in a signing configuration (below), so the artifact
  becomes `app-release.apk` and verifies;
- `just release` attaches **only** that signed file. An unsigned APK looks like a
  plausible download and is useless, so it is never published.

Caveat worth knowing: because `android/` is regenerated, this repo needs the
signing configuration to live *outside* it — a change inside `android/` would be
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

## Background playback — current state and what is left

Implemented:

- `<audio>` playback with `MediaSession` metadata (title/artist/album/cover) and
  action handlers (`play`, `pause`, `nexttrack`, `previoustrack`, `seekto`), so
  the OS shows the track and the transport controls work from the lock screen,
  the notification shade and Bluetooth/head-unit buttons.
- Playback state and position are kept in sync with the session.

**Not yet implemented — be aware of the limitation:** a WebView pauses its audio
when the app is backgrounded, and Android needs a **foreground service** for
genuinely uninterrupted background playback. `MediaSession` alone gives the
controls and metadata but does not hold the audio alive. The honest options,
in increasing order of effort:

1. Keep the screen on while playing (`@capacitor-community/keep-awake`), which
   covers short listens but is not a real fix.
2. Add a maintained Capacitor audio plugin that runs a foreground service and
   owns the audio session; then point `AudioPort` (`src/lib/player/player.svelte.ts`)
   at it — the port exists precisely so the player does not care which engine
   produces sound.
3. Write a small native plugin (Media3/ExoPlayer + `MediaSessionService` + the
   existing JS `MediaSession` bridge). Best quality, most work.

Because `PlayerStore` takes its `AudioPort` by injection, option 2 or 3 is a
change to `createHtmlAudio`'s replacement plus a Capacitor dependency — no page
or store code has to change. The `docs/ARCHITECTURE.md` "injected dependencies"
note explains why this is a small change rather than a rewrite.

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

Not verified on hardware: whether Android's hardware **back** button walks the
route history. The router listens for `hashchange` and mutations of it (`navigate`)
do push history, so it should; it needs a device to confirm.
