import type { BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Store } from '../persistence'
import type { Repo } from '../../shared/types'
import { isFolderRepo } from '../../shared/repo-kind'
import { DEFAULT_REPO_BADGE_COLOR } from '../../shared/constants'
import { isRuntimePathAbsolute, normalizeRuntimePathForComparison, relativePathInsideRoot } from '../../shared/cross-platform-path'
import { deriveCloneRepoNameFromUrl } from '../git/repo-clone-path'
import { isGitRepo } from '../git/repo'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { getActiveMultiplexer } from './ssh'
import { detectRepoIconAndUpstream } from '../repo-icon-autodetect'
import { joinRemotePath } from '../ssh/ssh-remote-platform'
import { getGitCloneFailureMessage } from '../../shared/git-clone-failure-message'
import { activeRemoteClone, remoteCloneInFlightByPath, resolveRemoteHomePath, setActiveRemoteClone } from './repo-ipc-clone'
import type { ActiveRemoteCloneMetadata } from './repo-ipc-clone'

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

export async function addRemoteRepoFromPath(
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

export async function cloneRemoteRepo(
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
  setActiveRemoteClone(metadata)
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
      setActiveRemoteClone(null)
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
