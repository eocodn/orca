import { describe, expect, it } from 'vitest'
import {
  getEffectiveLinearDisplayProperties,
  getLinearIssueListRows,
  getLinearIssuePageState
} from './task-page-linear-list-model'

describe('TaskPage Linear list model', () => {
  it('calculates the visible page and the next fetch page', () => {
    const issues = [{ id: 'one' }, { id: 'two' }, { id: 'three' }] as never[]

    expect(getLinearIssuePageState(issues, 1, 2, true)).toEqual({
      loadedPages: 2,
      totalPages: 3,
      visiblePage: 1,
      issues: [{ id: 'three' }]
    })
  })

  it('hides the property used for grouping and applies team defaults', () => {
    expect(getEffectiveLinearDisplayProperties(['state', 'team', 'updated'], 'status', 1, false)).toEqual(
      new Set(['updated'])
    )
    expect(getEffectiveLinearDisplayProperties(['state', 'updated'], 'none', 2, false)).toEqual(
      new Set(['state', 'updated', 'team'])
    )
  })

  it('adds section rows only when list grouping is enabled', () => {
    const sections = [{ key: 'status:done', label: 'Done', issues: [{ id: 'one' }] }] as never

    expect(getLinearIssueListRows(sections, 'status')).toEqual([
      { type: 'section', key: 'status:done', label: 'Done', count: 1 },
      { type: 'issue', issue: { id: 'one' } }
    ])
    expect(getLinearIssueListRows(sections, 'none')).toEqual([{ type: 'issue', issue: { id: 'one' } }])
  })
})
