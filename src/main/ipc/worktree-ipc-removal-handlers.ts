import type { RemoveWorktreeResult } from '../../shared/types'
import { preservedBranchCleanupByWorktreeId } from './worktree-ipc-creation'
import type { RemoveWorktreeArgs } from './worktree-ipc-foundation'
import {
  getRepoForWorktreeRemoval,
  isAlreadyRemovedWorktreePath
} from './worktree-ipc-foundation'
import { removeLocalWorktreeAfterArchive } from './worktree-ipc-local-removal'
import type { WorktreeIpcRegistrationContext } from './worktree-ipc-registration-context'
import {
  assertWorktreeDoesNotContainRegisteredWorktree,
  assertWorktreeUnlockedForRemoval,
  canCleanupUnregisteredOrcaLeftoverDirectory,
  canCleanupUnregisteredOrcaWorktreeDirectory,
  canSafelyRemoveOrphanedWorktreeDirectory,
  cleanupUnusedWorktreePushTargetRemote,
  cleanupUnusedWorktreePushTargetRemoteSsh,
  clearProviderPtyState,
  findRegisteredDeletableWorktree,
  formatWorktreeRemovalError,
  getArchiveHooksForRemoval,
  getFolderWorkspaceRootId,
  getLocalProjectWorktreeGitOptions,
  getLocalPtyProvider,
  getLocalWorktreePathAccess,
  getRepoExecutionHostId,
  getSshFilesystemProvider,
  getWorktreeRemovalInFlightKey,
  getWorktreeRemovalOptionsKey,
  invalidateAuthorizedRootsCache,
  ipcMain,
  isDangerousWorktreeRemovalPath,
  isFolderRepo,
  isLocalGitRepository,
  isWindowsAbsolutePathLike,
  killAllProcessesForWorktree,
  listGitWorktreesStrict,
  notifyWorktreesChanged,
  ORPHANED_WORKTREE_DIRECTORY_MESSAGE,
  parseWorktreeId,
  preserveBranchHeadFallback,
  rememberPreservedBranchCleanupTarget,
  removeLocalWorktreePath,
  removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval,
  removeWorktreeMetadataAndTransientState,
  requireSshGitProvider,
  runHook,
  runRemoteArchiveHook,
  stopPtysForDestructiveWorktreeRemoval,
  toLocalWorktreeRuntimePath,
  UNREGISTERED_MISSING_WORKTREE_MESSAGE,
  withWorktreeRemoveStageSpan,
  withWorktreeSpan
} from './worktree-ipc-removal-runtime'

export function registerWorktreeRemovalHandler({
  mainWindow,
  store,
  runtime,
  options,
  worktreeRemovalsInFlight
}: Pick<WorktreeIpcRegistrationContext, 'mainWindow' | 'store' | 'runtime' | 'options' | 'worktreeRemovalsInFlight'>): void {
  ipcMain.handle(
    'worktrees:remove',
    async (_event, args: RemoveWorktreeArgs): Promise<RemoveWorktreeResult> => {
      const { repoId, worktreePath } = parseWorktreeId(args.worktreeId)
      const repo = getRepoForWorktreeRemoval(store, repoId, args.hostId)
      if (!repo) {
        throw new Error(`Repo not found: ${repoId}`)
      }
      const inFlightKey = getWorktreeRemovalInFlightKey(
        args.worktreeId,
        getRepoExecutionHostId(repo)
      )
      const optionsKey = getWorktreeRemovalOptionsKey(args)
      const inFlightRemoval = worktreeRemovalsInFlight.get(inFlightKey)
      if (inFlightRemoval) {
        if (inFlightRemoval.optionsKey === optionsKey) {
          return inFlightRemoval.promise
        }
        throw new Error(`Worktree deletion already in progress: ${args.worktreeId}`)
      }

      // Why: concurrent stale-toast/double-click/sidebar races can hit the same worktree; share the op so only one path touches Git and disk.
      const removal = (async (): Promise<RemoveWorktreeResult> => {
        // Why: worktree.create is traced; delete freezes were invisible without a matching worktree.remove parent span.
        return withWorktreeSpan({ stage: 'remove', path: worktreePath }, async () => {
          if (isFolderRepo(repo)) {
            if (args.worktreeId === getFolderWorkspaceRootId(repo)) {
              throw new Error(
                'Cannot delete the project root workspace. Remove the folder project instead.'
              )
            }
            // Why: folder workspaces share one root, so there's no Git remove step to close shells; sweep PTYs before dropping metadata.
            await withWorktreeRemoveStageSpan('pty_sweep', 'folder', async () => {
              await killAllProcessesForWorktree(args.worktreeId, {
                runtime,
                localProvider: getLocalPtyProvider(),
                onPtyStopped: clearProviderPtyState
              }).catch((err) => {
                console.warn(`[worktree-teardown] failed for ${args.worktreeId}:`, err)
              })
            })
            await withWorktreeRemoveStageSpan('metadata_purge', 'folder', async () => {
              removeWorktreeMetadataAndTransientState(store, args.worktreeId)
            })
            preservedBranchCleanupByWorktreeId.delete(args.worktreeId)
            notifyWorktreesChanged(mainWindow, repoId)
            return {}
          }

          // Why: renderer-supplied worktreeId embeds a path; re-derive the canonical path from git before any destructive action.
          const provider = repo.connectionId ? requireSshGitProvider(repo.connectionId) : null
          const localWorktreeGitOptions = repo.connectionId
            ? {}
            : getLocalProjectWorktreeGitOptions(store, repo)
          const hasLocalWorktreeGitOptions = Object.keys(localWorktreeGitOptions).length > 0
          const registeredWorktrees = repo.connectionId
            ? await provider!.listWorktrees(repo.path)
            : hasLocalWorktreeGitOptions
              ? await listGitWorktreesStrict(repo.path, localWorktreeGitOptions)
              : await listGitWorktreesStrict(repo.path)
          const removedMeta = store.getWorktreeMeta(args.worktreeId)
          const removedPushTarget = removedMeta?.pushTarget
          const registeredWorktree = findRegisteredDeletableWorktree(
            repo.path,
            worktreePath,
            registeredWorktrees
          )
          if (!registeredWorktree) {
            const fsProvider = repo.connectionId
              ? getSshFilesystemProvider(repo.connectionId)
              : null
            let canCleanOrphanedDirectory = false
            if (
              canCleanupUnregisteredOrcaWorktreeDirectory({
                meta: removedMeta
              })
            ) {
              if (repo.connectionId) {
                if (!fsProvider) {
                  throw new Error('SSH filesystem provider unavailable')
                }
                if (!fsProvider.lstat) {
                  throw new Error('SSH filesystem provider lstat unavailable')
                }
                canCleanOrphanedDirectory = await canSafelyRemoveOrphanedWorktreeDirectory(
                  worktreePath,
                  repo.path,
                  (path) => fsProvider.lstat!(path),
                  (path) => fsProvider.readFile(path)
                )
              } else {
                const access = getLocalWorktreePathAccess(localWorktreeGitOptions)
                canCleanOrphanedDirectory =
                  !isDangerousWorktreeRemovalPath(worktreePath, repo.path) &&
                  (await canSafelyRemoveOrphanedWorktreeDirectory(
                    toLocalWorktreeRuntimePath(worktreePath, localWorktreeGitOptions),
                    toLocalWorktreeRuntimePath(repo.path, localWorktreeGitOptions),
                    access.statPath,
                    access.readPath
                  ))
              }
            }
            if (canCleanOrphanedDirectory) {
              assertWorktreeDoesNotContainRegisteredWorktree(worktreePath, registeredWorktrees)
              if (!args.force) {
                throw new Error(ORPHANED_WORKTREE_DIRECTORY_MESSAGE)
              }
              if (repo.connectionId) {
                const removalGate = await runtime.acquireFileWatcherRemoval(
                  worktreePath,
                  repo.connectionId
                )
                let removalCompleted = false
                try {
                  await stopPtysForDestructiveWorktreeRemoval(
                    runtime,
                    args.worktreeId,
                    repo.connectionId
                  )
                  await fsProvider!.deletePath(worktreePath, true)
                  removalCompleted = true
                } finally {
                  await removalGate.finish(removalCompleted)
                }
                await cleanupUnusedWorktreePushTargetRemoteSsh(
                  provider!,
                  repo.path,
                  args.worktreeId,
                  removedPushTarget,
                  store
                )
              } else {
                const removalGate = await runtime.acquireFileWatcherRemoval(worktreePath)
                let removalCompleted = false
                try {
                  await stopPtysForDestructiveWorktreeRemoval(runtime, args.worktreeId)
                  await removeLocalWorktreePath(worktreePath, localWorktreeGitOptions)
                  removalCompleted = true
                } finally {
                  await removalGate.finish(removalCompleted)
                }
                await cleanupUnusedWorktreePushTargetRemote(
                  repo.path,
                  args.worktreeId,
                  removedPushTarget,
                  store,
                  localWorktreeGitOptions
                )
                invalidateAuthorizedRootsCache()
              }
              runtime.clearOptimisticReconcileToken(args.worktreeId)
              removeWorktreeMetadataAndTransientState(store, args.worktreeId)
              preservedBranchCleanupByWorktreeId.delete(args.worktreeId)
              notifyWorktreesChanged(mainWindow, repoId)
              return {}
            }
            if (!repo.connectionId) {
              const access = getLocalWorktreePathAccess(localWorktreeGitOptions)
              const runtimeWorktreePath = toLocalWorktreeRuntimePath(
                worktreePath,
                localWorktreeGitOptions
              )
              if (
                await canCleanupUnregisteredOrcaLeftoverDirectory({
                  meta: removedMeta,
                  worktreePath,
                  runtimeWorktreePath,
                  repo,
                  runtimeRepoPath: toLocalWorktreeRuntimePath(repo.path, localWorktreeGitOptions),
                  registeredWorktrees,
                  statPath: access.statPath,
                  isGitRepository: (path) => isLocalGitRepository(path, localWorktreeGitOptions)
                })
              ) {
                if (!args.force) {
                  throw new Error(ORPHANED_WORKTREE_DIRECTORY_MESSAGE)
                }
                const removalGate = await runtime.acquireFileWatcherRemoval(worktreePath)
                let removalCompleted = false
                try {
                  await stopPtysForDestructiveWorktreeRemoval(runtime, args.worktreeId)
                  await removeLocalWorktreePath(worktreePath, localWorktreeGitOptions)
                  removalCompleted = true
                } finally {
                  await removalGate.finish(removalCompleted)
                }
                await cleanupUnusedWorktreePushTargetRemote(
                  repo.path,
                  args.worktreeId,
                  removedPushTarget,
                  store,
                  localWorktreeGitOptions
                )
                runtime.clearOptimisticReconcileToken(args.worktreeId)
                removeWorktreeMetadataAndTransientState(store, args.worktreeId)
                preservedBranchCleanupByWorktreeId.delete(args.worktreeId)
                invalidateAuthorizedRootsCache()
                notifyWorktreesChanged(mainWindow, repoId)
                return {}
              }
            }
            if (await isAlreadyRemovedWorktreePath(repo, worktreePath, localWorktreeGitOptions)) {
              if (!args.force && !removedMeta) {
                // Why: without persisted metadata, require the renderer recovery path before deleting Orca-only state for an unregistered path.
                throw new Error(UNREGISTERED_MISSING_WORKTREE_MESSAGE)
              }
              // Why: a manually deleted worktree is already gone; persisted metadata proves it was an Orca-known row, so no force is needed.
              if (repo.connectionId) {
                await cleanupUnusedWorktreePushTargetRemoteSsh(
                  provider!,
                  repo.path,
                  args.worktreeId,
                  removedPushTarget,
                  store
                )
              } else {
                await cleanupUnusedWorktreePushTargetRemote(
                  repo.path,
                  args.worktreeId,
                  removedPushTarget,
                  store,
                  localWorktreeGitOptions
                )
                invalidateAuthorizedRootsCache()
              }
              runtime.clearOptimisticReconcileToken(args.worktreeId)
              removeWorktreeMetadataAndTransientState(store, args.worktreeId)
              preservedBranchCleanupByWorktreeId.delete(args.worktreeId)
              notifyWorktreesChanged(mainWindow, repoId)
              return {}
            }
            throw new Error(`Refusing to delete unregistered worktree path: ${worktreePath}`)
          }
          const canonicalWorktreePath = registeredWorktree.path
          const deleteBranch = removedMeta?.preserveBranchOnDelete !== true

          // Why: a Git lock must block before archive hooks or linked-path cleanup mutate the workspace; dirty-file force is separate.
          try {
            assertWorktreeUnlockedForRemoval(registeredWorktree)
          } catch (error) {
            throw new Error(
              formatWorktreeRemovalError(error, canonicalWorktreePath, args.force ?? false)
            )
          }

          // Why: a prior forced Windows recovery can delete the dir but leave a stale Git registration; verify before clearing metadata.
          if (
            !repo.connectionId &&
            args.force === true &&
            process.platform === 'win32' &&
            (isWindowsAbsolutePathLike(canonicalWorktreePath) ||
              !!localWorktreeGitOptions.wslDistro) &&
            removedMeta &&
            (await isAlreadyRemovedWorktreePath(
              repo,
              canonicalWorktreePath,
              localWorktreeGitOptions
            ))
          ) {
            const removalResult = await removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval({
              canonicalWorktreePath,
              repoPath: repo.path,
              localWorktreeGitOptions,
              registeredWorktree,
              deleteBranch
            })
            await cleanupUnusedWorktreePushTargetRemote(
              repo.path,
              args.worktreeId,
              removedPushTarget,
              store,
              localWorktreeGitOptions
            )
            rememberPreservedBranchCleanupTarget(
              args.worktreeId,
              removalResult,
              registeredWorktree.head,
              removedPushTarget
            )
            runtime.clearOptimisticReconcileToken(args.worktreeId)
            removeWorktreeMetadataAndTransientState(store, args.worktreeId)
            invalidateAuthorizedRootsCache()
            notifyWorktreesChanged(mainWindow, repoId)
            return removalResult ?? {}
          }

          // Run archive hook before removal so teardown scripts still see the worktree directory.
          const hooks = await getArchiveHooksForRemoval(repo)
          const archiveScript = hooks?.scripts.archive
          if (archiveScript && !args.skipArchive) {
            // Why the branch on connectionId: this block is shared by both flows, so a hardcoded
            // 'remote' would file every local archive hook under the SSH breakdown.
            await withWorktreeRemoveStageSpan(
              'archive_hook',
              repo.connectionId ? 'remote' : 'local',
              async () => {
                const result = repo.connectionId
                  ? await runRemoteArchiveHook(repo, canonicalWorktreePath, archiveScript)
                  : await runHook(
                      'archive',
                      canonicalWorktreePath,
                      repo,
                      undefined,
                      localWorktreeGitOptions
                    )
                if (!result.success) {
                  console.error(
                    `[hooks] archive hook failed for ${canonicalWorktreePath}:`,
                    result.output
                  )
                }
              }
            )
          }

          const remoteConnectionId = repo.connectionId ?? undefined
          if (remoteConnectionId) {
            // Why: SSH deletion mirrors the local flow — hooks run while the directory is intact, then the clean check guards removal.
            if (!args.force) {
              const { clean, stdout } = await provider!.worktreeIsClean(canonicalWorktreePath)
              if (!clean) {
                const error = new Error('Worktree has uncommitted or untracked changes.')
                ;(error as Error & { stdout?: string }).stdout = stdout
                throw error
              }
            }

            const remoteRemoveOptions = !deleteBranch ? { deleteBranch } : {}
            const removalGate = await withWorktreeRemoveStageSpan(
              'watcher_gate',
              'remote',
              async () =>
                runtime.acquireFileWatcherRemoval(canonicalWorktreePath, remoteConnectionId)
            )
            let rawRemovalResult: RemoveWorktreeResult | undefined
            let removalCompleted = false
            try {
              await withWorktreeRemoveStageSpan('pty_sweep', 'remote', async () => {
                await stopPtysForDestructiveWorktreeRemoval(
                  runtime,
                  args.worktreeId,
                  remoteConnectionId
                )
              })
              rawRemovalResult = await withWorktreeRemoveStageSpan(
                'git_remove',
                'remote',
                async () =>
                  Object.keys(remoteRemoveOptions).length > 0
                    ? provider!.removeWorktree(
                        canonicalWorktreePath,
                        args.force,
                        remoteRemoveOptions
                      )
                    : provider!.removeWorktree(canonicalWorktreePath, args.force)
              )
              removalCompleted = true
            } finally {
              await removalGate.finish(removalCompleted)
            }
            const removalResult = preserveBranchHeadFallback(
              rawRemovalResult,
              registeredWorktree.head
            )
            await cleanupUnusedWorktreePushTargetRemoteSsh(
              provider!,
              repo.path,
              args.worktreeId,
              removedPushTarget,
              store
            )
            rememberPreservedBranchCleanupTarget(
              args.worktreeId,
              removalResult,
              registeredWorktree.head,
              removedPushTarget
            )
            runtime.clearOptimisticReconcileToken(args.worktreeId)
            await withWorktreeRemoveStageSpan('metadata_purge', 'remote', async () => {
              removeWorktreeMetadataAndTransientState(store, args.worktreeId)
            })
            notifyWorktreesChanged(mainWindow, repoId)
            return removalResult ?? {}
          }

          return removeLocalWorktreeAfterArchive({
            mainWindow,
            store,
            runtime,
            repo,
            repoId,
            args,
            canonicalWorktreePath,
            localWorktreeGitOptions,
            hasLocalWorktreeGitOptions,
            deleteBranch,
            removedPushTarget
          })
        })
      })()
      worktreeRemovalsInFlight.set(inFlightKey, { optionsKey, promise: removal })
      try {
        const result = await removal
        options?.onWorktreeLifecycle?.({
          kind: 'removed',
          worktreeId: args.worktreeId,
          path: parseWorktreeId(args.worktreeId).worktreePath
        })
        return result
      } finally {
        if (worktreeRemovalsInFlight.get(inFlightKey)?.promise === removal) {
          worktreeRemovalsInFlight.delete(inFlightKey)
        }

      }
    }
  )

}
