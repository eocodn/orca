import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const read = (path) => readFileSync(resolve(root, path), 'utf8')

// Account switching, usage telemetry and private transcript databases are not
// product capabilities. Generic agent launch/profile APIs remain elsewhere.
const forbidden = [
  'src/main/claude-accounts',
  'src/main/codex-accounts',
  'src/main/claude-usage',
  'src/main/codex-usage',
  'src/main/opencode-usage',
  'src/main/rate-limits',
  'src/main/grok-accounts',
  'src/main/minimax',
  'src/main/ipc/claude-accounts.ts',
  'src/main/ipc/codex-accounts.ts',
  'src/main/ipc/rate-limits.ts',
  'src/main/ipc/ai-vault.ts',
  'src/main/ipc/ai-vault-resume.ts',
  'src/main/ipc/claude-usage.ts',
  'src/main/ipc/codex-usage.ts',
  'src/main/ipc/opencode-usage.ts',
  'src/renderer/src/components/stats',
  'src/renderer/src/components/right-sidebar/ai-vault-session',
  'src/renderer/src/components/right-sidebar/ai-vault-original-pane.ts',
  'src/renderer/src/store/slices/claude-usage.ts',
  'src/renderer/src/store/slices/codex-usage.ts',
  'src/renderer/src/store/slices/opencode-usage.ts',
  'src/renderer/src/store/slices/rate-limits.ts',
  'src/preload/api-usage-chat.ts',
  'src/shared/ai-vault-types.ts',
  'src/shared/ai-vault-session-filters.ts',
  'src/shared/ai-vault-session-display.ts',
  'src/shared/ai-vault-resume-path.ts',
  'src/shared/ai-vault-resume-preparation.ts',
  'src/shared/rate-limit-types.ts',
  'src/shared/claude-usage-types.ts',
  'src/shared/codex-usage-types.ts',
  'src/shared/opencode-usage-types.ts',
  'src/shared/types-stats.ts'
]
for (const path of forbidden) {
  const absolutePath = resolve(root, path)
  if (existsSync(absolutePath)) {
    if (!statSync(absolutePath).isDirectory()) {
      assert.fail(`${path} must be removed`)
    }
    const entries = readdirSync(absolutePath)
    assert.ok(entries.every((entry) => entry.endsWith('.d.ts')), `${path} retains tracked source files`)
  }
}

for (const path of [
  'src/main/claude/runtime-auth-service.ts',
  'src/main/codex-cli/runtime-home-service.ts',
  'src/main/agent-auth-restart-preservation.ts',
  'src/main/claude/pty-lifecycle-gate.ts',
  'src/main/codex/codex-session-backfill.test.ts',
  'src/main/ai-vault/session-scanner-opencode-sqlite-worker-entry.ts'
]) {
  assert.ok(!existsSync(resolve(root, path)), `${path} must be removed`)
}

for (const path of ['electron.vite.config.ts', 'config/scripts/electron-builder-config.test.mjs']) {
  const source = read(path)
  for (const token of ['session-scanner-opencode-sqlite-worker-entry', 'claude-accounts/keychain']) {
    assert.ok(!source.includes(token), `${path} retains removed packaging entry ${token}`)
  }
}

for (const path of [
  'src/main/ipc/register-core-handlers.ts',
  'src/preload/preload-api-contract-agent-hooks.ts',
  'src/preload/preload-api-contract-git.ts'
]) {
  const source = read(path)
  for (const token of [
    'registerClaudeAccountHandlers',
    'registerCodexAccountHandlers',
    'registerRateLimitHandlers',
    'registerAiVaultHandlers',
    'registerClaudeUsageHandlers',
    'registerCodexUsageHandlers',
    'registerOpenCodeUsageHandlers',
    "'rateLimits'",
    "'aiVault'",
    "'openCodeUsage'",
    "'claudeAccounts'",
    "'codexAccounts'"
  ]) {
    assert.ok(!source.includes(token), `${path} retains removed capability ${token}`)
  }
}

const productionRefs = []
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) visit(path)
    else if (
      /\.(?:ts|tsx)$/.test(entry.name) &&
      !/\.test\./.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name)
    ) {
      const source = readFileSync(path, 'utf8')
      if (
        /(?:from|import\s*\(|require\s*\()\s*['"][^'"]*(?:ai-vault|claude-usage|codex-usage|opencode-usage|rate-limits|claude-accounts|codex-accounts)/.test(
          source
        )
      ) {
        productionRefs.push(path.slice(root.length + 1))
      }
    }
  }
}
visit(resolve(root, 'src/main'))
visit(resolve(root, 'src/preload'))
visit(resolve(root, 'src/renderer/src'))
visit(resolve(root, 'src/shared'))
visit(resolve(root, 'mobile/src'))
assert.deepEqual(
  productionRefs,
  [],
  'preload must not import removed account/usage/private-db modules'
)

const surfaceRefs = []
const surfaceRoots = ['src/renderer/src', 'src/preload', 'src/shared', 'mobile/src']
for (const directory of surfaceRoots) {
  const visitSurface = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name)
      if (entry.isDirectory()) visitSurface(path)
      else if (/\.(?:ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        const source = readFileSync(path, 'utf8')
        if (/(?:aiVault|claudeUsage|codexUsage|openCodeUsage|rateLimits|minimaxCredentials)/.test(source)) {
          surfaceRefs.push(path.slice(root.length + 1))
        }
      }
    }
  }
  visitSurface(resolve(root, directory))
}
assert.deepEqual(surfaceRefs, [], 'renderer/preload/shared/mobile retain removed account/usage/private-db surfaces')

for (const path of [
  'src/main/main-process-ready-foundation.ts',
  'src/main/main-process-window-startup-lifecycle.ts',
  'src/main/main-process-shutdown-lifecycle.ts',
  'src/main/main-process-process-configuration.ts'
]) {
  const source = read(path)
  for (const token of [
    'ClaudeUsageStore',
    'CodexUsageStore',
    'OpenCodeUsageStore',
    'RateLimitService',
    'ClaudeAccountService',
    'CodexAccountService',
    'initSessionParseCachePersistence',
    'setAccountServices'
  ]) {
    assert.ok(!source.includes(token), `${path} retains removed startup service ${token}`)
  }
}

const removedLaneTokens = [
  'ClaudeRuntimeAuthService',
  'CodexRuntimeHomeService',
  'prepareClaudeAuth',
  'ClaudeRuntimeAuthPreparation',
  'isClaudeAuthSwitchInProgress',
  'hasClaudeAuthEnvConflict',
  'CLAUDE_AUTH_ENV_VARS',
  'markClaudePtySpawned',
  'markClaudePtyExited',
  'recordCodexPaneAccount',
  'forgetCodexPaneAccount'
]
const removedLaneRefs = []
const scanMainSource = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) scanMainSource(path)
    else if (/\.ts$/.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
      const source = readFileSync(path, 'utf8')
      if (removedLaneTokens.some((token) => source.includes(token))) {
        removedLaneRefs.push(path.slice(root.length + 1))
      }
    }
  }
}
scanMainSource(resolve(root, 'src/main'))
assert.deepEqual(removedLaneRefs, [], 'main retains removed account-auth/PTy lane seams')

console.log('account-usage-private-db-removal-contract: 7 assertions passed')
