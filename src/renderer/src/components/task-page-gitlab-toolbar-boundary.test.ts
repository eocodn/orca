import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-toolbar-view.tsx'), 'utf8')

describe('TaskPage GitLab toolbar boundary', () => {
  it('keeps GitLab views, project scope, filters, and refresh in a bounded component', () => {
    const TOOLBAR_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'task-page-gitlab-toolbar.tsx'),
      'utf8'
    )

    expect(TOOLBAR_SOURCE.split('\n').length).toBeLessThan(300)
    expect(SURFACE_SOURCE).toContain("from './task-page-gitlab-toolbar'")
    expect(SURFACE_SOURCE).not.toContain("(['issues', 'mrs', 'todos'] as const).map")
    expect(TOOLBAR_SOURCE).toContain('export function TaskPageGitLabToolbar')
    expect(TOOLBAR_SOURCE).toContain('onFilterChange')
  })
})
