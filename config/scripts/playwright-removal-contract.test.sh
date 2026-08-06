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

# Keep this contract runnable in the slim Docker control image, which does not
# ship ripgrep. The fallback preserves path/glob filtering instead of treating
# a missing scanner as a passing no-match assertion.
scan_matches() {
  local pattern="$1"
  shift
  if command -v rg >/dev/null 2>&1; then
    rg -n "$pattern" "$@"
    return
  fi

  local paths=()
  local includes=()
  local excludes=()
  while test "$#" -gt 0; do
    if test "$1" = '--glob'; then
      if test "$#" -lt 2; then
        echo "scan_matches: --glob requires a pattern" >&2
        return 2
      fi
      case "$2" in
        !*) excludes+=("${2#!}") ;;
        *) includes+=("$2") ;;
      esac
      shift 2
    else
      paths+=("$1")
      shift
    fi
  done

  local matched=1
  local path file include exclude glob
  for path in "${paths[@]}"; do
    if test -f "$path"; then
      local files=("$path")
    elif test -d "$path"; then
      local files=()
      mapfile -d '' files < <(find "$path" -type f -print0)
    else
      continue
    fi
    for file in "${files[@]}"; do
      include=1
      if test "${#includes[@]}" -gt 0; then
        include=0
        for glob in "${includes[@]}"; do
          case "$glob" in
            '*.{ts,tsx,css}')
              case "$file" in *.ts|*.tsx|*.css) include=1; break ;; esac
              ;;
            *.mjs|*.ts|*.tsx|*.js|*.css|global-setup.ts|global-teardown.ts)
              case "$file" in $glob) include=1; break ;; esac
              ;;
          esac
        done
      fi
      test "$include" -eq 1 || continue
      for exclude in "${excludes[@]}"; do
        case "$file" in
          $exclude) include=0; break ;;
        esac
      done
      test "$include" -eq 1 || continue
      if grep -n -E "$pattern" "$file"; then
        matched=0
      fi
    done
  done
  return "$matched"
}

assert_no_matches() {
  local label="$1"
  local pattern="$2"
  shift 2
  if scan_matches "$pattern" "$@" >/dev/null 2>&1; then
    echo "not ok - $label"
    scan_matches "$pattern" "$@" | head -20
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

# Scope orphan checks to files retired by the Playwright cleanup; generic unit
# import closure belongs to the broader Phase 2 contracts.
assert_no_matches "no orphan Docker SSH relay imports remain" \
  'docker-ssh-relay-target' "$root/tests/e2e" --glob '*.{ts,tsx}'
assert_no_matches "no orphan Codex validation layout imports remain" \
  'codex-real-account-validation-layout' "$root/config/scripts" --glob '*.mjs'

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
