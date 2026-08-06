import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-toolbar-view.tsx'), 'utf8')

describe('TaskPage GitHub source divergence boundary', () => {
  it('keeps source divergence indicators and selectors bounded', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'task-page-github-source-divergence.tsx'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(180)
    expect(SURFACE_SOURCE).toContain("from './task-page-github-source-divergence'")
    expect(SURFACE_SOURCE).not.toContain(
      'hasUpstreamCandidateDivergence(s) || hasDivergentSources(s)'
    )
  })
})
