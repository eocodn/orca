// Repository IPC registration facade; concrete domains own their handler wiring.
import type { BrowserWindow } from 'electron'
import { dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { access, mkdir, readdir, rm } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Store } from '../persistence'
import type { ActiveCloneMetadata, ActiveRemoteCloneMetadata } from './repo-ipc-clone'
import {
  cloneInFlightByPath,
  latestCloneGenerationByPath,
  pendingAbortCleanupByPath
} from './repo-ipc-clone'
import type { BaseRefDefaultResult, Repo } from '../../shared/types'
import type { ExecutionHostId } from '../../shared/execution-host'
import { isFolderRepo } from '../../shared/repo-kind'
import { DEFAULT_REPO_BADGE_COLOR } from '../../shared/constants'
import {
  getBaseRefDefault,
  getRemoteCount,
  getRepoName,
  parseRemoteCount,
  resolveDefaultBaseRefViaExec
} from '../git/repo'
import { gitExecFileAsync, gitSpawn, nonInteractiveGitEnv } from '../git/runner'
import {
  cleanupClaimedCloneTarget,
  claimCloneTarget,
  deriveValidatedClonePath,
  getClonePathComparisonKey
} from '../git/repo-clone-path'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { getSshGitUsername, resolveLocalGitUsername } from '../git/git-username'
import { getGitCloneFailureMessage } from '../../shared/git-clone-failure-message'
import { invalidateAuthorizedRootsCache } from './filesystem-auth'
import { detectRepoIconAndUpstream } from '../repo-icon-autodetect'
import { prepareLocalWorktreeRootForRepo } from '../worktree-root-preparation'
import { runWithGitReadCacheInvalidation } from '../git/status'
import {
  cloneRemoteRepo,
  emitCloneProgressFromText,
  emitRepoAdded,
  getRepoForExecutionHost,
  searchBaseRefDetailsForRepo
} from './repo-ipc-handlers'
import { notifyReposChanged } from './repo-ipc-imports'
import { registerProjectGroupHandlers } from './repo-ipc-project-group-registration'
import { registerRepositoryCatalogHandlers } from './repo-ipc-repository-catalog-registration'
import { registerRepositoryMutationHandlers } from './repo-ipc-repository-mutation-registration'
import { registerSparsePresetHandlers } from './repo-ipc-sparse-preset-registration'
import { scanNestedReposForIpc, runNestedRepoScanForIpc } from './repo-ipc-folder-workspaces'

export { scanNestedReposForIpc, runNestedRepoScanForIpc } from './repo-ipc-folder-workspaces'

let activeClone: ActiveCloneMetadata | null = null
let activeRemoteClone: ActiveRemoteCloneMetadata | null = null
let nextCloneGeneration = 1

async function cleanupOwnedCloneTarget(metadata: ActiveCloneMetadata): Promise<void> {
  if (!metadata.claimedTarget.canCleanup || !metadata.claimedTarget.ownedDirectoryIdentity) {
    return
  }
  if (latestCloneGenerationByPath.get(metadata.pathKey) !== metadata.generation) {
    return
  }
  // A retry may attach a newer process before the aborted one closes.
  if (
    activeClone &&
    activeClone.process !== metadata.process &&
    activeClone.pathKey === metadata.pathKey
  ) {
    return
  }
  await cleanupClaimedCloneTarget(metadata.path, metadata.claimedTarget)
}

function markCloneAbortCleanupPending(metadata: ActiveCloneMetadata): void {
  if (metadata.resolvePendingAbortCleanup) {
    return
  }
  metadata.pendingAbortCleanup = new Promise<void>((resolve) => {
    metadata.resolvePendingAbortCleanup = resolve
  })
  pendingAbortCleanupByPath.set(metadata.pathKey, metadata.pendingAbortCleanup)
}

function settleCloneAbortCleanup(metadata: ActiveCloneMetadata): void {
  if (pendingAbortCleanupByPath.get(metadata.pathKey) === metadata.pendingAbortCleanup) {
    pendingAbortCleanupByPath.delete(metadata.pathKey)
  }
  metadata.resolvePendingAbortCleanup?.()
  metadata.pendingAbortCleanup = null
  metadata.resolvePendingAbortCleanup = null
}

async function runWithClonePathLock<T>(clonePathKey: string, task: () => Promise<T>): Promise<T> {
  const previous = cloneInFlightByPath.get(clonePathKey) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.then(
    () => current,
    () => current
  )
  cloneInFlightByPath.set(clonePathKey, tail)

  try {
    await previous
    return await runWithGitReadCacheInvalidation(task)
  } finally {
    release()
    if (cloneInFlightByPath.get(clonePathKey) === tail) {
      cloneInFlightByPath.delete(clonePathKey)
    }
  }
}

export function registerRepoHandlers(mainWindow: BrowserWindow, store: Store): void {
  // Remove previously registered handlers so macOS app re-activation can safely re-register them.
  ipcMain.removeHandler('repos:list')
  ipcMain.removeHandler('repos:listForExecutionHost')
  ipcMain.removeHandler('repos:add')
  ipcMain.removeHandler('repos:remove')
  ipcMain.removeHandler('repos:removeForHost')
  ipcMain.removeHandler('repos:reorder')
  ipcMain.removeHandler('repos:reorderForHost')
  ipcMain.removeHandler('repos:update')
  ipcMain.removeHandler('projects:list')
  ipcMain.removeHandler('projects:update')
  ipcMain.removeHandler('projectHostSetups:list')
  ipcMain.removeHandler('projectHostSetups:create')
  ipcMain.removeHandler('projectHostSetups:setupExistingFolder')
  ipcMain.removeHandler('projectHostSetups:update')
  ipcMain.removeHandler('projectHostSetups:delete')
  ipcMain.removeHandler('projectGroups:list')
  ipcMain.removeHandler('projectGroups:create')
  ipcMain.removeHandler('projectGroups:update')
  ipcMain.removeHandler('projectGroups:delete')
  ipcMain.removeHandler('projectGroups:moveProject')
  ipcMain.removeHandler('projectGroups:scanNested')
  ipcMain.removeHandler('projectGroups:cancelNestedScan')
  ipcMain.removeHandler('projectGroups:importNested')
  ipcMain.removeHandler('folderWorkspaces:list')
  ipcMain.removeHandler('folderWorkspaces:create')
  ipcMain.removeHandler('folderWorkspaces:update')
  ipcMain.removeHandler('folderWorkspaces:delete')
  ipcMain.removeHandler('folderWorkspaces:getPathStatus')
  ipcMain.removeHandler('repos:pickFolder')
  ipcMain.removeHandler('repos:pickFolders')
  ipcMain.removeHandler('repos:pickDirectory')
  ipcMain.removeHandler('repos:clone')
  ipcMain.removeHandler('repos:cloneAbort')
  ipcMain.removeHandler('repos:cloneRemote')
  ipcMain.removeHandler('repos:isGitAvailable')
  ipcMain.removeHandler('repos:getDefaultCreateProjectParent')
  ipcMain.removeHandler('repos:getGitUsername')
  ipcMain.removeHandler('repos:getBaseRefDefault')
  ipcMain.removeHandler('repos:searchBaseRefs')
  ipcMain.removeHandler('repos:searchBaseRefDetails')
  ipcMain.removeHandler('repos:addRemote')
  ipcMain.removeHandler('repos:create')
  ipcMain.removeHandler('repos:createRemote')
  ipcMain.removeHandler('sparsePresets:list')
  ipcMain.removeHandler('sparsePresets:save')
  ipcMain.removeHandler('sparsePresets:remove')

  registerRepositoryCatalogHandlers(mainWindow, store)
  registerProjectGroupHandlers(mainWindow, store)
  registerRepositoryMutationHandlers(mainWindow, store)
  registerSparsePresetHandlers(mainWindow, store)

  ipcMain.handle('repos:pickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('repos:pickFolders', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return []
    }
    return result.filePaths
  })

  // Why: generic folder picker, separate from pickFolder's add-project flow; a clone destination may not be a git repo yet.
  ipcMain.handle('repos:pickDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      // Why: macOS materializes typed partial paths with directory creation on; clone/create make the final path on submit.
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return null
    }
    return result.filePaths[0]
  })

  ipcMain.handle('repos:cloneAbort', async () => {
    if (activeClone) {
      const clone = activeClone
      clone.abortRequested = true
      markCloneAbortCleanupPending(clone)
      clone.process.kill()
      activeClone = null
    }
    if (activeRemoteClone) {
      activeRemoteClone.controller.abort()
      activeRemoteClone = null
    }
  })

  ipcMain.handle(
    'repos:clone',
    async (_event, args: { url: string; destination: string }): Promise<Repo> => {
      // Why: derive the repo folder name from the URL's last segment, matching default git clone behavior.
      const clonePath = deriveValidatedClonePath(args)
      const clonePathKey = getClonePathComparisonKey(clonePath)
      return runWithClonePathLock(clonePathKey, async () => {
        await pendingAbortCleanupByPath.get(clonePathKey)
        const existingAfterPendingClone = store
          .getRepos()
          .find((r) => getClonePathComparisonKey(r.path) === clonePathKey)
        if (existingAfterPendingClone && !isFolderRepo(existingAfterPendingClone)) {
          // Why: clone_url always produces a git repo.
          emitRepoAdded('clone_url', true, true)
          return existingAfterPendingClone
        }
        // Why: gitSpawn cwd is args.destination, so it must exist before spawn (fresh installs may lack the defaulted parent).
        await mkdir(args.destination, { recursive: true })
        const claimedTarget = await claimCloneTarget(clonePath)

        // Why: spawn (not execFile) avoids the maxBuffer limit — clone progress on stderr can exceed Node's 1 MB default.
        // Why: --progress forces git to emit progress even when stderr isn't a TTY.
        const cloneMetadataRef: { current: ActiveCloneMetadata | null } = { current: null }
        await new Promise<void>((resolve, reject) => {
          // Why: use the parent destination as cwd so the runner detects a WSL path and routes through wsl.exe.
          // Why: '--' isolates the URL so a malicious URL can't be read as git flags (command injection).
          let proc: ReturnType<typeof gitSpawn>
          try {
            proc = gitSpawn(['clone', '--progress', '--', args.url, clonePath], {
              cwd: args.destination,
              // Why: without this, an auth-needing clone pops Git Credential Manager's OAuth window on Windows, unclosable in a restricted env (issue #7652).
              env: nonInteractiveGitEnv(),
              stdio: ['ignore', 'ignore', 'pipe']
            })
          } catch (err) {
            void cleanupClaimedCloneTarget(clonePath, claimedTarget).finally(() => {
              const message = err instanceof Error ? err.message : String(err)
              reject(new Error(`Clone failed: ${message}`))
            })
            return
          }
          const generation = nextCloneGeneration++
          latestCloneGenerationByPath.set(clonePathKey, generation)
          const metadata: ActiveCloneMetadata = {
            path: clonePath,
            pathKey: clonePathKey,
            claimedTarget,
            process: proc,
            abortRequested: false,
            generation,
            pendingAbortCleanup: null,
            resolvePendingAbortCleanup: null
          }
          cloneMetadataRef.current = metadata
          activeClone = metadata

          let stderrTail = ''
          let settled = false
          proc.stderr!.on('data', (chunk: Buffer) => {
            const text = chunk.toString()
            stderrTail = (stderrTail + text).slice(-4096)

            // Why: git progress lines use \r to overwrite in-place; parse fragments the same as SSH clone.
            emitCloneProgressFromText(mainWindow, text)
          })

          const finishClone = async (
            code: number | null,
            signal: NodeJS.Signals | null,
            err?: Error
          ) => {
            if (settled) {
              return
            }
            settled = true
            // Why: only null activeClone if it still points to this proc; abort-and-retry may have reassigned it, stranding the new clone.
            if (activeClone?.process === proc) {
              activeClone = null
            }

            const cloneSucceeded = !err && code === 0 && !signal
            if (!cloneSucceeded) {
              // Why: only the process that created this target may remove it, and only after git reports failure.
              await cleanupOwnedCloneTarget(metadata)
            }
            if (metadata.abortRequested && !cloneSucceeded) {
              settleCloneAbortCleanup(metadata)
            }
            if (latestCloneGenerationByPath.get(metadata.pathKey) === metadata.generation) {
              latestCloneGenerationByPath.delete(metadata.pathKey)
            }

            if (err) {
              reject(new Error(`Clone failed: ${err.message}`))
            } else if (signal === 'SIGTERM') {
              reject(new Error('Clone aborted'))
            } else if (code === 0) {
              resolve()
            } else {
              reject(
                new Error(`Clone failed: ${getGitCloneFailureMessage(stderrTail, { clonePath })}`)
              )
            }
          }

          proc.on('error', (err) => {
            void finishClone(null, null, err)
          })

          proc.on('close', (code, signal) => {
            void finishClone(code, signal)
          })
        })

        try {
          // Why: check after clone (path didn't exist before); reuse+upgrade a folder repo clone landed into instead of duplicating.
          const existing = store
            .getRepos()
            .find((r) => getClonePathComparisonKey(r.path) === clonePathKey)
          if (existing) {
            if (isFolderRepo(existing)) {
              const updated = store.updateRepo(existing.id, {
                kind: 'git',
                projectHostSetupMethod: 'cloned'
              })
              if (updated) {
                await prepareLocalWorktreeRootForRepo(store, updated)
                invalidateAuthorizedRootsCache()
                notifyReposChanged(mainWindow)
                // Why: folder→git upgrade is a real new git repo provisioning event.
                emitRepoAdded('clone_url', false, true)
                return updated
              }
            }
            emitRepoAdded('clone_url', true, true)
            return existing
          }

          const detected = await detectRepoIconAndUpstream({ repoPath: clonePath, kind: 'git' })
          const repo: Repo = {
            id: randomUUID(),
            path: clonePath,
            displayName: getRepoName(clonePath),
            badgeColor: DEFAULT_REPO_BADGE_COLOR,
            ...detected,
            addedAt: Date.now(),
            kind: 'git',
            externalWorktreeVisibility: 'hide',
            externalWorktreeVisibilityLegacy: false,
            projectHostSetupMethod: 'cloned'
          }

          store.addRepo(repo)
          await prepareLocalWorktreeRootForRepo(store, repo)
          invalidateAuthorizedRootsCache()
          notifyReposChanged(mainWindow)
          emitRepoAdded('clone_url', false, true)
          return repo
        } finally {
          const metadata = cloneMetadataRef.current
          if (metadata?.abortRequested) {
            settleCloneAbortCleanup(metadata)
          }
        }
      })
    }
  )

  ipcMain.handle(
    'repos:cloneRemote',
    async (
      _event,
      args: { connectionId: string; url: string; destination: string }
    ): Promise<Repo> => {
      const repo = await cloneRemoteRepo(store, mainWindow, args)
      notifyReposChanged(mainWindow)
      return repo
    }
  )

  ipcMain.handle('repos:getGitUsername', async (_event, args: { repoId: string }) => {
    const repo = store.getRepo(args.repoId)
    if (!repo || isFolderRepo(repo)) {
      return ''
    }
    // Why: remote repos keep their git config on the remote host, so resolve the username there.
    if (repo.connectionId) {
      const provider = getSshGitProvider(repo.connectionId)
      if (!provider) {
        return ''
      }
      return getSshGitUsername(provider, repo.path)
    }
    return resolveLocalGitUsername(repo.path)
  })

  ipcMain.handle(
    'repos:getBaseRefDefault',
    async (
      _event,
      args: { repoId: string; hostId?: ExecutionHostId }
    ): Promise<BaseRefDefaultResult> => {
      const repo = getRepoForExecutionHost(store, args.repoId, args.hostId)
      if (!repo || isFolderRepo(repo)) {
        // Why: folder repos have no git state for a base ref; return null + 0 so the renderer skips a fabricated default.
        return { defaultBaseRef: null, remoteCount: 0 }
      }
      // Why: remote repos need the relay to resolve symbolic-ref where the git data lives.
      if (repo.connectionId) {
        const provider = getSshGitProvider(repo.connectionId)
        if (!provider) {
          return { defaultBaseRef: null, remoteCount: 0 }
        }
        // Why: delegate to shared resolveDefaultBaseRefViaExec; log symbolic-ref failures here to keep the SSH transport diagnostic it otherwise swallows.
        const resolveDefault = async (): Promise<string | null> => {
          return resolveDefaultBaseRefViaExec(async (argv) => {
            try {
              return await provider.exec(argv, repo.path)
            } catch (err) {
              if (argv[0] === 'symbolic-ref') {
                console.warn('[repos:getBaseRefDefault] SSH symbolic-ref failed', {
                  path: repo.path,
                  err
                })
              }
              throw err
            }
          })
        }

        const resolveRemoteCount = async (): Promise<number> => {
          try {
            const remotesResult = await provider.exec(['remote'], repo.path)
            return parseRemoteCount(remotesResult.stdout)
          } catch (err) {
            // Why: 0 = unknown sentinel that suppresses the multi-remote hint.
            console.warn('[repos:getBaseRefDefault] SSH git remote count failed', {
              path: repo.path,
              err
            })
            return 0
          }
        }

        const [defaultBaseRef, remoteCount] = await Promise.all([
          resolveDefault(),
          resolveRemoteCount()
        ])
        return { defaultBaseRef, remoteCount }
      }
      // Why: run in parallel; a remote-count failure must not break default detection.
      const [defaultBaseRef, remoteCount] = await Promise.all([
        getBaseRefDefault(repo.path),
        getRemoteCount(repo.path)
      ])
      return { defaultBaseRef, remoteCount }
    }
  )

  ipcMain.handle(
    'repos:searchBaseRefs',
    async (
      _event,
      args: { repoId: string; query: string; limit?: number; hostId?: ExecutionHostId }
    ) => {
      return (await searchBaseRefDetailsForRepo(store, args)).map((entry) => entry.refName)
    }
  )

  ipcMain.handle(
    'repos:searchBaseRefDetails',
    async (
      _event,
      args: { repoId: string; query: string; limit?: number; hostId?: ExecutionHostId }
    ) => {
      return searchBaseRefDetailsForRepo(store, args)
    }
  )
}
