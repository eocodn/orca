import type { BrowserWindow } from 'electron'
import type { ChildProcess } from 'node:child_process'
import { z } from 'zod'
import {
  isRuntimePathAbsolute,
  normalizeRuntimePathForComparison,
  relativePathInsideRoot
} from '../../shared/cross-platform-path'
import { normalizeExecutionHostId } from '../../shared/execution-host'
import type { NestedRepoScanResult, Repo } from '../../shared/types'
import type { ClaimedCloneTarget } from '../git/repo-clone-path'
import type { Store } from '../persistence'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { joinRemotePath } from '../ssh/ssh-remote-platform'

import { getActiveMultiplexer } from './ssh'

// Why: `method` is the IPC entry point the user took, not what they added (never path/URL/name); repos:create → 'folder_picker'.
// Why: `isGitRepo` is a non-identifying git-vs-folder signal from the caller's detection; pass undefined when unknown, never default false.
// Why: it replaced onboarding_completed.is_git_repo, which lost meaning once repo selection left onboarding (1.4.46).
import { addRemoteRepoFromPath } from './repo-ipc-add'
export { addRemoteRepoFromPath, cloneRemoteRepo, getRemoteRepoFolderName } from './repo-ipc-add'

export async function createRemoteRepo(
  store: Store,
  args: {
    connectionId: string
    parentPath: string
    name: string
    kind: 'git' | 'folder'
  }
): Promise<{ repo: Repo } | { error: string }> {
  const name = args.name?.trim() ?? ''
  const parentPath = await resolveRemoteHomePath(args.connectionId, args.parentPath?.trim() ?? '')
  const repoKind: 'git' | 'folder' = args.kind === 'folder' ? 'folder' : 'git'
  if (!name) {
    return { error: 'Name cannot be empty' }
  }
  if (/[\\/]/.test(name) || name === '.' || name === '..') {
    return { error: 'Name cannot contain slashes or be "." / ".."' }
  }
  if (!parentPath) {
    return { error: 'Parent directory is required' }
  }
  const gitProvider = getSshGitProvider(args.connectionId)
  const fsProvider = getSshFilesystemProvider(args.connectionId)
  if (!gitProvider || !fsProvider) {
    return { error: `SSH connection "${args.connectionId}" not found or not connected` }
  }
  const host = gitProvider.getHostPlatform?.()
  if (!host) {
    return { error: 'SSH host platform is unavailable. Reconnect the SSH target before creating.' }
  }
  if (!isRuntimePathAbsolute(parentPath, host.pathFlavor)) {
    return { error: 'Parent directory must be an absolute path on the SSH host' }
  }

  const targetPath = joinRemotePath(host, parentPath, name)
  if (relativePathInsideRoot(parentPath, targetPath) === null) {
    return { error: 'Project path must be inside the parent directory' }
  }
  const targetPathKey = normalizeRuntimePathForComparison(targetPath)
  const existing = store.getRepos().find((repo) => {
    return (
      repo.connectionId === args.connectionId &&
      normalizeRuntimePathForComparison(repo.path) === targetPathKey
    )
  })
  if (existing) {
    return { repo: existing }
  }

  let createdDir = false
  let targetExists = false
  try {
    await fsProvider.stat(targetPath)
    targetExists = true
  } catch {
    targetExists = false
  }

  if (targetExists) {
    try {
      const entries = await fsProvider.readDir(targetPath)
      if (entries.length > 0) {
        return { error: `"${name}" already exists at this location and is not empty.` }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { error: `Failed to read directory: ${message}` }
    }
  } else {
    try {
      await fsProvider.createDirNoClobber(targetPath)
      createdDir = true
    } catch (err) {
      const raceWinner = store.getRepos().find((repo) => {
        return (
          repo.connectionId === args.connectionId &&
          normalizeRuntimePathForComparison(repo.path) === targetPathKey
        )
      })
      if (raceWinner) {
        return { repo: raceWinner }
      }
      const message = err instanceof Error ? err.message : String(err)
      return { error: `Failed to create directory: ${message}` }
    }
  }

  if (repoKind === 'git') {
    let step: 'init' | 'commit' = 'init'
    try {
      await gitProvider.exec(['init'], targetPath)
      step = 'commit'
      await gitProvider.exec(['commit', '--allow-empty', '-m', 'Initial commit'], targetPath)
    } catch (err) {
      if (createdDir) {
        await fsProvider.deletePath(targetPath, true).catch(() => undefined)
      } else if (step === 'commit') {
        await fsProvider
          .deletePath(joinRemotePath(host, targetPath, '.git'), true)
          .catch(() => undefined)
      }
      const message = err instanceof Error ? err.message : String(err)
      if (step === 'commit' && /Please tell me who you are|user\.name|user\.email/i.test(message)) {
        return {
          error:
            'Git author identity is not configured on the SSH host. Run `git config --global user.name "Your Name"` and `git config --global user.email "you@example.com"` on that host, then try again.'
        }
      }
      const stepLabel =
        step === 'init' ? 'Failed to initialize git repository' : 'Failed to create initial commit'
      return { error: `${stepLabel}: ${message}` }
    }
  }

  const raceWinner = store.getRepos().find((repo) => {
    return (
      repo.connectionId === args.connectionId &&
      normalizeRuntimePathForComparison(repo.path) === targetPathKey
    )
  })
  if (raceWinner) {
    return { repo: raceWinner }
  }

  const result = await addRemoteRepoFromPath(store, {
    connectionId: args.connectionId,
    remotePath: targetPath,
    kind: repoKind,
    displayName: name
  })
  if ('error' in result) {
    return result
  }
  return { repo: result.repo }
}

export async function resolveRemoteHomePath(connectionId: string, path: string): Promise<string> {
  if (path !== '~' && path !== '~/' && !path.startsWith('~/')) {
    return path
  }
  const mux = getActiveMultiplexer(connectionId)
  if (!mux) {
    return path
  }
  try {
    const result = (await mux.request('session.resolveHome', { path })) as { resolvedPath: string }
    return result.resolvedPath
  } catch {
    // Why: older relays may not support this; return the original path so callers surface their own validation error.
    return path
  }
}

export type ActiveCloneMetadata = {
  path: string
  pathKey: string
  claimedTarget: ClaimedCloneTarget
  process: ChildProcess
  abortRequested: boolean
  generation: number
  pendingAbortCleanup: Promise<void> | null
  resolvePendingAbortCleanup: (() => void) | null
}

export type ActiveRemoteCloneMetadata = {
  connectionId: string
  clonePath: string
  controller: AbortController
}

// Why: module-scoped so the abort handle survives macOS window re-creation, when registerRepoHandlers re-runs.
export let activeClone: ActiveCloneMetadata | null = null
export let activeRemoteClone: ActiveRemoteCloneMetadata | null = null

export function setActiveRemoteClone(metadata: ActiveRemoteCloneMetadata | null): void {
  activeRemoteClone = metadata
}
export let nextCloneGeneration = 1
export const latestCloneGenerationByPath = new Map<string, number>()
export const pendingAbortCleanupByPath = new Map<string, Promise<void>>()
export const cloneInFlightByPath = new Map<string, Promise<void>>()
export const remoteCloneInFlightByPath = new Set<string>()
export const activeNestedRepoScans = new Map<string, AbortController>()
export type CompletedNestedRepoScan = {
  scan: NestedRepoScanResult
  parentPath: string
  connectionId: string | null
}
export const completedNestedRepoScans = new Map<string, CompletedNestedRepoScan>()
export const MAX_COMPLETED_NESTED_SCAN_RESULTS = 50
export const GIT_AVAILABILITY_TIMEOUT_MS = 1500

export function emitCloneProgressFromText(mainWindow: BrowserWindow, text: string): void {
  for (const line of text.split(/[\r\n]+/)) {
    const match = line.match(/^([\w\s]+):\s+(\d+)%/)
    if (match && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('repos:clone-progress', {
        phase: match[1].trim(),
        percent: Number.parseInt(match[2], 10)
      })
    }
  }
}

export const ProjectGroupCreateArgs = z.object({
  name: z.string().min(1),
  parentPath: z.string().nullable().optional(),
  connectionId: z.string().nullable().optional(),
  parentGroupId: z.string().nullable().optional(),
  createdFrom: z.enum(['manual', 'folder-scan', 'migration']).optional()
})

export const ProjectGroupUpdateArgs = z.object({
  groupId: z.string().min(1),
  updates: z.object({
    name: z.string().optional(),
    isCollapsed: z.boolean().optional(),
    tabOrder: z.number().finite().optional(),
    color: z.string().nullable().optional()
  })
})

export const ProjectGroupSelectorArgs = z.object({
  groupId: z.string().min(1)
})

export const ProjectGroupMoveProjectArgs = z.object({
  projectId: z.string().min(1),
  groupId: z.string().nullable(),
  order: z.number().finite().optional()
})

export const ProjectHostSetupExistingFolderIpcArgs = z.object({
  projectId: z.string().min(1),
  projectProviderIdentity: z
    .object({
      provider: z.literal('github'),
      owner: z.string().min(1),
      repo: z.string().min(1),
      host: z.string().min(1).optional()
    })
    .optional(),
  hostId: z.string().min(1),
  path: z.string().min(1),
  kind: z.enum(['git', 'folder']).optional(),
  displayName: z.string().min(1).optional(),
  setupMethod: z.enum(['imported-existing-folder', 'cloned']).optional()
})

export const LocalWindowsRuntimePreferenceIpcArgs = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('inherit-global') }),
  z.object({ kind: z.literal('windows-host') }),
  z.object({ kind: z.literal('wsl'), distro: z.string().min(1) })
])

export const ProjectUpdateIpcArgs = z.object({
  projectId: z.string().min(1),
  updates: z.object({
    localWindowsRuntimePreference: LocalWindowsRuntimePreferenceIpcArgs.optional()
  })
})

export const ProjectHostSetupCreateIpcArgs = z.object({
  projectId: z.string().min(1),
  hostId: z
    .string()
    .min(1)
    .transform((value, ctx) => {
      const hostId = normalizeExecutionHostId(value)
      if (!hostId) {
        ctx.addIssue({ code: 'custom', message: 'Invalid host ID' })
        return z.NEVER
      }
      return hostId
    }),
  setupId: z.string().min(1).optional(),
  path: z.string().optional(),
  kind: z.enum(['git', 'folder']).optional(),
  displayName: z.string().min(1).optional(),
  worktreeBasePath: z.string().optional(),
  gitUsername: z.string().optional(),
  setupState: z.enum(['ready', 'not-set-up', 'setting-up', 'error', 'unsupported']).optional(),
  setupMethod: z.enum(['imported-existing-folder', 'cloned', 'provisioned']).optional()
})
