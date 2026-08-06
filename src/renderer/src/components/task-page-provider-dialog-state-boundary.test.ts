import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-github-repository-state.ts'),
  'utf8'
)

describe('TaskPage provider dialog state boundary', () => {
  it('keeps dialog cache resolution and row patching in its bounded hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-provider-dialog-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(260)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-provider-dialog-state'")
    expect(SURFACE_SOURCE).not.toContain('const dialogWorkItemKey = githubTaskDrawerWorkItem')
    expect(MODULE_SOURCE).toContain('findTaskPageDialogWorkItem(')
    expect(MODULE_SOURCE).toContain('patchTaskPageWorkItemRows')
    expect(MODULE_SOURCE).toContain('openGitLabDetailPage')
  })
})
