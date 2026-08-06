import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-creation-actions.ts'),
  'utf8'
)

describe('TaskPage Jira issue creation boundary', () => {
  it('keeps required-field validation, context fencing, and row insertion in its hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-jira-issue-creation-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(200)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-jira-issue-creation-state'")
    expect(SURFACE_SOURCE).not.toContain('const handleCreateNewJiraIssue = useCallback')
    expect(MODULE_SOURCE).toContain('buildJiraCreateCustomFields(')
    expect(MODULE_SOURCE).toContain('jiraCreateIssue(')
    expect(MODULE_SOURCE).toContain('setJiraIssues((prev) =>')
    expect(MODULE_SOURCE).toContain('providerRuntimeContextKeyRef.current')
  })
})
