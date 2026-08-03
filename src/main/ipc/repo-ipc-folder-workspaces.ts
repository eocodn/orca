import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { NestedRepoScanResult } from '../../shared/types'
import { join, posix } from 'node:path'
import { scanNestedRepos } from '../project-groups/nested-repo-discovery'
import { isGitRepo } from '../git/repo'
import { getSshGitProvider } from '../providers/ssh-git-dispatch'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'

// Why: `method` is the IPC entry point the user took, not what they added (never path/URL/name); repos:create → 'folder_picker'.
// Why: `isGitRepo` is a non-identifying git-vs-folder signal from the caller's detection; pass undefined when unknown, never default false.
// Why: it replaced onboarding_completed.is_git_repo, which lost meaning once repo selection left onboarding (1.4.46).
import { ProjectHostSetupUpdateIpcArgs,
  ProjectHostSetupDeleteIpcArgs,
  FolderWorkspaceLinkedTaskArgs,
  assertFolderWorkspaceLinkedSourceContextMatch,
  FolderWorkspaceCreateArgs,
  FolderWorkspaceUpdateArgs,
  FolderWorkspaceSelectorArgs,
  FolderWorkspacePathStatusArgs,
  ProjectGroupScanNestedArgs,
  ProjectGroupCancelNestedScanArgs,
  ProjectGroupImportNestedArgs,
  parseProjectGroupIpcArgs,
  validateNestedRepoScanRoot,
  rememberCompletedNestedRepoScan,
  getCompletedNestedRepoScan,
  cleanupOwnedCloneTarget,
  isGitAvailable,
  getDefaultCreateProjectParent,
  markCloneAbortCleanupPending,
  settleCloneAbortCleanup,
  runWithClonePathLock,
  sanitizeNestedRepoImportError,
  resolveSshProjectGroupPath } from './repo-ipc-projects'
import { activeNestedRepoScans } from './repo-ipc-clone'
export { ProjectHostSetupUpdateIpcArgs,
  ProjectHostSetupDeleteIpcArgs,
  FolderWorkspaceLinkedTaskArgs,
  assertFolderWorkspaceLinkedSourceContextMatch,
  FolderWorkspaceCreateArgs,
  FolderWorkspaceUpdateArgs,
  FolderWorkspaceSelectorArgs,
  FolderWorkspacePathStatusArgs,
  ProjectGroupScanNestedArgs,
  ProjectGroupCancelNestedScanArgs,
  ProjectGroupImportNestedArgs,
  parseProjectGroupIpcArgs,
  validateNestedRepoScanRoot,
  rememberCompletedNestedRepoScan,
  getCompletedNestedRepoScan,
  cleanupOwnedCloneTarget,
  isGitAvailable,
  getDefaultCreateProjectParent,
  markCloneAbortCleanupPending,
  settleCloneAbortCleanup,
  runWithClonePathLock,
  sanitizeNestedRepoImportError,
  resolveSshProjectGroupPath } from './repo-ipc-projects'

export async function scanNestedReposForIpc(args: {
  path: string
  connectionId?: string
  options?: unknown
  signal?: AbortSignal
  onProgress?: (scan: NestedRepoScanResult) => void
}): Promise<NestedRepoScanResult> {
  validateNestedRepoScanRoot(args.path, args.connectionId)
  if (!args.connectionId) {
    return scanNestedRepos({
      path: args.path,
      options: args.options,
      signal: args.signal,
      onProgress: args.onProgress
    })
  }
  const gitProvider = getSshGitProvider(args.connectionId)
  const fsProvider = getSshFilesystemProvider(args.connectionId)
  if (!gitProvider || !fsProvider) {
    throw new Error('ssh_connection_unavailable')
  }
  const resolvedPath = await resolveSshProjectGroupPath(args.connectionId, args.path)
  return scanNestedRepos({
    path: resolvedPath,
    options: args.options,
    signal: args.signal,
    onProgress: args.onProgress,
    filesystem: {
      readDirectory: async (dirPath) =>
        (await fsProvider.readDir(dirPath)).map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory,
          isSymlink: entry.isSymlink
        })),
      readTextFile: async (filePath) => (await fsProvider.readFile(filePath)).content,
      joinPath: (parentPath, childName) => posix.join(parentPath, childName),
      basename: (path) => posix.basename(path),
      hasGitMarker: async (path) => {
        try {
          const marker = await fsProvider.stat(posix.join(path, '.git'))
          if (marker.type === 'directory' || marker.type === 'file') {
            return true
          }
        } catch {
          // Continue to cheap bare-repository marker checks below.
        }
        const [head, objects, refs] = await Promise.all([
          fsProvider.stat(posix.join(path, 'HEAD')).catch(() => null),
          fsProvider.stat(posix.join(path, 'objects')).catch(() => null),
          fsProvider.stat(posix.join(path, 'refs')).catch(() => null)
        ])
        return head?.type === 'file' && objects?.type === 'directory' && refs?.type === 'directory'
      },
      isSelectedPathGitRepo: async (path) => {
        try {
          return (await gitProvider.isGitRepoAsync(path)).isRepo
        } catch {
          return false
        }
      }
    }
  })
}

export async function runNestedRepoScanForIpc(
  event: IpcMainInvokeEvent,
  args: z.infer<typeof ProjectGroupScanNestedArgs>
): Promise<NestedRepoScanResult> {
  const controller = args.scanId ? new AbortController() : undefined
  if (args.scanId && controller) {
    activeNestedRepoScans.get(args.scanId)?.abort()
    activeNestedRepoScans.set(args.scanId, controller)
  }

  try {
    const scan = await scanNestedReposForIpc({
      ...args,
      signal: controller?.signal,
      onProgress: args.scanId
        ? (scan) => {
            event.sender.send('projectGroups:scanNestedProgress', {
              scanId: args.scanId,
              scan
            })
          }
        : undefined
    })
    rememberCompletedNestedRepoScan(
      args.scanId,
      { parentPath: args.path, connectionId: args.connectionId },
      scan
    )
    return scan
  } finally {
    if (args.scanId && activeNestedRepoScans.get(args.scanId) === controller) {
      activeNestedRepoScans.delete(args.scanId)
    }
  }
}
