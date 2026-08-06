import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-linear-data-lifecycle.ts'),
  'utf8'
)

describe('TaskPage Linear project detail boundary', () => {
  it('keeps selected-project reads and not-found cleanup in its hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-project-detail-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(150)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-linear-project-detail-state'")
    expect(SURFACE_SOURCE).not.toContain(
      'void fetchLinearProject(selectedLinearProject.id, selectedLinearProject.workspaceId'
    )
    expect(MODULE_SOURCE).toContain('fetchLinearProject(selectedLinearProject.id')
    expect(MODULE_SOURCE).toContain("setLinearProjectsError('Project was not found.')")
    expect(MODULE_SOURCE).toContain('setTaskResumeState({ linearContext: undefined })')
  })
})
