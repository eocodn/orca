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
assert_no_matches "mobile package scripts and direct dependencies contain no Playwright" \
  'playwright|@stablyai/playwright-test' "$root/mobile/package.json"
assert_no_matches "executable source has no direct Playwright imports" \
  '@playwright/test|@stablyai/playwright-test' \
  "$root/config/scripts" "$root/tools" "$root/tests/e2e" \
  --glob '*.mjs' --glob '*.ts' --glob '*.js' \
  --glob '!playwright-removal-contract.test.sh'
assert_no_matches "lockfile has no removed Playwright packages" \
  '@playwright/test|@stablyai/playwright-test|^  playwright(@|-)|^  playwright-core@' \
  "$root/pnpm-lock.yaml"
assert_no_matches "mobile lockfile has no removed Playwright packages" \
  '@playwright/test|@stablyai/playwright-test|^  playwright(@|-)|^  playwright-core@' \
  "$root/mobile/pnpm-lock.yaml"
assert_no_matches "Playwright specs and lifecycle hooks are gone" \
  '.*' "$root/tests/e2e" --glob '*.spec.ts' --glob 'global-setup.ts' --glob 'global-teardown.ts'
assert_absent "Playwright ignore rule removed" tests/.gitignore

assert_no_matches "production and feature-wall sources contain no Playwright surface" \
  'playwright|Playwright|test:e2e|PlaywrightPane|RUN_QUEUE' \
  "$root/src" --glob '*.{ts,tsx,css}' \
  --glob '!**/*.test.ts' --glob '!**/*.test.tsx' \
  --glob '!playwright-removal-contract.test.sh'
assert_no_matches "feature-wall sources contain no stale spec paths" \
  '\.spec\.ts' "$root/src/renderer/src/components/feature-wall" --glob '*.{ts,tsx,css}'
assert_no_matches "reliability gates contain no retired browser commands or specs" \
  'playwright|Playwright|test:e2e|tests/playwright\.config\.ts|\.spec\.ts|ssh-port-forward-snapshot-barrier\.unit\.test\.ts' \
  "$root/config/reliability-gates.jsonc"

for locale in en es ja ko zh; do
  locale_file="$root/src/renderer/src/i18n/locales/$locale.json"
  if test -e "$locale_file"; then
    assert_no_matches "$locale locale has no retired feature-wall copy" \
      'FeatureTourPreview\.(6ed43cb0e0|24fedd5a52|8279e9d95b|6218a9014d)|WorkbenchAnimatedVisual\.(defe550fe2|3261c6853b|5c5cbd783f|623881d72e|944199e54a|7d9f1d5f7d|0b20782e0f|4371cc9931)' \
      "$locale_file"
  fi
done

assert_no_matches "locale override map has no retired feature-wall copy" \
  'FeatureTourPreview\.(6ed43cb0e0|24fedd5a52|8279e9d95b|6218a9014d)|WorkbenchAnimatedVisual\.(defe550fe2|3261c6853b|5c5cbd783f|623881d72e|944199e54a|7d9f1d5f7d|0b20782e0f|4371cc9931)' \
  "$root/config/scripts/locale-ko-key-overrides.json"

assert_no_matches "stale seeded and raster tooling is removed" \
  'seeded-test-repo|terminal-cursor-raster-probe|terminal-raster-artifact-analysis|win-update-e2e|win-crash-survival-e2e' \
  "$root/tests/e2e" "$root/tools" --glob '*.{ts,tsx,mjs,js,md}'

# Keep generic Vitest unit fixtures, but reject broken relative imports in them.
while IFS= read -r unit_file; do
  while IFS= read -r import_spec; do
    import_path="$(dirname "$unit_file")/$import_spec"
    resolved=0
    for candidate in "$import_path" "$import_path.ts" "$import_path.tsx" "$import_path.js" "$import_path.mjs" "$import_path.cjs" "$import_path/index.ts"; do
      if test -e "$candidate"; then
        resolved=1
        break
      fi
    done
    if test "$resolved" -eq 0; then
      echo "not ok - unit test import resolves: $unit_file -> $import_spec"
      failures=$((failures + 1))
    fi
  done < <(rg -o "['\"]\.\.?/[^'\"]+" "$unit_file" | sed -E "s/^['\"]//")
done < <(find "$root/tests/e2e" -type f -name '*.unit.test.ts' -print)

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
