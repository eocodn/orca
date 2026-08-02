import type { WorktreeIpcRegistrationContext } from './worktree-ipc-registration-context'
import {
  ipcMain,
  clearProviderPtyState,
  cleanupUnusedWorktreePushTargetRemote,
  cleanupUnusedWorktreePushTargetRemoteSsh,
  forceDeleteLocalBranch,
  getFolderWorkspaceRootId,
  getLocalProjectWorktreeGitOptions,
  getLocalPtyProvider,
  getRepoExecutionHostId,
  getWorktreeRemovalInFlightKey,
  isFolderRepo,
  killAllProcessesForWorktree,
  notifyWorktreesChanged,
  parseWorktreeId,
  type RemoveWorktreeResult,
  removeWorktreeMetadataAndTransientState,
  requireSshGitProvider,
  gitExecFileAsync,
  preservedBranchCleanupByWorktreeId,
  getPreservedBranchCleanupTarget
} from './worktree-ipc-removal-runtime'
import type { RemoveWorktreeArgs } from './worktree-ipc-foundation'
import { getRepoForWorktreeRemoval } from './worktree-ipc-foundation'

export function registerWorktreeRemovalCleanupHandlers({
  mainWindow,
  store,
  runtime,
  worktreeRemovalsInFlight
}: Pick<WorktreeIpcRegistrationContext, 'mainWindow' | 'store' | 'runtime' | 'worktreeRemovalsInFlight'>): void {
  ipcMain.handle(
    'worktrees:forgetLocal',
    async (
      _event,
      args: Pick<RemoveWorktreeArgs, 'worktreeId' | 'hostId'>
    ): Promise<RemoveWorktreeResult> => {
      const { repoId } = parseWorktreeId(args.worktreeId)
      const repo = getRepoForWorktreeRemoval(store, repoId, args.hostId)
      if (!repo) {
        throw new Error(`Repo not found: ${repoId}`)
      }
      // Why: share the removal in-flight map so concurrent remove and forgetLocal on the same id can't both mutate metadata.
      const inFlightKey = getWorktreeRemovalInFlightKey(
        args.worktreeId,
        getRepoExecutionHostId(repo)
      )
      const optionsKey = 'forget-local'
      const inFlight = worktreeRemovalsInFlight.get(inFlightKey)
      if (inFlight) {
        if (inFlight.optionsKey === optionsKey) {
          return inFlight.promise
        }
        throw new Error(`Worktree deletion already in progress: ${args.worktreeId}`)
      }

      const forget = (async (): Promise<RemoveWorktreeResult> => {
        if (isFolderRepo(repo) && args.worktreeId === getFolderWorkspaceRootId(repo)) {
          throw new Error(
            'Cannot delete the project root workspace. Remove the folder project instead.'
          )
        }

        // Why: best-effort PTY sweep; resolves synchronously for a dead SSH relay (tombstoned lease) so it never hangs.
        await killAllProcessesForWorktree(args.worktreeId, {
          runtime,
          localProvider: getLocalPtyProvider(),
          onPtyStopped: clearProviderPtyState
        }).catch((err) => {
          console.warn(`[worktree-teardown] forget-local failed for ${args.worktreeId}:`, err)
        })

        runtime.clearOptimisticReconcileToken(args.worktreeId)
        removeWorktreeMetadataAndTransientState(store, args.worktreeId)
        preservedBranchCleanupByWorktreeId.delete(args.worktreeId)
        notifyWorktreesChanged(mainWindow, repoId)
        return {}
      })()
      worktreeRemovalsInFlight.set(inFlightKey, { optionsKey, promise: forget })
      try {
        return await forget
      } finally {
        if (worktreeRemovalsInFlight.get(inFlightKey)?.promise === forget) {
          worktreeRemovalsInFlight.delete(inFlightKey)
        }
      }
    }
  )

  ipcMain.handle(
    'worktrees:forceDeletePreservedBranch',
    async (
      _event,
      args: { worktreeId: string; branchName: string; expectedHead: string }
    ): Promise<ForceDeleteWorktreeBranchResult> => {
      const { repoId } = parseWorktreeId(args.worktreeId)
      const cleanupTarget = getPreservedBranchCleanupTarget(
        args.worktreeId,
        args.branchName,
        args.expectedHead
      )
      const repo = store.getRepo(repoId)
      if (!repo) {
        throw new Error(`Repo not found: ${repoId}`)
      }
      if (isFolderRepo(repo)) {
        throw new Error('Folder workspaces do not have local Git branches.')
      }

      if (repo.connectionId) {
        const provider = requireSshGitProvider(repo.connectionId)
        // Why: SSH needs the write-capable relay RPC; the read-only git.exec allowlist rejects these worktree/update-ref/config writes.
        await provider.forceDeletePreservedBranch(
          repo.path,
          cleanupTarget.branchName,
          cleanupTarget.head
        )
        await cleanupUnusedWorktreePushTargetRemoteSsh(
          provider,
          repo.path,
          args.worktreeId,
          cleanupTarget.pushTarget,
          store
        )
      } else {
        const localWorktreeGitOptions = getLocalProjectWorktreeGitOptions(store, repo)
        const hasLocalWorktreeGitOptions = Object.keys(localWorktreeGitOptions).length > 0
        await (hasLocalWorktreeGitOptions
          ? forceDeleteLocalBranch(
              repo.path,
              cleanupTarget.branchName,
              cleanupTarget.head,
              (argv, cwd) => gitExecFileAsync(argv, { cwd, ...localWorktreeGitOptions })
            )
          : forceDeleteLocalBranch(repo.path, cleanupTarget.branchName, cleanupTarget.head))
        await cleanupUnusedWorktreePushTargetRemote(
          repo.path,
          args.worktreeId,
          cleanupTarget.pushTarget,
          store,
          localWorktreeGitOptions
        )
      }

      preservedBranchCleanupByWorktreeId.delete(args.worktreeId)
      return { deleted: true }
    }
  )

}
