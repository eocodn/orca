import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { verifyCharacterizationPlan } from './verify-characterization-plan.mjs'

describe('Phase 1 characterization plan', () => {
  it('maps every selected Playwright intent and required product area', async () => {
    const result = await verifyCharacterizationPlan(process.cwd())
    assert.equal(result.areaCount, 13)
    assert.equal(result.intentCount, 190)
    assert.ok(result.dependencyFileCount >= 200)
    assert.ok(result.intents.every(({ path, layer, rule }) => path && layer && rule))
  })

  it('fails closed when the repository root is absent', async () => {
    await assert.rejects(verifyCharacterizationPlan('/definitely/missing/ade'))
  })
})
