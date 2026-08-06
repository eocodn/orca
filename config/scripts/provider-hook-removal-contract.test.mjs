import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// Provider hook/status adapters are retired. Generic PTY, TUI profiles, OSC
// status, plugin/MCP lifecycle, and provider config/env resolvers remain.
const removedDirectories = [
  'src/main/amp',
  'src/main/antigravity',
  'src/main/claude',
  'src/main/command-code',
  'src/main/copilot',
  'src/main/cursor',
  'src/main/devin',
  'src/main/droid',
  'src/main/gemini',
  'src/main/grok',
  'src/main/hermes',
  'src/main/kimi',
  'src/main/openclaude',
  'src/main/mimo'
]

for (const path of removedDirectories) {
  const absolutePath = resolve(root, path)
  if (existsSync(absolutePath)) {
    const entries = readdirSync(absolutePath)
    assert.deepEqual(entries, [], `${path} retains provider hook/status files`)
  }
}

const removedFiles = [
  'src/main/opencode/hook-service.ts',
  'src/main/opencode/hook-service.test.ts',
  'src/main/opencode/hook-plugin-source.ts',
  'src/main/opencode/hook-plugin-child-attention.test.ts',
  'src/main/opencode/hook-plugin-fail-open-ownership.test.ts',
  'src/main/opencode/hook-plugin-lifecycle-delivery.test.ts',
  'src/main/opencode/hook-plugin-message-part-throttle.test.ts',
  'src/main/pi/agent-status-extension-source.ts',
  'src/main/pi/agent-status-extension-source.test.ts',
  'src/main/pi/agent-status-handler-source.ts',
  'src/main/pi/agent-status-runtime-detection-source.ts',
  'src/main/pi/titlebar-extension-service.ts',
  'src/main/pi/titlebar-extension-service.test.ts',
  'src/main/pi/titlebar-extension-source.ts',
  'src/main/pi/titlebar-extension-overlay-path.test.ts',
  'src/main/pi/legacy-omp-overlay-migration.ts'
]

for (const path of removedFiles) {
  assert.ok(!existsSync(resolve(root, path)), `${path} must be removed`)
}

for (const path of [
  'src/main/pi/prefill-extension-source.ts',
  'src/main/opencode/opencode-data-directory.ts'
]) {
  assert.ok(existsSync(resolve(root, path)), `${path} is a retained generic config/env surface`)
}

// Build and verification inputs must not resurrect removed provider hook lanes.
const configSources = new Map([
  ['electron.vite.config.ts', read('electron.vite.config.ts')],
  ['build-plugins/plain-node-entry-guard.ts', read('build-plugins/plain-node-entry-guard.ts')],
  ['config/electron-builder.config.cjs', read('config/electron-builder.config.cjs')],
  ['config/packaged-runtime-node-modules.cjs', read('config/packaged-runtime-node-modules.cjs')],
  ['config/scripts/build-relay.mjs', read('config/scripts/build-relay.mjs')],
  [
    'config/scripts/windows-ssh-attach-console-repro.mjs',
    read('config/scripts/windows-ssh-attach-console-repro.mjs')
  ],
  ['config/tsconfig.cli.json', read('config/tsconfig.cli.json')],
  ['config/max-lines-baseline.txt', read('config/max-lines-baseline.txt')],
  ['config/reliability-gates.jsonc', read('config/reliability-gates.jsonc')],
  ['package.json', read('package.json')]
])
const retiredBuildTokens = [
  'managed-agent-hook-controls',
  'managed-hook-runtime',
  'wsl-agent-hook-relay',
  'agent-status-extension-source',
  'agent-status.pi-hook-liveness',
  'src/shared/agent-hook-listener',
  'src/relay/agent-hook-server',
  'src/main/codex/codex-trust-grant-telemetry.ts'
]
for (const [path, source] of configSources) {
  for (const token of retiredBuildTokens) {
    assert.ok(!source.includes(token), `${path} retains retired provider-hook build token ${token}`)
  }
}
const builder = configSources.get('config/electron-builder.config.cjs')
assert.ok(builder.includes("'out/main/daemon-entry.js'"), 'packaging must unpack the daemon entry')
assert.ok(!builder.includes("'out/main/agent-hooks/**'"), 'provider hook tree must not be unpacked')
const relayBuild = configSources.get('config/scripts/build-relay.mjs')
assert.ok(
  relayBuild.includes("readFileSync(join(outDir, 'relay-watcher.js'))"),
  'relay hash must cover watcher bytes'
)
assert.ok(relayBuild.includes('.update(watcherContent)'), 'relay hash must include watcher content')
const reliability = configSources.get('config/reliability-gates.jsonc')
assert.ok(
  reliability.includes('agent-status.osc-status-contract'),
  'generic OSC status gate is required'
)
assert.ok(
  reliability.includes('src/shared/agent-status-osc.test.ts'),
  'OSC status test must remain gated'
)
assert.ok(
  reliability.includes('src/main/agent-hooks/agent-status-core.test.ts'),
  'generic status core test must remain gated'
)
const packageManifest = JSON.parse(configSources.get('package.json'))
for (const [name, command] of Object.entries(packageManifest.scripts ?? {})) {
  assert.ok(
    !String(command).includes('verify-agent-hook-stdin'),
    `${name} invokes a retired stdin verifier`
  )
}
for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
  for (const name of Object.keys(packageManifest[section] ?? {})) {
    assert.ok(
      !/agent-hook|managed-hook|wsl-agent-hook/i.test(name),
      `${section} retains retired dependency ${name}`
    )
  }
}

for (const staleScript of [
  'config/scripts/agent-hook-normalizer-roundtrip-benchmark.mjs',
  'config/scripts/verify-agent-hook-stdin-lifecycle.mjs',
  'config/scripts/command-code-transcript-scan-benchmark.mjs',
  'src/main/agent-hooks/managed-hook-stdin-lifecycle.test.ts'
]) {
  assert.ok(
    !existsSync(resolve(root, staleScript)),
    `${staleScript} is a stale provider-hook test artifact`
  )
}

const diffBenchmark = read('config/scripts/git-diff-blob-concurrency-benchmark.mjs')
assert.ok(
  !diffBenchmark.includes('src/shared/agent-hook-listener.ts'),
  'generic diff benchmark must not retain the deleted hook-listener candidate'
)

const importRefs = []
const sourceRoots = ['src/main', 'src/preload', 'src/shared', 'src/relay']
const providerPattern =
  /(?:from|import\s*\(|require\s*\()\s*['"][^'"]*\/(?:amp|antigravity|claude|command-code|copilot|cursor|devin|droid|gemini|grok|hermes|kimi|openclaude|mimo)\/(?:hook|statusline|kimi-hook|hook-config)/
const visit = (directory) => {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) visit(path)
    else if (
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !/\.test\./.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name)
    ) {
      const source = readFileSync(path, 'utf8')
      if (providerPattern.test(source)) importRefs.push(path.slice(root.length + 1))
    }
  }
}
for (const directory of sourceRoots) visit(resolve(root, directory))
assert.deepEqual(
  importRefs,
  [],
  'production code retains imports of retired provider hook adapters'
)

for (const path of [
  'config/tsconfig.cli.json',
  'config/electron-builder.config.cjs',
  'config/max-lines-baseline.txt'
]) {
  const source = read(path)
  for (const token of [
    '/amp/',
    '/antigravity/',
    '/claude/',
    '/command-code/',
    '/copilot/',
    '/cursor/',
    '/devin/',
    '/droid/',
    '/gemini/',
    '/grok/',
    '/hermes/',
    '/kimi/',
    '/openclaude/',
    '/opencode/hook-',
    '/mimo/hook-',
    '/pi/agent-status-',
    '/pi/titlebar-extension-'
  ]) {
    assert.ok(
      !source.includes(token),
      `${path} retains retired provider hook packaging or max-lines entry ${token}`
    )
  }
}

console.log('provider-hook-removal-contract: provider hook/status adapters are absent')
