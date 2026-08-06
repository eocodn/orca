import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-jira-controller.ts'),
  'utf8'
)

describe('TaskPage Jira toolbar action boundary', () => {
  it('keeps Jira creation, preset, and search callbacks in its action hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-jira-toolbar-actions.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(150)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-jira-toolbar-actions'")
    expect(SURFACE_SOURCE).not.toContain('const selectJiraPreset = useCallback(')
    expect(SURFACE_SOURCE).not.toContain('const handleCreateJiraIssue = useCallback(')
    expect(moduleSource).toContain('setNewJiraIssueOpen(true)')
    expect(moduleSource).toContain("setTaskResumeState({ jiraPreset: preset, jiraQuery: '' })")
    expect(moduleSource).toContain('setJiraRefreshNonce((n) => n + 1)')
  })
})
