import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const exists = (path) => existsSync(resolve(root, path))

// Provider HTTP payload parsing and its relay transport are retired. Generic
// OSC/PTY status, filesystem, Git, and plugin/MCP relay lanes remain.
const removedSharedFiles = [
  'src/shared/agent-hook-normalize.ts',
  'src/shared/agent-hook-basic-events.ts',
  'src/shared/agent-hook-claude-events.ts',
  'src/shared/agent-hook-codex-events.ts',
  'src/shared/agent-hook-event-policy.ts',
  'src/shared/agent-hook-prompt-tools.ts',
  'src/shared/agent-hook-provider-events.ts',
  'src/shared/agent-hook-provider-tools.ts',
  'src/shared/agent-hook-source-tools.ts',
  'src/shared/agent-hook-transcript.ts',
  'src/shared/agent-hook-state.ts',
  'src/shared/agent-hook-request-body.ts',
  'src/shared/agent-hook-endpoint-file.ts',
  'src/shared/agent-hook-endpoint-writer.ts',
  'src/shared/agent-hook-endpoint-temp-cleanup.ts',
  'src/shared/agent-hook-transport.ts',
  'src/shared/agent-hook-listener.ts',
  'src/shared/managed-agent-hook-targets.ts'
]

for (const path of removedSharedFiles) {
  assert.ok(!exists(path), `${path} must be removed`) 
  for (const suffix of ['.d.ts', '.test.ts', '.test.d.ts']) {
    assert.ok(!exists(path.replace(/\.ts$/, suffix)), `${path.replace(/\.ts$/, suffix)} must be removed`)
  }
}

for (const path of [
  'src/relay/agent-hook-server.ts',
  'src/relay/agent-hook-server.test.ts',
  'src/relay/agent-hook-server.d.ts',
  'src/relay/agent-hook-server.test.d.ts',
  'src/relay/agent-hook-integration.test.ts',
  'src/relay/wsl-agent-hook-relay.ts',
  'src/relay/wsl-agent-hook-relay.test.ts',
  'src/relay/wsl-agent-hook-relay.d.ts',
  'src/relay/wsl-agent-hook-relay.test.d.ts',
  'src/relay/plugin-overlay.ts',
  'src/relay/plugin-overlay.test.ts',
  'src/relay/plugin-overlay.d.ts',
  'src/relay/plugin-overlay.test.d.ts',
  'src/relay/plugin-overlay-env.ts',
  'src/relay/plugin-overlay-env.test.ts',
  'src/relay/plugin-overlay-env.d.ts',
  'src/relay/plugin-overlay-env.test.d.ts'
]) {
  assert.ok(!exists(path), `${path} must be removed`)
}

for (const path of ['src/relay/relay-startup.ts', 'src/relay/relay-startup-socket.ts']) {
  if (!exists(path)) continue
  const source = readFileSync(resolve(root, path), 'utf8')
  assert.ok(!source.includes('agent-hook-server'), `${path} retains provider hook server startup`)
  assert.ok(!source.includes('PluginOverlayManager'), `${path} retains provider plugin overlay startup`)
  assert.ok(!source.includes('wsl-agent-hook-relay'), `${path} retains WSL hook relay startup`)
}

for (const directory of ['src/shared', 'src/relay']) {
  const rootDir = resolve(root, directory)
  const leftovers = []
  const visit = (dir) => {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name)
      if (entry.isDirectory()) visit(path)
      else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        const source = readFileSync(path, 'utf8')
        if (/agent-hook-(?:normalize|basic-events|claude-events|codex-events|event-policy|prompt-tools|provider-events|provider-tools|source-tools|transcript|state|request-body|endpoint|transport|listener)|agent-hook-server|wsl-agent-hook-relay|plugin-overlay/.test(source)) {
          leftovers.push(path.slice(root.length + 1))
        }
      }
    }
  }
  visit(rootDir)
  assert.deepEqual(leftovers, [], `${directory} retains imports or references to retired provider hook lanes`)
}

console.log('shared-hook-relay-removal-contract: provider parser and relay lanes are absent')
