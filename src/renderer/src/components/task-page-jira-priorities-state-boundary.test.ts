import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-jira-list-controller.ts'),
  'utf8'
)

describe('TaskPage Jira priorities boundary', () => {
  it('keeps priority catalog reads, empty reset, and cancellation in its hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-jira-priorities-state.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(110)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-jira-priorities-state'")
    expect(SURFACE_SOURCE).not.toContain('jiraListPriorities(')
    expect(moduleSource).toContain('jiraListPriorities(')
    expect(moduleSource).toContain('new Map()')
    expect(moduleSource).toContain('cancelled = true')
  })
})
