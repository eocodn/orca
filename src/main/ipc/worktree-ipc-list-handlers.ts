import { ipcMain } from 'electron'
import type { DetectedWorktreeListResult } from '../../shared/types'
import { isFolderRepo } from '../../shared/repo-kind'
import { parseExecutionHostId } from '../../shared/execution-host'
import type {
  DirectSshDetectedWorktreeRequest,
  HostQualifiedDetectedWorktreeResult,
  ProviderRequestId
} from '../../shared/detected-worktree-provider-contract'
import { getSshProviderAuthority, isCurrentSshProviderAuthority, registerSshProviderRequestAbort } from '../ssh/ssh-provider-authority'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import {
  DETECTED_WORKTREE_PROVIDER_TIMEOUT_MS,
  WORKTREE_LIST_ALL_CONCURRENCY,
  listDetectedGitWorktrees,
  loggedUnavailableSshGitProviders,
  loggedWorktreeListFailures,
  mapWithConcurrency,
  rememberLocalWorktreeRoots,
  warnOnce
} from './worktree-ipc-creation'
import {
  buildDetectedGitWorktrees,
  createSshWorktreeMetaIndex,
  listDisconnectedSshWorktrees,
  pruneLineageForMissingRepoWorktrees,
  stampAndMergeVisibleDetectedWorktree
} from './worktree-ipc-remote'
import {
  findExactRepoOwner,
  isCapturedRepoCurrent,
  listDetectedWorktreesForCapturedRepo,
  listVisibleFolderWorkspaces
} from './worktree-ipc-local'
import {
  hasValidDirectSshAuthority,
  listHostQualifiedDetectedWorktrees
} from './worktree-ipc-events'
import type { DetectedWorktreeRequestArgs } from './worktree-ipc-foundation'
import type { WorktreeIpcRegistrationContext } from './worktree-ipc-registration-context'

export function registerWorktreeListHandlers({
  store,
  detectedWorktreeCancellations
}: Pick<WorktreeIpcRegistrationContext, 'store' | 'detectedWorktreeCancellations'>): void {
  ipcMain.handle('worktrees:listAll', async () => {
    const repos = store.getRepos()
    const sshWorktreeMetaIndex = repos.some((repo) => repo.connectionId)
      ? createSshWorktreeMetaIndex(Object.entries(store.getAllWorktreeMeta()))
      : new Map()

    // Why: each local repo listing can spawn `git worktree list`; cap fan-out so large fleets don't start unbounded subprocesses.
    const results = await mapWithConcurrency(repos, WORKTREE_LIST_ALL_CONCURRENCY, async (repo) => {
      try {
        let gitWorktrees
        let freshScan = true
        if (isFolderRepo(repo)) {
          return listVisibleFolderWorkspaces(store, repo)
        } else if (repo.connectionId) {
          const provider = getSshGitProvider(repo.connectionId)
          if (!provider) {
            warnOnce(
              loggedUnavailableSshGitProviders,
              `${repo.connectionId}:${repo.id}`,
              `[worktrees] SSH git provider unavailable; skipping worktree list for repo "${repo.displayName}" (${repo.id}) at ${repo.path} on connection ${repo.connectionId}`
            )
            return listDisconnectedSshWorktrees(store, repo, sshWorktreeMetaIndex)
          }
          loggedUnavailableSshGitProviders.delete(`${repo.connectionId}:${repo.id}`)
          try {
            gitWorktrees = await provider.listWorktrees(repo.path)
          } catch (err) {
            warnOnce(
              loggedWorktreeListFailures,
              `${repo.id}:${repo.path}`,
              `[worktrees] failed to list worktrees for repo "${repo.displayName}" (${repo.id}) at ${repo.path}`,
              err
            )
            return listDisconnectedSshWorktrees(store, repo, sshWorktreeMetaIndex)
          }
        } else {
          const scan = await listDetectedGitWorktrees(store, repo)
          gitWorktrees = scan.gitWorktrees
          freshScan = scan.fresh
        }
        if (freshScan) {
          rememberLocalWorktreeRoots(store, repo, gitWorktrees)
          pruneLineageForMissingRepoWorktrees(store, repo, gitWorktrees)
        }
        loggedWorktreeListFailures.delete(`${repo.id}:${repo.path}`)
        return buildDetectedGitWorktrees(store, repo, gitWorktrees)
          .filter((worktree) => worktree.visible)
          .map((worktree) => stampAndMergeVisibleDetectedWorktree(store, repo, worktree))
      } catch (err) {
        warnOnce(
          loggedWorktreeListFailures,
          `${repo.id}:${repo.path}`,
          `[worktrees] failed to list worktrees for repo "${repo.displayName}" (${repo.id}) at ${repo.path}`,
          err
        )
        // Why: do NOT seed empty success — it flags the repo registered, blocking access to legit linked worktrees until the cache is invalidated.
        return []
      }
    })

    return results.flat()
  })

  ipcMain.handle('worktrees:list', async (_event, args: { repoId: string }) => {
    const repo = store.getRepo(args.repoId)
    if (!repo) {
      return []
    }
    const sshWorktreeMetaIndex = repo.connectionId
      ? createSshWorktreeMetaIndex(Object.entries(store.getAllWorktreeMeta()))
      : new Map()

    try {
      let gitWorktrees
      let freshScan = true
      if (isFolderRepo(repo)) {
        return listVisibleFolderWorkspaces(store, repo)
      } else if (repo.connectionId) {
        const provider = getSshGitProvider(repo.connectionId)
        if (!provider) {
          warnOnce(
            loggedUnavailableSshGitProviders,
            `${repo.connectionId}:${repo.id}`,
            `[worktrees] SSH git provider unavailable; skipping worktree list for repo "${repo.displayName}" (${repo.id}) at ${repo.path} on connection ${repo.connectionId}`
          )
          return listDisconnectedSshWorktrees(store, repo, sshWorktreeMetaIndex)
        }
        loggedUnavailableSshGitProviders.delete(`${repo.connectionId}:${repo.id}`)
        try {
          gitWorktrees = await provider.listWorktrees(repo.path)
        } catch (err) {
          warnOnce(
            loggedWorktreeListFailures,
            `${repo.id}:${repo.path}`,
            `[worktrees] failed to list worktrees for repo "${repo.displayName}" (${repo.id}) at ${repo.path}`,
            err
          )
          return listDisconnectedSshWorktrees(store, repo, sshWorktreeMetaIndex)
        }
      } else {
        const scan = await listDetectedGitWorktrees(store, repo)
        gitWorktrees = scan.gitWorktrees
        freshScan = scan.fresh
      }
      if (freshScan) {
        rememberLocalWorktreeRoots(store, repo, gitWorktrees)
        pruneLineageForMissingRepoWorktrees(store, repo, gitWorktrees)
      }
      loggedWorktreeListFailures.delete(`${repo.id}:${repo.path}`)
      return buildDetectedGitWorktrees(store, repo, gitWorktrees)
        .filter((worktree) => worktree.visible)
        .map((worktree) => stampAndMergeVisibleDetectedWorktree(store, repo, worktree))
    } catch (err) {
      warnOnce(
        loggedWorktreeListFailures,
        `${repo.id}:${repo.path}`,
        `[worktrees] failed to list worktrees for repo "${repo.displayName}" (${repo.id}) at ${repo.path}`,
        err
      )
      // Why: see worktrees:listAll catch — seeding an empty-success result would poison the auth cache and block linked worktrees.
      return []
    }
  })

  ipcMain.handle(
    'worktrees:listDetected',
    async (
      event,
      args: DetectedWorktreeRequestArgs
    ): Promise<DetectedWorktreeListResult | HostQualifiedDetectedWorktreeResult> => {
      if ('executionHostId' in args) {
        const parsedHost = parseExecutionHostId(args.executionHostId)
        const directSshRequest = parsedHost?.kind === 'ssh'
        const controller = directSshRequest
          ? detectedWorktreeCancellations.begin(event, args.providerRequestId)
          : null
        const directArgs = args as DirectSshDetectedWorktreeRequest
        const removeAuthorityAbort =
          controller &&
          parsedHost?.kind === 'ssh' &&
          hasValidDirectSshAuthority(directArgs) &&
          directArgs.expectedAuthority.targetId === parsedHost.targetId
            ? registerSshProviderRequestAbort(directArgs.expectedAuthority, controller)
            : undefined
        let timedOut = false
        let removeAbortListener: (() => void) | undefined
        const abortedResult = controller
          ? new Promise<HostQualifiedDetectedWorktreeResult>((resolve) => {
              const onAbort = (): void => {
                resolve({
                  providerRequestId: args.providerRequestId,
                  executionHostId: args.executionHostId,
                  status: timedOut ? 'timed-out' : 'canceled'
                })
              }
              controller.signal.addEventListener('abort', onAbort, { once: true })
              removeAbortListener = () => controller.signal.removeEventListener('abort', onAbort)
            })
          : undefined
        const timeout = controller
          ? setTimeout(() => {
              timedOut = true
              controller.abort()
            }, DETECTED_WORKTREE_PROVIDER_TIMEOUT_MS)
          : undefined
        try {
          const providerResult = listHostQualifiedDetectedWorktrees(
            store,
            args,
            controller
              ? {
                  signal: controller.signal,
                  status: () => (timedOut ? 'timed-out' : 'canceled')
                }
              : undefined
          )
          return abortedResult
            ? await Promise.race([providerResult, abortedResult])
            : await providerResult
        } finally {
          if (timeout) {
            clearTimeout(timeout)
          }
          removeAbortListener?.()
          removeAuthorityAbort?.()
          detectedWorktreeCancellations.finish(event, args.providerRequestId, controller)
        }
      }
      const repo = findExactRepoOwner(store, args.repoId)
      if (!repo) {
        return {
          repoId: args.repoId,
          authoritative: false,
          source: 'metadata-fallback',
          worktrees: []
        }
      }
      const provider = repo.connectionId ? getSshGitProvider(repo.connectionId) : undefined
      const authority = repo.connectionId
        ? { ...getSshProviderAuthority(repo.connectionId) }
        : undefined
      const result = await listDetectedWorktreesForCapturedRepo(
        store,
        repo,
        () =>
          isCapturedRepoCurrent(store, repo) &&
          (!repo.connectionId ||
            (getSshGitProvider(repo.connectionId) === provider &&
              authority !== undefined &&
              isCurrentSshProviderAuthority(authority))),
        provider
      )
      return result && !('providerAbortStatus' in result)
        ? result
        : {
            repoId: repo.id,
            authoritative: false,
            source: 'metadata-fallback',
            worktrees: []
          }
    }
  )
  ipcMain.handle(
    'worktrees:cancelListDetected',
    (event, args: { providerRequestId: ProviderRequestId }): void => {
      detectedWorktreeCancellations.cancel(event, args.providerRequestId)
    }
  )

}
