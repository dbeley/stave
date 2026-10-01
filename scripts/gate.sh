#!/usr/bin/env bash
#
# The full local gate: format, verify (lint + types + tests + build), coverage,
# e2e. Stops at the first failure and shows that step's log.
#
# Why every step's exit code is checked by hand instead of piping it into grep:
#
#     pnpm verify 2>&1 | grep -E "..." | head -12
#
# A pipeline exits with the status of its LAST command, so `head` returns 0 even
# when `pnpm verify` failed. Under `set -e` that failure never fires, the output
# still reads like a tidy summary, and a commit carrying a type error and a
# failing test goes out looking verified. So: run the step, check its status,
# and only then grep its log for something readable.
#
# This verifies; it never commits or pushes.
#
# Usage (from the dev shell, which provides pnpm and the Playwright browsers):
#     nix develop        # or: just gate
#     just gate

set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

export PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS=1

if ! command -v pnpm >/dev/null 2>&1; then
  echo "gate: pnpm not found — run this from the dev shell (nix develop, then: just gate)" >&2
  exit 127
fi

LOGS="${TMPDIR:-/tmp}"

# step <name> <logfile> <command...>
step() {
  local name="$1" log="$2"
  shift 2
  if ! "$@" >"$log" 2>&1; then
    echo "### $name FAILED — tail of $log"
    tail -40 "$log"
    exit 1
  fi
  echo "### $name ok"
}

step prettier "${LOGS}/stave-gate-prettier.log" pnpm exec prettier --write src tests e2e README.md docs
step verify "${LOGS}/stave-gate-verify.log" pnpm verify
grep -E "svelte-check found|Test Files|Tests |built in" "${LOGS}/stave-gate-verify.log" | head -8

step coverage "${LOGS}/stave-gate-coverage.log" pnpm test:coverage
grep -E "All files" "${LOGS}/stave-gate-coverage.log"

step e2e "${LOGS}/stave-gate-e2e.log" pnpm exec playwright test
tail -3 "${LOGS}/stave-gate-e2e.log"

echo
echo "gate: all steps passed"
