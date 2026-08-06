import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const COMPONENT_ROOT = __dirname
const SURFACE_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-surface.tsx'), 'utf8')
const BODY_SOURCE = readFileSync(join(COMPONENT_ROOT, 'task-page-linear-issue-body.tsx'), 'utf8')

describe('TaskPage Linear issue list boundary', () => {
  it('keeps Linear list row rendering in a bounded component', () => {
    const LIST_SOURCE = readFileSync(
      join(COMPONENT_ROOT, 'task-page-linear-issue-list.tsx'),
      'utf8'
    )

    expect(LIST_SOURCE.split('\n').length).toBeLessThan(320)
    expect(SURFACE_SOURCE).toContain("from './task-page-linear-issue-body'")
    expect(BODY_SOURCE).toContain("from './task-page-linear-issue-list'")
    expect(SURFACE_SOURCE).not.toContain('linearIssueListRows.map((row) =>')
    expect(LIST_SOURCE).toContain('export function TaskPageLinearIssueList')
    expect(LIST_SOURCE).toContain('onUseIssue')
  })
})
