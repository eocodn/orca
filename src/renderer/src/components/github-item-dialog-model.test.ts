import { describe, expect, it } from 'vitest'
import {
  buildRequestedReviewUsers,
  getGitHubRepositoryLabelsUrl,
  mergeReviewerSuggestions,
  normalizeItemDialogTab
} from './github-item-dialog-model'

describe('GitHub item dialog model', () => {
  it('keeps the GitHub Enterprise host when building the labels URL', () => {
    expect(getGitHubRepositoryLabelsUrl('https://github.example.test/org/repo/issues/12')).toBe(
      'https://github.example.test/org/repo/labels'
    )
  })

  it('only exposes PR tabs for pull requests', () => {
    expect(normalizeItemDialogTab({ type: 'issue' } as never, 'files')).toBe('conversation')
    expect(normalizeItemDialogTab({ type: 'pr' } as never, undefined)).toBe('conversation')
    expect(normalizeItemDialogTab({ type: 'pr' } as never, 'checks')).toBe('checks')
  })

  it('merges reviewer suggestions case-insensitively and keeps avatar metadata', () => {
    expect(
      mergeReviewerSuggestions(
        [{ login: 'alice', name: null, avatarUrl: 'avatar.png' }],
        [{ login: 'Alice', name: 'Alice', avatarUrl: '' }]
      )
    ).toEqual([{ login: 'Alice', name: 'Alice', avatarUrl: 'avatar.png' }])
  })

  it('does not duplicate requested reviewers and preserves unknown logins', () => {
    expect(
      buildRequestedReviewUsers(
        ['Alice', 'bob'],
        [{ login: 'alice', name: 'Alice', avatarUrl: 'avatar.png' }],
        [{ login: 'ALICE', name: null, avatarUrl: '' }]
      )
    ).toEqual([
      { login: 'ALICE', name: null, avatarUrl: '' },
      { login: 'bob', name: null, avatarUrl: '' }
    ])
  })
})
