import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage Linear custom-view data boundary', () => {
  it('keeps model merging, contents branching, and cancellation in its hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-custom-view-data-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(260)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-linear-custom-view-data-state'")
    expect(SURFACE_SOURCE).not.toContain('const cachedResults = LINEAR_CUSTOM_VIEW_MODELS.map')
    expect(MODULE_SOURCE).toContain('mergeLinearCollectionResults(')
    expect(MODULE_SOURCE).toContain('listLinearCustomViewIssues(')
    expect(MODULE_SOURCE).toContain('listLinearCustomViewProjects(')
    expect(MODULE_SOURCE).toContain('cancelled = true')
  })
})
