import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')

describe('TaskPage Linear issue pagination boundary', () => {
  it('keeps active-scope routing, page expansion, and page reconciliation in its hook', () => {
    const moduleSource = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-issue-pagination-state.ts'),
      'utf8'
    )

    expect(moduleSource.split('\n').length).toBeLessThan(260)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-linear-issue-pagination-state'")
    expect(SURFACE_SOURCE).not.toContain('getLinearIssuePageState(')
    expect(moduleSource).toContain('getLinearIssuePageState(')
    expect(moduleSource).toContain('handleLinearIssuePageChange')
    expect(moduleSource).toContain('handleLinearEmptyFilteredLoadMore')
    expect(moduleSource).toContain('setActiveLinearIssueLoadingTargetPage(null)')
  })
})
