import { gitExecFileAsync, type ForceDeleteWorktreeBranchResult, isFolderRepo, getLocalProjectWorktreeGitOptions, forceDeleteLocalBranch, cleanupUnusedWorktreePushTargetRemote, cleanupUnusedWorktreePushTargetRemoteSsh, requireSshGitProvider, parseExactWorktreeIdSelector } from './orca-runtime-symbols'
import { OrcaRuntimeResolveManagedMrBasePart57 } from './orca-runtime-resolve-managed-mr-base-part-57'

export class OrcaRuntimeForceDeletePreservedBranchPart58 extends OrcaRuntimeResolveManagedMrBasePart57 {
  async forceDeletePreservedBranch(
    worktreeSelector: string,
    branchName: string,
    expectedHead: string
  ): Promise<ForceDeleteWorktreeBranchResult> {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    const removalTarget = parseExactWorktreeIdSelector(worktreeSelector)
    const cleanupTarget = removalTarget
      ? this.preservedBranchCleanupByWorktreeId.get(removalTarget.id)
      : undefined
    if (
      !removalTarget ||
      !cleanupTarget ||
      cleanupTarget.branchName !== branchName ||
      cleanupTarget.head !== expectedHead
    ) {
      throw new Error(`No preserved branch cleanup is pending for "${branchName}".`)
    }

    const repo = this.store.getRepo(removalTarget.repoId)
    if (!repo) {
      throw new Error('repo_not_found')
    }
    if (isFolderRepo(repo)) {
      throw new Error('Folder workspaces do not have local Git branches.')
    }

    if (repo.connectionId) {
      const provider = requireSshGitProvider(repo.connectionId)
      // Why: SSH must use the write-capable relay RPC; the shared exec-based
      // helper routes through the read-only git.exec allowlist, which rejects
      // the worktree/update-ref/config writes this delete needs.
      await provider.forceDeletePreservedBranch(
        repo.path,
        cleanupTarget.branchName,
        cleanupTarget.head
      )
      await cleanupUnusedWorktreePushTargetRemoteSsh(
        provider,
        repo.path,
        removalTarget.id,
        cleanupTarget.pushTarget,
        this.store
      )
    } else {
      const localWorktreeGitOptions = getLocalProjectWorktreeGitOptions(this.requireStore(), repo)
      await (Object.keys(localWorktreeGitOptions).length > 0
        ? forceDeleteLocalBranch(
            repo.path,
            cleanupTarget.branchName,
            cleanupTarget.head,
            (argv, cwd) => gitExecFileAsync(argv, { cwd, ...localWorktreeGitOptions })
          )
        : forceDeleteLocalBranch(repo.path, cleanupTarget.branchName, cleanupTarget.head))
      await cleanupUnusedWorktreePushTargetRemote(
        repo.path,
        removalTarget.id,
        cleanupTarget.pushTarget,
        this.store,
        localWorktreeGitOptions
      )
    }

    this.preservedBranchCleanupByWorktreeId.delete(removalTarget.id)
    return { deleted: true }
  }
}
