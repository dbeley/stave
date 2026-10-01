# Android notes

The Android app is the same Svelte build, wrapped by Capacitor 8 and built with
Gradle/JDK 21 — all supplied by the flake dev shell.

## Building

```sh
nix develop                 # JDK 21, android-tools, patchelf, Node, pnpm
just android-sync           # build the web assets, add the platform, cap sync
just android-build          # debug APK
just android-release        # release APK
just android-bundle         # release AAB
```

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

Set these before `just android-release`; without them Gradle produces an
unsigned artifact:

```sh
export ANDROID_KEYSTORE_PATH=/path/to/release.jks
export ANDROID_KEYSTORE_PASSWORD=…
export ANDROID_KEY_ALIAS=…
export ANDROID_KEY_PASSWORD=…
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
