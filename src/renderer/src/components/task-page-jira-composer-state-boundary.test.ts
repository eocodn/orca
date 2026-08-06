import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const CONTROLLER_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-jira-controller.ts'),
  'utf8'
)
const RESET_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-provider-composer-reset.ts'),
  'utf8'
)

describe('TaskPage Jira composer state boundary', () => {
  it('keeps Jira create selectors and metadata state in its bounded hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-jira-composer-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(360)
    expect(CONTROLLER_SOURCE).toContain("from './use-task-page-jira-composer-state'")
    expect(CONTROLLER_SOURCE).not.toContain('const [newJiraIssueOpen, setNewJiraIssueOpen]')
    expect(CONTROLLER_SOURCE).not.toContain('jiraListCreateFields(')
    expect(MODULE_SOURCE).toContain('jiraListIssueTypes(')
    expect(MODULE_SOURCE).toContain('jiraListCreateFields(')
    expect(MODULE_SOURCE).toContain('cancelled = true')
    expect(RESET_SOURCE).toContain('resetNewJiraIssue()')
  })
})
