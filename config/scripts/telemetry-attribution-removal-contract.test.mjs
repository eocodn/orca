import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

assert.ok(!read('package.json').includes('posthog-node'), 'PostHog dependency must be removed')
assert.ok(
  !read('src/main/telemetry/client.ts').includes('posthog'),
  'external telemetry transport must be removed'
)
assert.ok(
  !existsSync(resolve(root, 'src/main/attribution/terminal-attribution.ts')),
  'terminal attribution shims must be removed'
)
assert.ok(
  !existsSync(resolve(root, 'src/main/attribution/terminal-attribution-posix-shims.ts')),
  'POSIX attribution shim must be removed'
)
assert.ok(
  !existsSync(resolve(root, 'src/main/attribution/terminal-attribution-windows-shims.ts')),
  'Windows attribution shim must be removed'
)

for (const workflow of [
  '.github/workflows/release-mac-build.yml',
  '.github/workflows/release-cut.yml'
]) {
  const contents = read(workflow)
  assert.ok(
    !contents.includes('ORCA_POSTHOG_WRITE_KEY'),
    `${workflow} must not inject PostHog keys`
  )
  assert.ok(
    !contents.includes('verify-telemetry-constants'),
    `${workflow} must not verify telemetry constants`
  )
}

for (const path of [
  'src/renderer/src/app-shell-page-renderer.tsx',
  'src/renderer/src/app-shell-page-startup-effects.ts'
]) {
  assert.ok(
    !read(path).includes('TelemetryFirstLaunchSurface'),
    `${path} must not mount telemetry first-launch UI`
  )
}

assert.ok(
  !read('src/renderer/src/components/settings/GitPane.tsx').includes('enableGitHubAttribution'),
  'Git attribution setting must be removed'
)
console.log('telemetry-attribution-removal-contract: 10 assertions passed')
