import { describe, expect, it, vi } from 'vitest'
import type { AddWorktreeOptions, AddWorktreeResult } from '../git/worktree'
import { addLocalWorktree } from './worktree-remote-local-git-add'

describe('addLocalWorktree', () => {
  it('uses sparse checkout options when an existing branch is selected', async () => {
    const addWorktree = vi.fn()
    const addSparseWorktree = vi.fn().mockResolvedValue({} satisfies AddWorktreeResult)
    const addProjectGitOptions = vi.fn((options?: AddWorktreeOptions) => options)

    await addLocalWorktree(
      {
        repoPath: '/repo',
        worktreePath: '/worktree',
        branchName: 'feature',
        baseBranch: 'main',
        sparseDirectories: ['src'],
        refreshLocalBaseRefOnWorktreeCreate: true,
        checkoutExistingBranch: true,
        suggestLocalBaseRefUpdate: false,
        remoteTrackingBase: {
          remote: 'origin',
          base: 'origin/main',
          branch: 'main',
          ref: 'refs/remotes/origin/main'
        },
        addProjectGitOptions
      },
      { addWorktree, addSparseWorktree }
    )

    expect(addSparseWorktree).toHaveBeenCalledWith(
      '/repo',
      '/worktree',
      'feature',
      ['src'],
      'main',
      true,
      {
        checkoutExistingBranch: true,
          remoteTrackingBase: {
            remote: 'origin',
            base: 'origin/main',
            branch: 'main',
            ref: 'refs/remotes/origin/main'
          }
        }
    )
    expect(addWorktree).not.toHaveBeenCalled()
  })

  it('creates a regular worktree without an options object when no option is needed', async () => {
    const addWorktree = vi.fn().mockResolvedValue({} satisfies AddWorktreeResult)
    const addSparseWorktree = vi.fn()
    const addProjectGitOptions = vi.fn(() => undefined)

    await addLocalWorktree(
      {
        repoPath: '/repo',
        worktreePath: '/worktree',
        branchName: 'feature',
        baseBranch: 'main',
        sparseDirectories: [],
        refreshLocalBaseRefOnWorktreeCreate: false,
        checkoutExistingBranch: false,
        suggestLocalBaseRefUpdate: false,
        addProjectGitOptions
      },
      { addWorktree, addSparseWorktree }
    )

    expect(addWorktree).toHaveBeenCalledWith('/repo', '/worktree', 'feature', 'main', false, false)
    expect(addSparseWorktree).not.toHaveBeenCalled()
  })
})
