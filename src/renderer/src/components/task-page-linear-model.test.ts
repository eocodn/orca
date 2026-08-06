import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LINEAR_DISPLAY_PROPERTIES,
  findLinearWorkflowStateForStatus,
  getLinearStatusSectionState,
  mergeLinearCollectionResults
} from './task-page-linear-model'

describe('TaskPage Linear model', () => {
  it('merges collection pages while retaining errors and pagination state', () => {
    expect(
      mergeLinearCollectionResults([
        { items: [{ id: 'one' }], hasMore: true },
        { items: [{ id: 'two' }], errors: ['partial'] }
      ])
    ).toEqual({
      items: [{ id: 'one' }, { id: 'two' }],
      errors: ['partial'],
      hasMore: true
    })
  })

  it('resolves status sections and workflow states by type before name', () => {
    const state = { name: 'Done', type: 'completed' as const }
    expect(getLinearStatusSectionState({ key: 'status:done', issues: [{ state }] } as never)).toEqual(
      state
    )
    expect(findLinearWorkflowStateForStatus([
      { id: 'other', name: 'Done', type: 'canceled' },
      { id: 'match', name: 'Done', type: 'completed' }
    ] as never, state)).toEqual({ id: 'match', name: 'Done', type: 'completed' })
  })

  it('keeps the documented default display property order', () => {
    expect(DEFAULT_LINEAR_DISPLAY_PROPERTIES).toEqual([
      'state',
      'priority',
      'assignee',
      'team',
      'labels',
      'updated'
    ])
  })
})
