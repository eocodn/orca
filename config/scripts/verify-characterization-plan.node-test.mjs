import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  resolveCoveragePath,
  isRelativePathInside,
  validateContractRules,
  validateOverrides,
  validateRules,
  verifyCharacterizationPlan
} from './verify-characterization-plan.mjs'

describe('Phase 1 characterization plan', () => {
  it('maps every selected Playwright intent and required product area', async () => {
    const result = await verifyCharacterizationPlan(process.cwd())
    assert.equal(result.areaCount, 13)
    assert.equal(result.intentCount, 190)
    assert.ok(result.dependencyFileCount >= 200)
    assert.ok(result.dependencyPaths.includes('pnpm-lock.yaml'))
    assert.ok(result.intents.every(({ path, layer, rule, contract }) => path && layer && rule && contract))
    const intents = new Map(result.intents.map((intent) => [intent.path, intent]))
    assert.deepEqual(
      pick(intents.get('tests/e2e/terminal-ibus-hangul-native.spec.ts')),
      { layer: 'native-smoke', contract: 'terminal-lifecycle' }
    )
    assert.deepEqual(
      pick(intents.get('tests/e2e/runtime-file-browser-windows-drives.spec.ts')),
      { layer: 'core-integration', contract: 'file-read-write-watch' }
    )
    assert.deepEqual(
      pick(intents.get('tests/e2e/pr11346-selected-runtime-add.spec.ts')),
      { layer: 'headless-core', contract: 'session-synchronization' }
    )
    assert.deepEqual(
      pick(intents.get('tests/e2e/terminal-document-visibility-webgl-recovery.spec.ts')),
      { layer: 'native-smoke', contract: 'terminal-lifecycle' }
    )
    assert.deepEqual(
      pick(intents.get('tests/e2e/windows-project-runtime-smoke.spec.ts')),
      { layer: 'native-smoke', contract: 'wsl-context' }
    )
    assert.deepEqual(
      pick(intents.get('tests/e2e/floating-workspace-shared-glyph-atlas.spec.ts')),
      { layer: 'native-smoke', contract: 'terminal-lifecycle' }
    )
    assert.deepEqual(
      pick(intents.get('tests/e2e/headless-serve-desktop-activation.spec.ts')),
      { layer: 'headless-core', contract: 'web-remote-session' }
    )
    assert.deepEqual(
      pick(intents.get('tests/e2e/agent-descendant-process-kill.spec.ts')),
      { layer: 'headless-core', contract: 'terminal-lifecycle' }
    )
    assert.deepEqual(
      pick(intents.get('tests/e2e/github-cli-stall-repro.spec.ts')),
      { layer: 'core-integration', contract: 'provider-integrations' }
    )
    assert.deepEqual(pick(intents.get('tests/e2e/terminal-windows-shell-paste-ownership.spec.ts')), { layer: 'native-smoke', contract: 'terminal-lifecycle' })
    assert.deepEqual(pick(intents.get('tests/e2e/terminal-windows-codex-multiline-paste.spec.ts')), { layer: 'native-smoke', contract: 'terminal-lifecycle' })
    assert.deepEqual(pick(intents.get('tests/e2e/windows-terminal-env-icons.spec.ts')), { layer: 'native-smoke', contract: 'terminal-lifecycle' })
    assert.deepEqual(pick(intents.get('tests/e2e/settings-display-name-ime.spec.ts')), { layer: 'native-smoke', contract: 'editor-file-tree-source-control' })
    assert.deepEqual(pick(intents.get('tests/e2e/remote-agent-session-focus-authority.spec.ts')), { layer: 'headless-core', contract: 'session-synchronization' })
    assert.deepEqual(pick(intents.get('tests/e2e/resource-manager-unbound-session-safety.spec.ts')), { layer: 'headless-core', contract: 'terminal-lifecycle' })
    assert.deepEqual(pick(intents.get('tests/e2e/markdown-add-review-note-shortcut.spec.ts')), { layer: 'component', contract: 'editor-file-tree-source-control' })
    assert.deepEqual(pick(intents.get('tests/e2e/new-workspace-linked-item-project-switch.spec.ts')), { layer: 'core-integration', contract: 'provider-integrations' })
    assert.ok(result.dependencyPaths.includes('tools/win-update-e2e/app-driver.mjs'))
  })

  it('fails closed when the repository root is absent', async () => {
    await assert.rejects(verifyCharacterizationPlan('/definitely/missing/ade'))
  })

  it('rejects malformed and arbitrarily linked catalog entries', async () => {
    assert.throws(() => validateRules([{ id: 'bad', pattern: 'x', layer: 'component', reason: 'x', contract: 'ignored' }]))
    assert.throws(() => validateContractRules([{ id: 'bad', pattern: 'x', contract: 'file-read-write-watch', layers: ['unknown'] }]))
    const rules = [{ id: 'component', layer: 'component' }]
    const contractRules = [{ expression: /file/, contract: 'file-read-write-watch', layers: ['component'] }]
    assert.throws(() => validateOverrides([
      { path: 'tests/e2e/file-open.spec.ts', rule: 'component', layer: 'component', contract: 'git-workflow', reason: 'arbitrary' }
    ], rules, contractRules))
    await assert.rejects(resolveCoveragePath('/workspace', '../outside.test.ts'))
    assert.equal(isRelativePathInside('rules.json', '\\'), true)
    assert.equal(isRelativePathInside('..\\scripts\\verifier.mjs', '\\'), false)
    assert.equal(isRelativePathInside('D:\\outside.test.ts', '\\'), false)
    assert.equal(isRelativePathInside('\\\\server\\share\\outside.test.ts', '\\'), false)
    const fixture = await mkdtemp(join(tmpdir(), 'ade-characterization-'))
    try {
      const repository = join(fixture, 'repository')
      const outside = join(fixture, 'outside.test.ts')
      await mkdir(repository)
      await writeFile(outside, 'test("outside", () => {})')
      await symlink(outside, join(repository, 'escape.test.ts'))
      await assert.rejects(resolveCoveragePath(repository, 'escape.test.ts'), /symlink/)
    } finally {
      await rm(fixture, { recursive: true, force: true })
    }
  })
})

function pick(intent) {
  return { layer: intent.layer, contract: intent.contract }
}
