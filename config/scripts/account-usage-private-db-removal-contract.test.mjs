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
  'src/main/ipc/opencode-usage.ts'
]
for (const path of forbidden) {
  const absolutePath = resolve(root, path)
  if (existsSync(absolutePath)) {
    if (!statSync(absolutePath).isDirectory()) {
      assert.fail(`${path} must be removed`)
    }
    const entries = readdirSync(absolutePath)
    assert.ok(
      entries.every((entry) => entry.endsWith('.d.ts')),
      `${path} retains tracked source files`
    )
  }
}

for (const path of [
  'src/main/ipc/register-core-handlers.ts',
  'src/preload/preload-api-stats.ts',
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
assert.deepEqual(
  productionRefs,
  [],
  'preload must not import removed account/usage/private-db modules'
)

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

console.log('account-usage-private-db-removal-contract: 4 assertions passed')
