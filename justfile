# stave — task runner
# Everything is available through `just`; the dev shell provides the tools.

set shell := ["bash", "-euo", "pipefail", "-c"]
set dotenv-load := false

version := `node -p "require('./package.json').version"`

default:
    @just --list --unsorted

# ---------------------------------------------------------------- development

# Start the Vite dev server
dev:
    pnpm dev

# Production build into dist/
build:
    pnpm build

# Preview the production build
preview:
    pnpm build && pnpm preview

# Run the unit + component test suite
test:
    pnpm test

# Tests in watch mode
test-watch:
    pnpm test:watch

# Tests with a coverage report (HTML in coverage/)
coverage:
    pnpm test:coverage

# End-to-end tests against the mock Subsonic server (Playwright)
e2e:
    pnpm exec playwright test

# Integration tests against a REAL Subsonic server (start `just navidrome` first)
interop:
    STAVE_IT=1 pnpm vitest run tests/interop

# Prettier
format:
    pnpm format

# Everything a reviewer cares about: format + lint + types + tests + build
verify:
    pnpm verify

# The full local gate: format, verify, coverage, e2e — the thing to run before
# pushing. Every step's exit code is checked explicitly; piping a step into
# grep/head would hide its failure behind the pipe's status again.
gate:
    bash scripts/gate.sh

# Type-check Svelte + TS only
typecheck:
    pnpm typecheck

# --------------------------------------------------------------- dev backend

# Generate the royalty-free demo library (default: testdata/music)
seed-library dir="testdata/music":
    nix run .#seed-library -- {{dir}}

# Run a throwaway Navidrome on the demo library (http://127.0.0.1:4533)
navidrome dir="testdata/music":
    nix run .#dev-navidrome -- {{dir}}

# Run the mock Subsonic server (default: http://127.0.0.1:4534)
mock dir="testdata/music" port="4534":
    nix run .#mock-server -- --music {{dir}} --port {{port}}

# Seed the demo library and start Navidrome on it
backend: seed-library
    nix run .#dev-navidrome -- testdata/music

# -------------------------------------------------------------------- android

android-sync:
    pnpm android:sync

android-build:
    pnpm android:build

android-release:
    pnpm android:release

android-bundle:
    pnpm android:bundle

# ------------------------------------------------------------------------ nix

# Build the SPA with Nix
nix-build:
    nix build .#default

# Build everything and evaluate the flake's checks (tests, NixOS modules)
nix-check:
    nix flake check --keep-going --print-build-logs

# Recompute the pnpmDeps hash after dependency changes
nix-hash:
    #!/usr/bin/env bash
    set -uo pipefail
    out=$(nix build .#default --no-link --print-build-logs 2>&1 || true)
    echo "$out" | grep -oE 'got: +sha256-[A-Za-z0-9+/=]+' | head -1 | sed 's/got: */hash = "/; s/$/";/' || true
    echo "↑ paste into flake.nix (pnpmDeps.hash)"

# Format all .nix files
nix-format:
    nixfmt $(git ls-files '*.nix')

# Lint the Nix code
nix-lint:
    statix check .
    deadnix --fail .

# ------------------------------------------------------------------ dependencies

# Update npm dependencies (respecting semver ranges) and refresh the lockfile
deps-update:
    pnpm update
    pnpm install --lockfile-only

# Update npm dependencies to the newest published versions, then refresh nix
deps-update-latest:
    pnpm update --latest
    pnpm install --lockfile-only
    nix flake update
    @just nix-hash

# Update only the flake inputs (nixpkgs etc.)
deps-update-nix:
    nix flake update
    @just nix-hash

# Show outdated npm packages and nix inputs
deps-outdated:
    pnpm outdated || true
    nix flake metadata --json | jq -r '.locks.nodes | to_entries[] | select(.value.locked) | "\(.key) \(.value.locked.lastModified|todate)"' 2>/dev/null || true

# ---------------------------------------------------------------------- release

# Bump the version everywhere (package.json, Android, flake reads package.json)
bump v:
    node scripts/bump-version.mjs {{v}}

# Bump, commit, tag, build artifacts and publish a GitHub release.
#
# Includes the release APK when one exists — but only a *signed* one: an
# unsigned app-release-unsigned.apk looks like a plausible artifact and cannot be
# installed at all ("Missing META-INF/MANIFEST.MF"), so it is never published.
# Build it first with `just android-release` (see scripts/android-keystore.sh for
# the signing key), otherwise the release carries the web bundle alone.
#
# Only the files the bump actually touches are staged, never `git add -A`: that
# swept a local .direnv cache (2300 lines of absolute /nix/store paths) into a
# release commit, and the same mistake once committed the whole generated android/
# platform. A release commit should contain the version bump, nothing else.
release v:
    #!/usr/bin/env bash
    set -euo pipefail
    just bump {{v}}
    just verify
    git add package.json android/variables.gradle flake.nix 2>/dev/null || true
    # `bump` may touch other tracked files; stage exactly what it changed.
    git diff --name-only --diff-filter=M -z | xargs -0 -r git add --
    if git diff --cached --quiet; then
      echo "nothing to commit — is the version already {{v}}?" >&2
      exit 1
    fi
    git commit -m "chore(release): v{{v}}"
    git tag -a "v{{v}}" -m "stave v{{v}}"
    git push origin HEAD
    git push origin "v{{v}}"
    just build
    tar -czf "stave-{{v}}-dist.tar.gz" -C dist .
    files=(stave-{{v}}-dist.tar.gz)
    # `[ -f ]`, not `compgen -G`: compgen is a bash builtin that some builds
    # (the Nix dev shell's bash) omit, and with `set -e` a missing builtin makes
    # the `if` false and silently drops the APK from the release.
    if [ -f "android/app/build/outputs/apk/release/app-release.apk" ]; then
      files+=(android/app/build/outputs/apk/release/app-release.apk)
      echo "including the signed release APK"
    elif [ -f "android/app/build/outputs/apk/release/app-release-unsigned.apk" ]; then
      echo "WARNING: found only app-release-unsigned.apk — it cannot be installed," >&2
      echo "         so it is NOT being attached. Sign it (scripts/android-keystore.sh)" >&2
      echo "         and re-run, or the release will carry the web bundle only." >&2
    fi
    gh release create "v{{v}}" "${files[@]}" --generate-notes --title "v{{v}}"

# Create the GitHub repository and push (one-off; needs gh auth)
gh-init name="stave":
    #!/usr/bin/env bash
    set -euo pipefail
    gh repo create {{name}} --public --source=. --remote=origin \
      --description "TUI-inspired Subsonic/Navidrome music client — PWA + Android" \
      --push

# -------------------------------------------------------------------- housekeeping

# Remove build outputs and caches
clean:
    rm -rf dist coverage node_modules/.vite .vite
    rm -rf android/app/build android/build

# Deep clean (including node_modules); run `pnpm install` afterwards
distclean: clean
    rm -rf node_modules testdata devdata

# Show the toolchain versions in use
doctor:
    node --version
    pnpm --version
    nix --version
    java -version 2>&1 | head -1 || true
