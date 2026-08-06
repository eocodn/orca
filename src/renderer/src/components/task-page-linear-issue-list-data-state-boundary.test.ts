import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage Linear issue list data boundary', () => {
  it('keeps request signatures, cache reconciliation, and stale response fencing in its hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-issue-list-data-state.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(300)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-linear-issue-list-data-state'")
    expect(SURFACE_SOURCE).not.toContain('searchLinearIssues(')
    expect(SURFACE_SOURCE).not.toContain('listLinearIssues(')
    expect(moduleSource).toContain('buildLinearIssueListRequestSignature(')
    expect(moduleSource).toContain('reconcileTaskPageLinearIssuesAfterLandingRefresh(')
    expect(moduleSource).toContain('lastLinearRequestRef')
    expect(moduleSource).toContain('cancelled = true')
  })
})
