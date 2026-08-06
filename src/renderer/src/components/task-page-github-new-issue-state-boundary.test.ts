import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-github-controller.ts'),
  'utf8'
)

describe('TaskPage GitHub new-issue state boundary', () => {
  it('keeps draft, target metadata, and repo recovery in its bounded hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-github-new-issue-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(260)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-github-new-issue-state'")
    expect(SURFACE_SOURCE).not.toContain('const [newIssueOpen, setNewIssueOpen]')
    expect(MODULE_SOURCE).toContain('resolveVanishedNewIssueRepoReset')
    expect(MODULE_SOURCE).toContain('setNewIssueDraft')
  })
})
