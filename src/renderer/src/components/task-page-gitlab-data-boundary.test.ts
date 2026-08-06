import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')
const DATA_SOURCE = readFileSync(join(COMPONENT_ROOT, 'use-task-page-gitlab-data.ts'), 'utf8')

describe('TaskPage GitLab data boundary', () => {
  it('keeps provider fetch effects in a dedicated data hook', () => {
    expect(DATA_SOURCE.split('\n').length).toBeLessThan(320)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-gitlab-data'")
    expect(SURFACE_SOURCE).not.toContain('window.api.gl.listIssues')
    expect(SURFACE_SOURCE).not.toContain('window.api.gl.listMRs')
    expect(SURFACE_SOURCE).not.toContain('window.api.gl.todos')
    expect(DATA_SOURCE).toContain('getTaskPageRepoSourceContext')
    expect(DATA_SOURCE).toContain('Promise.allSettled')
  })
})
