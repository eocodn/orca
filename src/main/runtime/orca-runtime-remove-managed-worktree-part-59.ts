import { gitExecFileAsync, type RemoveWorktreeResult, assertWorktreeUnlockedForRemoval, getRepoExecutionHostId, isFolderRepo, isWindowsAbsolutePathLike, getLocalProjectWorktreeGitOptions, getLocalWorktreePathAccess, removeLocalWorktreePath, toLocalWorktreeRuntimePath, removeStaleLocalWorktreeRegistrationAfterFilesystemRemoval, recoverLocalWindowsWorktreeRemoval, listWorktreesStrict, assertWorktreeCleanForRemoval, removeWorktree, invalidateAuthorizedRootsCache, getEffectiveHooks, runHook, findExistingWorktreeSymlinkPaths, removeWorktreeLinkedPaths, getWorktreeSharedLinkPaths, cleanupUnusedWorktreePushTargetRemote, cleanupUnusedWorktreePushTargetRemoteSsh, formatWorktreeRemovalError, isOrphanCompatiblePreflightError, isOrphanedWorktreeError, assertWorktreeDoesNotContainRegisteredWorktree, canCleanupUnregisteredOrcaLeftoverDirectory, canCleanupUnregisteredOrcaWorktreeDirectory, canSafelyRemoveOrphanedWorktreeDirectory, findRegisteredDeletableWorktree, isDangerousWorktreeRemovalPath, ORPHANED_WORKTREE_DIRECTORY_MESSAGE, UNREGISTERED_MISSING_WORKTREE_MESSAGE, withWorktreeSpan, killAllProcessesForWorktree, getSshFilesystemProvider, requireSshGitProvider, getRuntimeWorktreeRemovalKey, getRuntimeWorktreeRemovalOptionsKey, isLocalRuntimeGitRepository, isRuntimeWorktreePathMissing, getRuntimeFolderWorkspaceRootId } from './orca-runtime-symbols'
import { OrcaRuntimeForceDeletePreservedBranchPart58 } from './orca-runtime-force-delete-preserved-branch-part-58'
import type { OrcaRuntimeService } from './orca-runtime'

export class OrcaRuntimeRemoveManagedWorktreePart59 extends OrcaRuntimeForceDeletePreservedBranchPart58 {
  async removeManagedWorktree(
    worktreeSelector: string,
    force = false,
    runHooks = false
  ): Promise<RemoveWorktreeResult & { warning?: string }> {
    if (!this.store) {
      throw new Error('runtime_unavailable')
    }
    const store = this.store
    const removalTarget = await this.resolveWorktreeRemovalTarget(worktreeSelector)
    const optionsKey = getRuntimeWorktreeRemovalOptionsKey(force, runHooks)
    const removalKey = getRuntimeWorktreeRemovalKey(removalTarget)
    const inFlightRemoval = this.removeManagedWorktreeInFlight.get(removalKey)
    if (inFlightRemoval) {
      if (inFlightRemoval.optionsKey === optionsKey) {
        return inFlightRemoval.promise
      }
      throw new Error(`Worktree deletion already in progress: ${removalTarget.id}`)
    }

    // Why: runtime callers can race the same workspace through CLI/mobile
    // retries. Share one destructive Git/filesystem operation per worktree ID.
    const removal = (async (): Promise<RemoveWorktreeResult & { warning?: string }> => {
      // Why: CLI, mobile and headless serve delete through here rather than the IPC handler; without
      // this span their freezes are as invisible as desktop deletes were before `worktree.remove`.
      return withWorktreeSpan({ stage: 'remove', path: removalTarget.path }, async () => {
        const repo =
          store
            .getRepos()
            .find(
              (candidate) =>
                candidate.id === removalTarget.repoId &&
                (!removalTarget.hostId ||
                  getRepoExecutionHostId(candidate) === removalTarget.hostId)
            ) ?? store.getRepo(removalTarget.repoId)
        if (!repo) {
          throw new Error('repo_not_found')
        }
        if (isFolderRepo(repo)) {
          if (removalTarget.id === getRuntimeFolderWorkspaceRootId(repo)) {
            throw new Error(
              'Cannot delete the project root workspace. Remove the folder project instead.'
            )
          }
          const localProvider = this.getLocalProvider()
          if (localProvider) {
            // Why: folder workspace deletion has no Git removal phase where PTYs
            // would otherwise be swept; tear them down before hiding the workspace.
            await killAllProcessesForWorktree(removalTarget.id, {
              runtime: this as unknown as OrcaRuntimeService,
              localProvider,
              onPtyStopped: this.onPtyStopped ?? undefined
            }).catch((err) => {
              console.warn(`[worktree-teardown] failed for ${removalTarget.id}:`, err)
            })
          }
          this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
          this.preservedBranchCleanupByWorktreeId.delete(removalTarget.id)
          this.invalidateResolvedWorktreeCache()
          this.notifyWorktreesChanged(repo.id)
          return {}
        }
        const provider = repo.connectionId ? requireSshGitProvider(repo.connectionId) : null
        const fsProvider = repo.connectionId ? getSshFilesystemProvider(repo.connectionId) : null
        const localWorktreeGitOptions = repo.connectionId
          ? {}
          : getLocalProjectWorktreeGitOptions(this.requireStore(), repo)
        const hasLocalWorktreeGitOptions = Object.keys(localWorktreeGitOptions).length > 0
        const registeredWorktrees = repo.connectionId
          ? await provider!.listWorktrees(repo.path)
          : hasLocalWorktreeGitOptions
            ? await listWorktreesStrict(repo.path, localWorktreeGitOptions)
            : await listWorktreesStrict(repo.path)
        const removedMeta = store.getWorktreeMeta(removalTarget.id)
        const removedPushTarget = removedMeta?.pushTarget ?? removalTarget.pushTarget
        const registeredWorktree = findRegisteredDeletableWorktree(
          repo.path,
          removalTarget.path,
          registeredWorktrees
        )
        if (!registeredWorktree) {
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
                removalTarget.path,
                repo.path,
                (path) => fsProvider.lstat!(path),
                (path) => fsProvider.readFile(path)
              )
            } else {
              const access = getLocalWorktreePathAccess(localWorktreeGitOptions)
              canCleanOrphanedDirectory =
                !isDangerousWorktreeRemovalPath(removalTarget.path, repo.path) &&
                (await canSafelyRemoveOrphanedWorktreeDirectory(
                  toLocalWorktreeRuntimePath(removalTarget.path, localWorktreeGitOptions),
                  toLocalWorktreeRuntimePath(repo.path, localWorktreeGitOptions),
                  access.statPath,
                  access.readPath
                ))
            }
          }
          if (canCleanOrphanedDirectory) {
            assertWorktreeDoesNotContainRegisteredWorktree(removalTarget.path, registeredWorktrees)
            if (!force) {
              throw new Error(ORPHANED_WORKTREE_DIRECTORY_MESSAGE)
            }
            if (repo.connectionId) {
              const removalGate = await this.acquireFileWatcherRemoval(
                removalTarget.path,
                repo.connectionId
              )
              let removalCompleted = false
              try {
                await this.stopPtysForDestructiveWorktreeRemoval(
                  removalTarget.id,
                  repo.connectionId
                )
                await fsProvider!.deletePath(removalTarget.path, true)
                removalCompleted = true
              } finally {
                await removalGate.finish(removalCompleted)
              }
              await cleanupUnusedWorktreePushTargetRemoteSsh(
                provider!,
                repo.path,
                removalTarget.id,
                removedPushTarget,
                store
              )
            } else {
              const removalGate = await this.acquireFileWatcherRemoval(removalTarget.path)
              let removalCompleted = false
              try {
                await this.stopPtysForDestructiveWorktreeRemoval(removalTarget.id)
                await removeLocalWorktreePath(removalTarget.path, localWorktreeGitOptions)
                removalCompleted = true
              } finally {
                await removalGate.finish(removalCompleted)
              }
              await cleanupUnusedWorktreePushTargetRemote(
                repo.path,
                removalTarget.id,
                removedPushTarget,
                store,
                localWorktreeGitOptions
              )
            }
            this.clearOptimisticReconcileToken(removalTarget.id)
            this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
            this.preservedBranchCleanupByWorktreeId.delete(removalTarget.id)
            this.invalidateResolvedWorktreeCache()
            this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
            invalidateAuthorizedRootsCache()
            this.notifyWorktreesChanged(repo.id)
            return {}
          }
          if (!repo.connectionId) {
            const access = getLocalWorktreePathAccess(localWorktreeGitOptions)
            const runtimeWorktreePath = toLocalWorktreeRuntimePath(
              removalTarget.path,
              localWorktreeGitOptions
            )
            if (
              await canCleanupUnregisteredOrcaLeftoverDirectory({
                meta: removedMeta,
                worktreePath: removalTarget.path,
                runtimeWorktreePath,
                repo,
                runtimeRepoPath: toLocalWorktreeRuntimePath(repo.path, localWorktreeGitOptions),
                registeredWorktrees,
                statPath: access.statPath,
                isGitRepository: (path) =>
                  isLocalRuntimeGitRepository(path, localWorktreeGitOptions)
              })
            ) {
              if (!force) {
                throw new Error(ORPHANED_WORKTREE_DIRECTORY_MESSAGE)
              }
              const removalGate = await this.acquireFileWatcherRemoval(removalTarget.path)
              let removalCompleted = false
              try {
                await this.stopPtysForDestructiveWorktreeRemoval(removalTarget.id)
                await removeLocalWorktreePath(removalTarget.path, localWorktreeGitOptions)
                removalCompleted = true
              } finally {
                await removalGate.finish(removalCompleted)
              }
              await cleanupUnusedWorktreePushTargetRemote(
                repo.path,
                removalTarget.id,
                removedPushTarget,
                store,
                localWorktreeGitOptions
              )
              this.clearOptimisticReconcileToken(removalTarget.id)
              this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
              this.preservedBranchCleanupByWorktreeId.delete(removalTarget.id)
              this.invalidateResolvedWorktreeCache()
              this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
              invalidateAuthorizedRootsCache()
              this.notifyWorktreesChanged(repo.id)
              return {}
            }
          }
          if (
            await isRuntimeWorktreePathMissing(repo, removalTarget.path, localWorktreeGitOptions)
          ) {
            if (!force && !removedMeta) {
              // Why: without persisted metadata, require the renderer recovery
              // path before deleting Orca-only state for an unregistered path.
              throw new Error(UNREGISTERED_MISSING_WORKTREE_MESSAGE)
            }
            // Why: a manually deleted worktree is already gone from Git and disk.
            // Finish runtime metadata cleanup without requiring force or touching
            // any unregistered path that still exists.
            await (repo.connectionId
              ? cleanupUnusedWorktreePushTargetRemoteSsh(
                  provider!,
                  repo.path,
                  removalTarget.id,
                  removedPushTarget,
                  store
                )
              : cleanupUnusedWorktreePushTargetRemote(
                  repo.path,
                  removalTarget.id,
                  removedPushTarget,
                  store,
                  localWorktreeGitOptions
                ))
            this.clearOptimisticReconcileToken(removalTarget.id)
            this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
            this.preservedBranchCleanupByWorktreeId.delete(removalTarget.id)
            this.invalidateResolvedWorktreeCache()
            this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
            invalidateAuthorizedRootsCache()
            this.notifyWorktreesChanged(repo.id)
            return {}
          }
          throw new Error(`Refusing to delete unregistered worktree path: ${removalTarget.path}`)
        }
        const canonicalWorktreePath = registeredWorktree.path
        const deleteBranch = removedMeta?.preserveBranchOnDelete !== true

        // Why: a Git lock must block before archive hooks or linked-path cleanup
        // mutate the workspace; dirty-file force is a separate permission.
        try {
          assertWorktreeUnlockedForRemoval(registeredWorktree)
        } catch (error) {
          throw new Error(formatWorktreeRemovalError(error, canonicalWorktreePath, force))
        }

        // Why: a prior forced Windows recovery can delete the directory but leave
        // Git's stale registration; recover and verify it before clearing metadata.
        if (
          !repo.connectionId &&
          force === true &&
          process.platform === 'win32' &&
          (isWindowsAbsolutePathLike(canonicalWorktreePath) ||
            !!localWorktreeGitOptions.wslDistro) &&
          removedMeta &&
          (await isRuntimeWorktreePathMissing(repo, canonicalWorktreePath, localWorktreeGitOptions))
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
            removalTarget.id,
            removedPushTarget,
            store,
            localWorktreeGitOptions
          )
          this.rememberPreservedBranchCleanupTarget(
            removalTarget.id,
            removalResult,
            registeredWorktree.head,
            removedPushTarget
          )
          this.clearOptimisticReconcileToken(removalTarget.id)
          this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
          this.invalidateResolvedWorktreeCache()
          this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
          invalidateAuthorizedRootsCache()
          this.notifyWorktreesChanged(repo.id)
          return removalResult ?? {}
        }
        if (repo.connectionId) {
          const remoteRemoveOptions = !deleteBranch ? { deleteBranch } : {}
          const removalGate = await this.acquireFileWatcherRemoval(
            canonicalWorktreePath,
            repo.connectionId
          )
          let rawRemovalResult: RemoveWorktreeResult | undefined
          let removalCompleted = false
          try {
            await this.stopPtysForDestructiveWorktreeRemoval(removalTarget.id, repo.connectionId)
            rawRemovalResult = await (Object.keys(remoteRemoveOptions).length > 0
              ? provider!.removeWorktree(canonicalWorktreePath, force, remoteRemoveOptions)
              : provider!.removeWorktree(canonicalWorktreePath, force))
            removalCompleted = true
          } finally {
            await removalGate.finish(removalCompleted)
          }
          const removalResult = this.preserveBranchHeadFallback(
            rawRemovalResult,
            registeredWorktree.head
          )
          await cleanupUnusedWorktreePushTargetRemoteSsh(
            provider!,
            repo.path,
            removalTarget.id,
            removedPushTarget,
            store
          )
          this.rememberPreservedBranchCleanupTarget(
            removalTarget.id,
            removalResult,
            registeredWorktree.head,
            removedPushTarget
          )
          this.clearOptimisticReconcileToken(removalTarget.id)
          this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
          this.invalidateResolvedWorktreeCache()
          this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
          invalidateAuthorizedRootsCache()
          this.notifyWorktreesChanged(repo.id)
          return removalResult ?? {}
        }

        const hooks = getEffectiveHooks(repo)
        let warning: string | undefined
        if (hooks?.scripts.archive && runHooks) {
          const result = await runHook(
            'archive',
            canonicalWorktreePath,
            repo,
            undefined,
            hasLocalWorktreeGitOptions ? localWorktreeGitOptions : undefined
          )
          if (!result.success) {
            console.error(
              `[hooks] archive hook failed for ${canonicalWorktreePath}:`,
              result.output
            )
          }
        } else if (hooks?.scripts.archive) {
          // Runtime RPC calls have no renderer trust prompt, so hooks require explicit CLI opt-in.
          warning = `orca.yaml archive hook skipped for ${canonicalWorktreePath}; pass --run-hooks to run it.`
          console.warn(`[hooks] ${warning}`)
        }

        const refreshedWorktrees = hasLocalWorktreeGitOptions
          ? await listWorktreesStrict(repo.path, localWorktreeGitOptions)
          : await listWorktreesStrict(repo.path)
        const refreshedRegisteredWorktree = findRegisteredDeletableWorktree(
          repo.path,
          canonicalWorktreePath,
          refreshedWorktrees
        )
        if (!refreshedRegisteredWorktree) {
          throw new Error(
            `Worktree registration changed during deletion: ${canonicalWorktreePath}. Retry deletion.`
          )
        }
        try {
          // Why: an archive hook can race another Git client that locks the row;
          // recheck before linked-path, watcher, or terminal teardown side effects.
          assertWorktreeUnlockedForRemoval(refreshedRegisteredWorktree)
        } catch (error) {
          throw new Error(formatWorktreeRemovalError(error, canonicalWorktreePath, force))
        }

        // Why: `orca.yaml` shared directories are symlinked in too, and a
        // directory-only ignore rule leaves those links untracked, so removal must
        // tolerate and unlink them exactly like the per-user shared paths.
        const linkedPaths = getWorktreeSharedLinkPaths(repo)
        const ignoredLinkedPaths = force
          ? []
          : await findExistingWorktreeSymlinkPaths(canonicalWorktreePath, linkedPaths)
        try {
          await (hasLocalWorktreeGitOptions
            ? assertWorktreeCleanForRemoval(canonicalWorktreePath, force, {
                ...localWorktreeGitOptions,
                ...(ignoredLinkedPaths.length > 0
                  ? { ignoredUntrackedPaths: ignoredLinkedPaths }
                  : {})
              })
            : ignoredLinkedPaths.length > 0
              ? assertWorktreeCleanForRemoval(canonicalWorktreePath, force, {
                  ignoredUntrackedPaths: ignoredLinkedPaths
                })
              : assertWorktreeCleanForRemoval(canonicalWorktreePath, force))
        } catch (error) {
          if (!isOrphanCompatiblePreflightError(error)) {
            throw new Error(formatWorktreeRemovalError(error, canonicalWorktreePath, force))
          }
          // Why: Git can still classify this as an orphan after preflight;
          // retain strict PTY teardown before any recursive fallback deletion.
        }

        let removalResult: RemoveWorktreeResult | undefined
        const removalGate = await this.acquireFileWatcherRemoval(canonicalWorktreePath)
        let removalCompleted = false
        try {
          // Why: linked-path deletion is destructive too; PTYs must release every
          // handle before Windows or WSL filesystem cleanup starts.
          await this.stopPtysForDestructiveWorktreeRemoval(removalTarget.id)

          if (linkedPaths.length > 0) {
            await removeWorktreeLinkedPaths(canonicalWorktreePath, linkedPaths)
          }

          try {
            const removeOptions = {
              ...(!deleteBranch ? { deleteBranch } : {}),
              // Why: removal already validated the Git row under the selected
              // project runtime; keep branch cleanup on that same canonical row.
              knownRemovedWorktree: refreshedRegisteredWorktree,
              ...localWorktreeGitOptions
            }
            removalResult = this.preserveBranchHeadFallback(
              await removeWorktree(repo.path, canonicalWorktreePath, force, removeOptions),
              refreshedRegisteredWorktree.head
            )
          } catch (error) {
            // Why: Git for Windows can deregister a clean worktree before its
            // recursive filesystem deletion fails transiently.
            const recoveredRemovalResult = await recoverLocalWindowsWorktreeRemoval({
              error,
              force,
              canonicalWorktreePath,
              repoPath: repo.path,
              localWorktreeGitOptions,
              registeredWorktree: refreshedRegisteredWorktree,
              deleteBranch,
              closeWatcher: (worktreePath) => this.closeFileWatchersForRemoval(worktreePath)
            })
            if (recoveredRemovalResult) {
              removalResult = recoveredRemovalResult
              removalCompleted = true
            } else if (isOrphanedWorktreeError(error)) {
              const access = getLocalWorktreePathAccess(localWorktreeGitOptions)
              if (
                await canSafelyRemoveOrphanedWorktreeDirectory(
                  toLocalWorktreeRuntimePath(canonicalWorktreePath, localWorktreeGitOptions),
                  toLocalWorktreeRuntimePath(repo.path, localWorktreeGitOptions),
                  access.statPath,
                  access.readPath
                )
              ) {
                await this.closeFileWatchersForRemoval(canonicalWorktreePath)
                await removeLocalWorktreePath(canonicalWorktreePath, localWorktreeGitOptions).catch(
                  () => {}
                )
              } else {
                console.warn(
                  `[worktrees] Refusing recursive cleanup for unproven worktree directory: ${canonicalWorktreePath}`
                )
              }
              // Why: `git worktree remove` failed, so git's internal worktree tracking
              // (`.git/worktrees/<name>`) is still intact. Without pruning, `git worktree
              // list` continues to show the stale entry and the branch it had checked out
              // remains locked — other worktrees cannot check it out.
              await gitExecFileAsync(['worktree', 'prune'], {
                cwd: repo.path,
                ...localWorktreeGitOptions
              }).catch(() => {})
              await cleanupUnusedWorktreePushTargetRemote(
                repo.path,
                removalTarget.id,
                removedPushTarget,
                store,
                localWorktreeGitOptions
              )
              this.clearOptimisticReconcileToken(removalTarget.id)
              this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
              this.preservedBranchCleanupByWorktreeId.delete(removalTarget.id)
              this.invalidateResolvedWorktreeCache()
              this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
              invalidateAuthorizedRootsCache()
              this.notifyWorktreesChanged(repo.id)
              removalCompleted = true
              return (warning ? { warning } : {})
            } else {
              throw new Error(formatWorktreeRemovalError(error, canonicalWorktreePath, force))
            }
          }
          removalCompleted = true
        } finally {
          await removalGate.finish(removalCompleted)
        }

        await cleanupUnusedWorktreePushTargetRemote(
          repo.path,
          removalTarget.id,
          removedPushTarget,
          store,
          localWorktreeGitOptions
        )
        this.rememberPreservedBranchCleanupTarget(
          removalTarget.id,
          removalResult,
          refreshedRegisteredWorktree.head,
          removedPushTarget
        )
        this.clearOptimisticReconcileToken(removalTarget.id)
        this.removeWorktreeMetadataAndHistory(store, removalTarget.id)
        this.invalidateResolvedWorktreeCache()
        this.invalidateWorktreeScanCacheForRepo(removalTarget.repoId)
        invalidateAuthorizedRootsCache()
        this.notifyWorktreesChanged(repo.id)
        return {
          ...removalResult,
          ...(warning ? { warning } : {})
        }
      })
    })()
    this.removeManagedWorktreeInFlight.set(removalKey, { optionsKey, promise: removal })
    try {
      const result = await removal
      this.emitWorktreeLifecycle({
        kind: 'removed',
        worktreeId: removalTarget.id,
        path: removalTarget.path
      })
      return result
    } finally {
      if (this.removeManagedWorktreeInFlight.get(removalKey)?.promise === removal) {
        this.removeManagedWorktreeInFlight.delete(removalKey)
      }
    }
  }
}
