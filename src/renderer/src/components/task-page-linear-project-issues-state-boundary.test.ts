import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(
  join(COMPONENT_ROOT, 'use-task-page-linear-data-lifecycle.ts'),
  'utf8'
)

describe('TaskPage Linear project issues boundary', () => {
  it('keeps project-tab reads, limit clamping, and cancellation in its hook', () => {
    const MODULE_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'use-task-page-linear-project-issues-state.ts'),
      'utf8'
    )

    expect(MODULE_SOURCE.split('\n').length).toBeLessThan(140)
    expect(SURFACE_SOURCE).toContain("from './use-task-page-linear-project-issues-state'")
    expect(SURFACE_SOURCE).not.toContain('void listLinearProjectIssues(')
    expect(MODULE_SOURCE).toContain('listLinearProjectIssues(')
    expect(MODULE_SOURCE).toContain('clampLinearIssueListLimit(')
    expect(MODULE_SOURCE).toContain('setLinearProjectIssuesResult(result)')
    expect(MODULE_SOURCE).toContain('cancelled = true')
  })
})
