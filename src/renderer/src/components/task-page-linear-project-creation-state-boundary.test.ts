import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-creation-actions.ts'),
  'utf8'
)

describe('TaskPage Linear project creation boundary', () => {
  it('keeps project submission and post-create selection in its bounded hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-project-creation-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(220)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-linear-project-creation-state'")
    expect(SURFACE_SOURCE).not.toContain('const handleCreateNewLinearProject = useCallback')
    expect(MODULE_SOURCE).toContain('linearCreateProject(')
    expect(MODULE_SOURCE).toContain('setLinearProjectsResult(')
    expect(MODULE_SOURCE).toContain('openLinearProjectContext(result.project)')
    expect(MODULE_SOURCE).toContain('setLinearRefreshNonce((n) => n + 1)')
  })
})
