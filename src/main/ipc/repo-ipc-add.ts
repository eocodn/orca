import type { BrowserWindow, IpcMainInvokeEvent } from 'electron'
import { dialog, ipcMain } from 'electron'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { z } from 'zod'
import type { Store } from '../persistence'
import type {
  BaseRefSearchResult,
  Project,
  Repo,
  ProjectGroup,
  FolderWorkspace,
  ProjectGroupImportResult,
  ProjectUpdateArgs,
  ProjectHostSetupCreateArgs,
  ProjectHostSetupCreateResult,
  ProjectHostSetupDeleteArgs,
  ProjectHostSetupDeleteResult,
  ProjectHostSetupExistingFolderArgs,
  ProjectHostSetupResult,
  ProjectHostSetupUpdateArgs,
  ProjectHostSetupUpdateResult,
  NestedRepoScanResult,
  BaseRefDefaultResult,
  SparsePreset
} from '../../shared/types'
import type { FolderWorkspacePathStatusRequest } from '../../shared/folder-workspace-path-status'
import { isFolderRepo } from '../../shared/repo-kind'
import { DEFAULT_REPO_BADGE_COLOR } from '../../shared/constants'
import { normalizeRepoBadgeColor } from '../../shared/repo-badge-color'
import { sanitizeRepoIcon } from '../../shared/repo-icon'
import { normalizeRepoSourceControlAiOverrides } from '../../shared/source-control-ai'
import {
  isRuntimePathAbsolute,
  normalizeRuntimePathForComparison,
  relativePathInsideRoot
} from '../../shared/cross-platform-path'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { TaskSourceContextSchema } from '../../shared/task-source-context-schema'
import { WorkspaceLinkedItemSchema } from '../../shared/workspace-linked-item-schema'
import { isWorkspaceLinkedItemSourceContextMatch } from '../../shared/workspace-linked-item-source-context'
import { invalidateAuthorizedRootsCache } from './filesystem-auth'
import type { ChildProcess } from 'node:child_process'
import { access, mkdir, readdir, rm } from 'node:fs/promises'
import { gitExecFileAsync, gitSpawn, nonInteractiveGitEnv } from '../git/runner'
import { isAbsolute, join, posix } from 'node:path'
import {
  cleanupClaimedCloneTarget,
  claimCloneTarget,
  deriveCloneRepoNameFromUrl,
  deriveValidatedClonePath,
  getClonePathComparisonKey
} from '../git/repo-clone-path'
import type { ClaimedCloneTarget } from '../git/repo-clone-path'
import { scanNestedRepos } from '../project-groups/nested-repo-discovery'
import {
  createNestedProjectGroupResolver,
  resolveNestedRepoSelection
} from '../project-groups/nested-repo-import'
import { createNestedRepoImportTargetResolver } from '../project-groups/nested-repo-import-target'
import {
  isGitRepo,
  getGitRepoRoot,
  getLinkedWorktreeMainRepoRoot,
  getRepoName,
  getBaseRefDefault,
  getRemoteCount,
  normalizeRefSearchQuery,
  parseAndFilterSearchRefDetails,
  parseRemoteCount,
  resolveDefaultBaseRefViaExec,
  buildSearchBaseRefsArgv,
  isForEachRefExcludeUnsupportedError,
  mergeBaseRefSearchResultGroups,
  searchBaseRefDetails
} from '../git/repo'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { getSshGitCapabilityCache } from '../git/git-capability-state'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { getSshGitUsername, resolveLocalGitUsername } from '../git/git-username'
import { enrichRepoGitUsernames } from '../repo-git-username-enrichment'
import { getActiveMultiplexer } from './ssh'
import { normalizeSparseDirectories } from './sparse-checkout-directories'
import { track } from '../telemetry/client'
import { scheduleCurrentWorktreeBaseDirectoryWatcherSync } from './worktree-base-directory-watcher'
import { getCohortAtEmit } from '../telemetry/cohort-classifier'
import type { RepoMethod } from '../../shared/telemetry-events'
import type {
  HostRepoCatalogSnapshot,
  ListReposForExecutionHostArgs
} from '../../shared/host-repo-catalog-contract'
import { detectRepoIconAndUpstream } from '../repo-icon-autodetect'
import { enrichMissingRepoGitRemoteIdentities } from '../repo-git-remote-identity-enrichment'
import {
  getProjectHostSetupForRepo,
  getProjectIdForProviderIdentity
} from '../../shared/project-host-setup-projection'
import {
  getRepoExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import { joinRemotePath } from '../ssh/ssh-remote-platform'
import {
  assertFolderWorkspacePathUsable,
  getFolderWorkspacePathStatus,
  getFolderWorkspacePathStatusForPath
} from '../project-groups/folder-workspace-path-status'
import { getGitCloneFailureMessage } from '../../shared/git-clone-failure-message'
import { prepareLocalWorktreeRootForRepo } from '../worktree-root-preparation'
import { runWithGitReadCacheInvalidation } from '../git/status'
import { isAdmissibleDirectSshAuthority } from '../../shared/ssh-retained-payload-admission'
import { isCurrentSshProviderAuthority } from '../ssh/ssh-provider-authority'

// Why: `method` is the IPC entry point the user took, not what they added (never path/URL/name); repos:create → 'folder_picker'.
// Why: `isGitRepo` is a non-identifying git-vs-folder signal from the caller's detection; pass undefined when unknown, never default false.
// Why: it replaced onboarding_completed.is_git_repo, which lost meaning once repo selection left onboarding (1.4.46).
import { emitRepoAdded,
  hasValidCatalogSshAuthority,
  repoHostContradictsConnection,
  getConsistentRepoCatalogForHost,
  listReposForExecutionHost,
  buildProjectHostSetupResult,
  alignRepoWithRequestedProject,
  addLocalRepoFromPath } from './repo-ipc-foundation'
export { emitRepoAdded,
  hasValidCatalogSshAuthority,
  repoHostContradictsConnection,
  getConsistentRepoCatalogForHost,
  listReposForExecutionHost,
  buildProjectHostSetupResult,
  alignRepoWithRequestedProject,
  addLocalRepoFromPath } from './repo-ipc-foundation'

asyncexport function addRemoteRepoFromPath(
  store: Store,
  args: {
    connectionId: string
    remotePath: string
    displayName?: string
    kind?: 'git' | 'folder'
    setupMethod?: Repo['projectHostSetupMethod']
  }
): Promise<{ repo: Repo; alreadyExisted: boolean } | { error: string }> {
  const gitProvider = getSshGitProvider(args.connectionId)
  if (!gitProvider) {
    return { error: `SSH connection "${args.connectionId}" not found or not connected` }
  }

  let repoKind: 'git' | 'folder' = args.kind ?? 'git'
  let resolvedPath = await resolveRemoteHomePath(args.connectionId, args.remotePath)

  const existing = store
    .getRepos()
    .find(
      (repo) =>
        repo.connectionId === args.connectionId &&
        normalizeRuntimePathForComparison(repo.path) ===
          normalizeRuntimePathForComparison(resolvedPath)
    )
  if (existing) {
    return { repo: existing, alreadyExisted: true }
  }

  if (args.kind !== 'folder') {
    try {
      const check = await gitProvider.isGitRepoAsync(resolvedPath)
      if (check.isRepo) {
        repoKind = 'git'
        if (check.rootPath) {
          resolvedPath = check.rootPath
        }
      } else {
        return { error: `Not a valid git repository: ${args.remotePath}` }
      }
    } catch (err) {
      if (err instanceof Error && err.message.includes('Not a valid git repository')) {
        return { error: err.message }
      }
      return { error: `Not a valid git repository: ${args.remotePath}` }
    }
  }

  const existingAfterRootResolve = store
    .getRepos()
    .find(
      (repo) =>
        repo.connectionId === args.connectionId &&
        normalizeRuntimePathForComparison(repo.path) ===
          normalizeRuntimePathForComparison(resolvedPath)
    )
  if (existingAfterRootResolve) {
    return { repo: existingAfterRootResolve, alreadyExisted: true }
  }

  const folderName = getRemoteRepoFolderName(resolvedPath)
  let displayName = args.displayName || folderName
  if (!args.displayName && (args.remotePath === '~' || args.remotePath === '~/')) {
    const sshTarget = store.getSshTarget(args.connectionId)
    if (sshTarget) {
      displayName = sshTarget.label
    }
  }

  const detected = await detectRepoIconAndUpstream({
    repoPath: resolvedPath,
    kind: repoKind,
    connectionId: args.connectionId
  })
  const repo: Repo = {
    id: randomUUID(),
    path: resolvedPath,
    displayName,
    badgeColor: DEFAULT_REPO_BADGE_COLOR,
    ...detected,
    addedAt: Date.now(),
    kind: repoKind,
    connectionId: args.connectionId,
    ...(repoKind === 'git'
      ? {
          externalWorktreeVisibility: 'hide' as const,
          externalWorktreeVisibilityLegacy: false,
          projectHostSetupMethod: args.setupMethod ?? ('imported-existing-folder' as const)
        }
      : {})
  }

  store.addRepo(repo)
  const mux = getActiveMultiplexer(args.connectionId)
  if (mux) {
    mux.notify('session.registerRoot', { rootPath: resolvedPath })
  }

  return { repo, alreadyExisted: false }
}

export function getRemoteRepoFolderName(remotePath: string): string {
  const trimmed = remotePath.replace(/[\\/]+$/, '')
  if (!trimmed) {
    return remotePath
  }
  return trimmed.split(/[\\/]/).at(-1) || remotePath
}

asyncexport function cloneRemoteRepo(
  store: Store,
  mainWindow: BrowserWindow,
  args: {
    connectionId: string
    url: string
    destination: string
  }
): Promise<Repo> {
  const gitProvider = getSshGitProvider(args.connectionId)
  if (!gitProvider) {
    throw new Error(`SSH connection "${args.connectionId}" not found or not connected`)
  }
  const fsProvider = getSshFilesystemProvider(args.connectionId)
  if (!fsProvider) {
    throw new Error(`SSH connection "${args.connectionId}" not found or not connected`)
  }
  const host = gitProvider.getHostPlatform?.()
  if (!host) {
    throw new Error('SSH host platform is unavailable. Reconnect the SSH target before cloning.')
  }
  const trimmedDestination = await resolveRemoteHomePath(args.connectionId, args.destination.trim())
  if (!isRuntimePathAbsolute(trimmedDestination, host.pathFlavor)) {
    throw new Error('Clone destination must be an absolute path on the SSH host')
  }
  const repoName = deriveCloneRepoNameFromUrl(args.url.trim())
  const clonePath = joinRemotePath(host, trimmedDestination, repoName)
  if (relativePathInsideRoot(trimmedDestination, clonePath) === null) {
    throw new Error('Clone path must be inside the destination directory')
  }
  const clonePathKey = normalizeRuntimePathForComparison(clonePath)
  const existing = store.getRepos().find((repo) => {
    return (
      repo.connectionId === args.connectionId &&
      normalizeRuntimePathForComparison(repo.path) === clonePathKey
    )
  })
  if (existing && !isFolderRepo(existing)) {
    emitRepoAdded('clone_url', true)
    return existing
  }

  const remoteCloneKey = `${args.connectionId}:${clonePathKey}`
  if (remoteCloneInFlightByPath.has(remoteCloneKey)) {
    throw new Error('A clone is already in progress for this SSH destination')
  }
  const controller = new AbortController()
  const metadata: ActiveRemoteCloneMetadata = {
    connectionId: args.connectionId,
    clonePath,
    controller
  }
  activeRemoteClone = metadata
  remoteCloneInFlightByPath.add(remoteCloneKey)
  try {
    // Why: match local clone by creating the parent first, or a fresh remote parent surfaces as spawn ENOENT.
    await fsProvider.createDir(trimmedDestination)
    // Why: the SSH relay runs git argv, not a shell; use the repo folder name so git creates it under the chosen parent.
    await gitProvider.clone(
      ['clone', '--progress', '--', args.url.trim(), repoName],
      trimmedDestination,
      {
        signal: controller.signal,
        timeoutMs: 10 * 60_000,
        onProgress: (progress) => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('repos:clone-progress', progress)
          }
        }
      }
    )
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error('Clone aborted')
    }
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith('Clone failed:')) {
      throw new Error(`Clone failed: ${getGitCloneFailureMessage(message, { clonePath })}`)
    }
    throw err
  } finally {
    if (activeRemoteClone === metadata) {
      activeRemoteClone = null
    }
    remoteCloneInFlightByPath.delete(remoteCloneKey)
  }
  if (existing && isFolderRepo(existing)) {
    const updated = store.updateRepo(existing.id, {
      kind: 'git',
      projectHostSetupMethod: 'cloned'
    })
    if (updated) {
      emitRepoAdded('clone_url', false)
      getActiveMultiplexer(args.connectionId)?.notify('session.registerRoot', {
        rootPath: clonePath
      })
      return updated
    }
  }
  const result = await addRemoteRepoFromPath(store, {
    connectionId: args.connectionId,
    remotePath: clonePath,
    kind: 'git',
    setupMethod: 'cloned'
  })
  if ('error' in result) {
    throw new Error(result.error)
  }
  emitRepoAdded('clone_url', result.alreadyExisted)
  return result.repo
}

