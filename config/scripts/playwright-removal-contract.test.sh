#!/usr/bin/env bash
set -u

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
failures=0

pass_absent() {
  local label="$1"
  shift
  if test "$#" -eq 0; then
    echo "ok - $label"
    return
  fi
  echo "not ok - $label: $*"
  failures=$((failures + 1))
}

assert_absent() {
  local label="$1"
  shift
  if test ! -e "$root/$1"; then
    pass_absent "$label"
  else
    echo "not ok - $label: $1 exists"
    failures=$((failures + 1))
  fi
}

assert_no_matches() {
  local label="$1"
  local pattern="$2"
  shift 2
  if rg -n "$pattern" "$@" >/dev/null 2>&1; then
    echo "not ok - $label"
    rg -n "$pattern" "$@" | head -20
    failures=$((failures + 1))
  else
    pass_absent "$label"
  fi
}

assert_absent "Playwright runner config removed" tests/playwright.config.ts
assert_absent "Playwright characterization rules removed" config/characterization/playwright-contract-rules.json
assert_absent "Playwright characterization intents removed" config/characterization/playwright-intent-rules.json
assert_absent "Playwright characterization overrides removed" config/characterization/playwright-intent-overrides.json

assert_no_matches "package scripts and direct devDependencies contain no Playwright" \
  'playwright|@stablyai/playwright-test' "$root/package.json"
assert_no_matches "executable source has no direct Playwright imports" \
  '@playwright/test|@stablyai/playwright-test' \
  "$root/config/scripts" "$root/tools" "$root/tests/e2e" \
  --glob '*.mjs' --glob '*.ts' --glob '*.js' \
  --glob '!playwright-removal-contract.test.sh'
assert_no_matches "lockfile has no removed Playwright packages" \
  '@playwright/test|@stablyai/playwright-test|^  playwright(@|-)|^  playwright-core@' \
  "$root/pnpm-lock.yaml"
assert_no_matches "Playwright specs and lifecycle hooks are gone" \
  '.*' "$root/tests/e2e" --glob '*.spec.ts' --glob 'global-setup.ts' --glob 'global-teardown.ts'
assert_absent "Playwright ignore rule removed" tests/.gitignore

if test ! -e "$root/tests/e2e/vitest.config.ts" && test ! -e "$root/tests/e2e/computer-linux.e2e.ts"; then
  pass_absent "Vitest computer E2E surface removed"
else
  echo "not ok - Vitest computer E2E surface retained"
  failures=$((failures + 1))
fi

if test "$failures" -eq 0; then
  echo "PASS: Playwright removal contract"
else
  echo "FAIL: $failures structural assertion(s)"
  exit 1
fi
