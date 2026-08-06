#!/usr/bin/env node
/**
 * Bundle the relay daemon and its crash-isolated watcher child per platform.
 *
 * The relay runs on remote hosts via `node relay.js`, so both outputs use
 * self-contained CommonJS bundles with no external dependencies beyond
 * Node.js built-ins. Native addons (node-pty, @parcel/watcher) are
 * marked external and expected to be installed on the remote or
 * gracefully degraded.
 */
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const __dirname = import.meta.dirname
// Why: the script lives under config/scripts, so go two levels up to reach the repo root.
const ROOT = join(__dirname, '..', '..')
const RELAY_ENTRY = join(ROOT, 'src', 'relay', 'relay.ts')
const WATCHER_ENTRY = join(ROOT, 'src', 'main', 'ipc', 'parcel-watcher-process-entry.ts')
const NODE_PTY_CONSOLE_LIST_PATCH_FILENAME = 'node-pty-1.1.0-console-list-agent-patch.cjs'
const NODE_PTY_CONSOLE_LIST_PATCH_SOURCE = join(
  ROOT,
  'config',
  'relay-assets',
  NODE_PTY_CONSOLE_LIST_PATCH_FILENAME
)

const PLATFORMS = [
  'linux-x64',
  'linux-arm64',
  'darwin-x64',
  'darwin-arm64',
  'win32-x64',
  'win32-arm64'
]

const RELAY_VERSION = '0.1.0'

for (const platform of PLATFORMS) {
  const outDir = join(ROOT, 'out', 'relay', platform)
  mkdirSync(outDir, { recursive: true })

  await build({
    entryPoints: [RELAY_ENTRY],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: join(outDir, 'relay.js'),
    // Native addons cannot be bundled — they must exist on the remote host.
    // The relay gracefully degrades when they are absent.
    external: ['node-pty', '@parcel/watcher', 'electron'],
    sourcemap: false,
    minify: true,
    define: {
      'process.env.NODE_ENV': '"production"'
    }
  })

  if (platform.startsWith('win32-')) {
    copyFileSync(
      NODE_PTY_CONSOLE_LIST_PATCH_SOURCE,
      join(outDir, NODE_PTY_CONSOLE_LIST_PATCH_FILENAME)
    )
  }

  await build({
    entryPoints: [WATCHER_ENTRY],
    bundle: true,
    platform: 'node',
    target: 'node18',
    format: 'cjs',
    outfile: join(outDir, 'relay-watcher.js'),
    external: ['@parcel/watcher'],
    sourcemap: false,
    minify: true,
    define: {
      'process.env.NODE_ENV': '"production"'
    }
  })

  // Why: include a content hash so the deploy check detects code changes
  // even when RELAY_VERSION hasn't been bumped. Hash every executable module
  // so a companion-only change always deploys beside the matching relay host.
  const relayContent = readFileSync(join(outDir, 'relay.js'))
  const watcherContent = readFileSync(join(outDir, 'relay-watcher.js'))
  const hash = createHash('sha256').update(relayContent).update(watcherContent)
  // Why: changing the remote node-pty patch must select a fresh immutable Windows relay directory.
  if (platform.startsWith('win32-')) {
    hash.update(readFileSync(join(outDir, NODE_PTY_CONSOLE_LIST_PATCH_FILENAME)))
  }
  const contentHash = hash.digest('hex').slice(0, 12)
  writeFileSync(join(outDir, '.version'), `${RELAY_VERSION}+${contentHash}`)

  console.log(`Built relay for ${platform} → ${outDir}/relay.js`)
}

console.log('Relay build complete.')
