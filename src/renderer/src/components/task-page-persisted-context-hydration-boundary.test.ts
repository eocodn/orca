import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'use-task-page-controller.ts'), 'utf8')

describe('TaskPage persisted context hydration boundary', () => {
  it('keeps persisted provider context restoration in its hydration hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-persisted-context-hydration.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(170)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-persisted-context-hydration'")
    expect(SURFACE_SOURCE).not.toContain('const nextGithubMode = taskResumeState?.githubMode')
    expect(moduleSource).toContain('taskResumeAppliedRef.current = true')
    expect(moduleSource).toContain('getTaskPresetQuery(presetId)')
    expect(moduleSource).toContain("taskResumeState?.jiraPreset ?? 'assigned'")
  })
})
