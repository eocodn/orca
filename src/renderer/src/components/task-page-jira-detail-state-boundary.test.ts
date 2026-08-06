import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-jira-controller.ts'),
  'utf8'
)

describe('TaskPage Jira detail state boundary', () => {
  it('keeps cache-backed selection and navigation in its bounded hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-jira-detail-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(150)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-jira-detail-state'")
    expect(SURFACE_SOURCE).not.toContain('const [selectedJiraIssueKey, setSelectedJiraIssueKey]')
    expect(MODULE_SOURCE).toContain('findTaskPageJiraIssue(')
    expect(MODULE_SOURCE).toContain('setSelectedJiraIssue(pageData.openJiraIssue ?? null)')
  })
})
