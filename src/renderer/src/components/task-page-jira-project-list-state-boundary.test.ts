import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage Jira project list boundary', () => {
  it('keeps Jira catalog reads, reset state, and cancellation in its hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-jira-project-list-state.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(130)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-jira-project-list-state'")
    expect(SURFACE_SOURCE).not.toContain('jiraListProjects(')
    expect(moduleSource).toContain('jiraListProjects(')
    expect(moduleSource).toContain('setAvailableJiraProjects([])')
    expect(moduleSource).toContain('cancelled = true')
  })
})
