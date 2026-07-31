import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { describe, it } from 'node:test'

import { verifyBaselineResults, verifyForkBaseline } from './verify-fork-baseline.mjs'

describe('fork baseline provenance', () => {
  it('accepts the checked-in baseline and upstream license', async () => {
    const result = await verifyForkBaseline(process.cwd())
    assert.deepEqual(result, {
      baselineCommit: '79251d7a9861568dc261faabfa16df5347d1d008',
      baselineParent: '886fa7b4389fd309aee6a8674554f542be3b0eea',
      baselineTree: '34a0b0777e7b92e07bd2cea148008ee7c70864c9',
      licenseHolder: 'Lovecast Inc.',
      productVersion: '1.4.163-rc.1',
      remoteBranches: 3506,
      tags: 1018
    })
  })

  it('rejects an absent baseline document instead of silently passing', async () => {
    await assert.rejects(verifyForkBaseline('/definitely/missing/ade'))
  })

  it('rejects a shallow repository even when documentation is unchanged', async () => {
    const refs = (prefix, count) => Array.from({ length: count }, (_, index) => `${prefix}/${index}`).join('\n')
    const responses = new Map([
      ['rev-parse --is-shallow-repository', 'true'],
      ['cat-file -t 79251d7a9861568dc261faabfa16df5347d1d008', 'commit'],
      ['show -s --format=%P%n%T 79251d7a9861568dc261faabfa16df5347d1d008', '886fa7b4389fd309aee6a8674554f542be3b0eea\n34a0b0777e7b92e07bd2cea148008ee7c70864c9'],
      ['remote get-url upstream', 'https://github.com/stablyai/orca.git'],
      ['for-each-ref --format=%(refname) refs/tags', refs('refs/tags', 1018)],
      ['for-each-ref --format=%(refname) refs/remotes/upstream', refs('refs/remotes/upstream', 3506)],
      ['merge-base --is-ancestor 79251d7a9861568dc261faabfa16df5347d1d008 HEAD', ''],
      ['show 79251d7a9861568dc261faabfa16df5347d1d008:package.json', '{"version":"1.4.163-rc.1"}']
    ])
    await assert.rejects(verifyForkBaseline(process.cwd(), async (args) => responses.get(args.join(' '))), /must not be shallow/)
  })

  it('runs product checks from an immutable checkout of the baseline commit', async () => {
    const compose = await readFile('compose.yml', 'utf8')
    assert.match(compose, /baseline-source:/)
    assert.match(compose, /ADE_BASELINE_COMMIT: 79251d7a9861568dc261faabfa16df5347d1d008/)
    assert.match(compose, /condition: service_completed_successfully/)
    assert.match(compose, /baseline-source:\/baseline:\s*ro/)
    assert.match(compose, /\.git\/ade-baseline-ready/)
    assert.match(compose, /timeout --signal=TERM --kill-after=30s 2m node --test/)
    assert.match(compose, /timeout\n\s+- --signal=TERM\n\s+- --kill-after=30s\n\s+- 5m/)
  })

  it('rejects incomplete or ambiguous recorded results', () => {
    assert.throws(() => verifyBaselineResults({ schemaVersion: 1, baselineCommit: 'wrong', surfaces: [] }))
  })

  it('rejects duplicate and fabricated surface evidence', async () => {
    const evidence = JSON.parse(await readFile('docs/fork-baseline-results.json', 'utf8'))
    assert.throws(() => verifyBaselineResults({ ...evidence, surfaces: [...evidence.surfaces, evidence.surfaces[0]] }))
    const fabricated = structuredClone(evidence)
    fabricated.surfaces[0].command = 'true'
    assert.throws(() => verifyBaselineResults(fabricated))
    const replayed = structuredClone(evidence)
    replayed.surfaces[1].runId = replayed.surfaces[0].runId
    replayed.surfaces[1].command = replayed.surfaces[1].command.replace('core-exact-1', replayed.surfaces[0].runId)
    assert.throws(() => verifyBaselineResults(replayed))
  })

  it('accepts only the six explicit baseline surfaces and status vocabulary', async () => {
    const evidence = JSON.parse(await readFile('docs/fork-baseline-results.json', 'utf8'))
    assert.equal(verifyBaselineResults(evidence).length, 6)
  })
})
