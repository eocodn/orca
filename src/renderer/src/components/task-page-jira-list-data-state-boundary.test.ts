import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-jira-data-lifecycle.ts'),
  'utf8'
)

describe('TaskPage Jira list data boundary', () => {
  it('keeps Jira reads, status-order hydration, and cancellation in its hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-jira-list-data-state.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(180)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-jira-list-data-state'")
    expect(SURFACE_SOURCE).not.toContain('searchJiraIssues(')
    expect(SURFACE_SOURCE).not.toContain('listJiraIssues(')
    expect(moduleSource).toContain('searchJiraIssues(')
    expect(moduleSource).toContain('listJiraIssues(')
    expect(moduleSource).toContain('loadTaskPageJiraProjectStatusOrder(')
    expect(moduleSource).toContain('createTaskPageJiraLoadFailureState(')
    expect(moduleSource).toContain('cancelled = true')
  })
})
