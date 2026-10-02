#!/usr/bin/env bash
#
# Splice the release-signing configuration into the generated Android project.
#
# `android/` is produced by `cap add android` / `cap sync` and is therefore
# git-ignored, so the signing configuration cannot live inside it — a regeneration
# would silently drop it and you would publish an uninstallable APK again. It lives
# in scripts/android/signing.gradle and is appended here, idempotently.
#
# Run by `just android-release` / `just android-bundle`; harmless to run twice.
set -euo pipefail

REPO="$(git rev-parse --show-toplevel)"
GRADLE="$REPO/android/app/build.gradle"
MARKER="scripts/android/signing.gradle"
# Path from android/app/build.gradle to the fragment — a Gradle `apply from` is
# relative to the applying file, and the fragment lives outside the generated tree.
FROM="../../scripts/android/signing.gradle"

if [ ! -f "$GRADLE" ]; then
  echo "android/app/build.gradle not found — run 'pnpm exec cap add android' first" >&2
  exit 1
fi

# Already applied? (Gradle's `apply from` is the marker, so a re-`cap sync` that
# keeps our line does not get a second copy.)
if grep -qF "$MARKER" "$GRADLE"; then
  echo "release signing already applied to android/app/build.gradle"
  exit 0
fi

# A real block, not the word in a comment — the previous version of this check used
# `grep -q signingConfigs`, which matched its own explanatory comment and refused to
# apply anything, leaving the build unsigned while reporting success.
if grep -qE '^[[:space:]]*signingConfigs[[:space:]]*\{' "$GRADLE"; then
  echo "android/app/build.gradle already declares signingConfigs; leaving it alone"
  exit 0
fi

printf '\n// Release signing, kept outside the generated tree: see scripts/android/signing.gradle\napply from: "%s"\n' "$FROM" >>"$GRADLE"

echo "applied release signing to android/app/build.gradle"
