import { existsSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('../..', import.meta.url)))

const retiredFiles = [
  'src/main/agent-hooks/managed-agent-hook-registry.ts',
  'src/main/agent-hooks/managed-agent-hook-controls.ts',
  'src/main/agent-hooks/managed-hook-runtime.ts',
  'src/main/agent-hooks/managed-hook-local-filesystem.ts',
  'src/main/agent-hooks/remote-managed-hook-installers.ts',
  'src/main/agent-hooks/wsl-hook-relay-manager.ts',
  'src/main/agent-hooks/wsl-hook-relay-launch.ts',
  'src/main/agent-hooks/wsl-hook-relay-deps.ts',
  'src/main/agent-hooks/wsl-hook-relay-link.ts',
  'src/main/agent-hooks/wsl-hook-relay-recovery.ts',
  'src/main/agent-hooks/wsl-hook-relay-sentinel.ts',
  'src/main/agent-hooks/wsl-hook-relay-state-key.ts',
  'src/main/agent-hooks/wsl-hook-fs-adapter.ts',
  'src/main/agent-hooks/wsl-guest-plugin-install.ts',
  'src/cli/handlers/agent-hooks.ts',
  'src/cli/specs/agent-hooks.ts'
]

const residualTokens = [
  'managed-agent-hook-registry',
  'managed-agent-hook-controls',
  'remote-managed-hook-installers',
  'wsl-hook-relay-manager',
  'wsl-hook-relay-launch',
  'managed-hook-runtime.js',
  'agent hooks status',
  'agent hooks on',
  'agent hooks off'
]

const productionRoots = ['src/main', 'src/relay', 'src/cli', 'electron.vite.config.ts']

const codexLaunchPreparation = readFileSync(
  join(root, 'src/main/main-process-runtime-startup-preparation.ts'),
  'utf8'
)
for (const token of [
  'codexHookService',
  'ensureRealHomeCodexHookState',
  'installForRuntimeHome',
  'refreshRuntimeUserHooksForRuntimeHome',
  'hooksEnabled = true'
]) {
  if (codexLaunchPreparation.includes(token)) {
    throw new Error(
      `managed hook launch side effect ${token} remains in main-process-runtime-startup-preparation.ts`
    )
  }
}
if (!codexLaunchPreparation.includes('launchEnv?.CODEX_HOME?.trim()')) {
  throw new Error('generic CODEX_HOME launch passthrough is missing')
}

for (const target of retiredFiles) {
  if (existsSync(join(root, target))) {
    throw new Error(`retired managed-hook file still exists: ${target}`)
  }
}

// Keep this contract dependency-free; the Docker runner invokes it with Node.
const { execFileSync } = await import('node:child_process')
const listed = execFileSync(
  'find',
  productionRoots.map((path) => join(root, path)),
  {
    encoding: 'utf8'
  }
)
  .split('\n')
  .filter((path) => /\.(ts|tsx|mjs|cjs|json)$/.test(path))

for (const path of listed) {
  if (
    path.endsWith('managed-hook-installer-removal-contract.test.mjs') ||
    path.endsWith('.test.ts') ||
    path.endsWith('.d.ts')
  ) {
    continue
  }
  const source = readFileSync(path, 'utf8')
  for (const token of residualTokens) {
    if (source.includes(token)) {
      throw new Error(`retired managed-hook token ${token} remains in ${relative(root, path)}`)
    }
  }
}

console.log('managed-hook-installer-removal-contract: PASS')
