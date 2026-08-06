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
  'src/main/opencode/hook-service.d.ts',
  'src/main/opencode/hook-service.ts',
  'src/main/opencode/hook-service.test.d.ts',
  'src/main/opencode/hook-service.test.ts',
  'src/main/opencode/hook-plugin-source.d.ts',
  'src/main/opencode/hook-plugin-source.ts',
  'src/main/opencode/hook-plugin-child-attention.test.d.ts',
  'src/main/opencode/hook-plugin-child-attention.test.ts',
  'src/main/opencode/hook-plugin-fail-open-ownership.test.d.ts',
  'src/main/opencode/hook-plugin-fail-open-ownership.test.ts',
  'src/main/opencode/hook-plugin-lifecycle-delivery.test.d.ts',
  'src/main/opencode/hook-plugin-lifecycle-delivery.test.ts',
  'src/main/opencode/hook-plugin-message-part-throttle.test.d.ts',
  'src/main/opencode/hook-plugin-message-part-throttle.test.ts',
  'src/main/pi/agent-status-extension-source.d.ts',
  'src/main/pi/agent-status-extension-source.ts',
  'src/main/pi/agent-status-extension-source.test.d.ts',
  'src/main/pi/agent-status-extension-source.test.ts',
  'src/main/pi/agent-status-handler-source.d.ts',
  'src/main/pi/agent-status-handler-source.ts',
  'src/main/pi/agent-status-runtime-detection-source.d.ts',
  'src/main/pi/agent-status-runtime-detection-source.ts',
  'src/main/pi/titlebar-extension-service.d.ts',
  'src/main/pi/titlebar-extension-service.ts',
  'src/main/pi/titlebar-extension-service.test.d.ts',
  'src/main/pi/titlebar-extension-service.test.ts',
  'src/main/pi/titlebar-extension-source.d.ts',
  'src/main/pi/titlebar-extension-source.ts',
  'src/main/pi/titlebar-extension-overlay-path.test.d.ts',
  'src/main/pi/titlebar-extension-overlay-path.test.ts',
  'src/main/pi/legacy-omp-overlay-migration.d.ts',
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
assert.deepEqual(importRefs, [], 'production code retains imports of retired provider hook adapters')

for (const path of ['config/tsconfig.cli.json', 'config/electron-builder.config.cjs', 'config/max-lines-baseline.txt']) {
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
    assert.ok(!source.includes(token), `${path} retains retired provider hook packaging or max-lines entry ${token}`)
  }
}

console.log('provider-hook-removal-contract: provider hook/status adapters are absent')