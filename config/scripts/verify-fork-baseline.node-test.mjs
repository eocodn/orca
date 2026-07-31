import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { verifyForkBaseline } from './verify-fork-baseline.mjs'

describe('fork baseline provenance', () => {
  it('accepts the checked-in baseline and upstream license', async () => {
    const result = await verifyForkBaseline(process.cwd())
    assert.deepEqual(result, {
      baselineCommit: '79251d7a9861568dc261faabfa16df5347d1d008',
      licenseHolder: 'Lovecast Inc.',
      productVersion: '1.4.163-rc.1',
      recordedResults: 6
    })
  })

  it('rejects an absent baseline document instead of silently passing', async () => {
    await assert.rejects(verifyForkBaseline('/definitely/missing/ade'))
  })
})
