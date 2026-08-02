import type { RemoteTrackingBase } from '../runtime/orca-runtime'
import { addWorktree, addSparseWorktree } from '../git/worktree'
import type { AddWorktreeOptions, AddWorktreeResult } from '../git/worktree'

export type LocalWorktreeAddRequest = {
  repoPath: string
  worktreePath: string
  branchName: string
  baseBranch: string
  sparseDirectories: string[]
  refreshLocalBaseRefOnWorktreeCreate: boolean
  checkoutExistingBranch: boolean
  suggestLocalBaseRefUpdate: boolean
  remoteTrackingBase?: RemoteTrackingBase
  addProjectGitOptions: (options?: AddWorktreeOptions) => AddWorktreeOptions | undefined
}

export type LocalWorktreeAddDependencies = {
  addWorktree: typeof addWorktree
  addSparseWorktree: typeof addSparseWorktree
}

export async function addLocalWorktree(
  request: LocalWorktreeAddRequest,
  dependencies: LocalWorktreeAddDependencies = { addWorktree, addSparseWorktree }
): Promise<AddWorktreeResult> {
  const {
    repoPath,
    worktreePath,
    branchName,
    baseBranch,
    sparseDirectories,
    refreshLocalBaseRefOnWorktreeCreate,
    checkoutExistingBranch,
    suggestLocalBaseRefUpdate,
    remoteTrackingBase,
    addProjectGitOptions
  } = request
  const { addWorktree, addSparseWorktree } = dependencies
  const remoteTrackingBaseOption = remoteTrackingBase ? { remoteTrackingBase } : undefined
  const existingBranchOption = {
    checkoutExistingBranch,
    ...remoteTrackingBaseOption,
    ...(suggestLocalBaseRefUpdate ? { suggestLocalBaseRefUpdate } : {})
  }

  if (sparseDirectories.length > 0) {
    if (checkoutExistingBranch) {
      return addSparseWorktree(
        repoPath,
        worktreePath,
        branchName,
        sparseDirectories,
        baseBranch,
        refreshLocalBaseRefOnWorktreeCreate,
        addProjectGitOptions(existingBranchOption)
      )
    }
    if (suggestLocalBaseRefUpdate) {
      return addSparseWorktree(
        repoPath,
        worktreePath,
        branchName,
        sparseDirectories,
        baseBranch,
        refreshLocalBaseRefOnWorktreeCreate,
        addProjectGitOptions({ ...remoteTrackingBaseOption, suggestLocalBaseRefUpdate })
      )
    }
    const sparseOptions = addProjectGitOptions(remoteTrackingBaseOption)
    return sparseOptions
      ? addSparseWorktree(
          repoPath,
          worktreePath,
          branchName,
          sparseDirectories,
          baseBranch,
          refreshLocalBaseRefOnWorktreeCreate,
          sparseOptions
        )
      : addSparseWorktree(
          repoPath,
          worktreePath,
          branchName,
          sparseDirectories,
          baseBranch,
          refreshLocalBaseRefOnWorktreeCreate
        )
  }

  if (checkoutExistingBranch) {
    return addWorktree(
      repoPath,
      worktreePath,
      branchName,
      baseBranch,
      refreshLocalBaseRefOnWorktreeCreate,
      false,
      addProjectGitOptions(existingBranchOption)
    )
  }
  if (suggestLocalBaseRefUpdate) {
    return addWorktree(
      repoPath,
      worktreePath,
      branchName,
      baseBranch,
      refreshLocalBaseRefOnWorktreeCreate,
      false,
      addProjectGitOptions({ ...remoteTrackingBaseOption, suggestLocalBaseRefUpdate })
    )
  }
  const worktreeOptions = addProjectGitOptions(remoteTrackingBaseOption)
  return worktreeOptions
    ? addWorktree(
        repoPath,
        worktreePath,
        branchName,
        baseBranch,
        refreshLocalBaseRefOnWorktreeCreate,
        false,
        worktreeOptions
      )
    : addWorktree(
        repoPath,
        worktreePath,
        branchName,
        baseBranch,
        refreshLocalBaseRefOnWorktreeCreate,
        false
      )
}
