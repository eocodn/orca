import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  resolveCoveragePath,
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
  })

  it('fails closed when the repository root is absent', async () => {
    await assert.rejects(verifyCharacterizationPlan('/definitely/missing/ade'))
  })

  it('rejects malformed and arbitrarily linked catalog entries', () => {
    assert.throws(() => validateRules([{ id: 'bad', pattern: 'x', layer: 'component', reason: 'x', contract: 'ignored' }]))
    assert.throws(() => validateContractRules([{ id: 'bad', pattern: 'x', contract: 'file-read-write-watch', layers: ['unknown'] }]))
    const rules = [{ id: 'component', layer: 'component' }]
    const contractRules = [{ expression: /file/, contract: 'file-read-write-watch', layers: ['component'] }]
    assert.throws(() => validateOverrides([
      { path: 'tests/e2e/file-open.spec.ts', rule: 'component', layer: 'component', contract: 'git-workflow', reason: 'arbitrary' }
    ], rules, contractRules))
    assert.throws(() => resolveCoveragePath('/workspace', '../outside.test.ts'))
  })
})

function pick(intent) {
  return { layer: intent.layer, contract: intent.contract }
}
