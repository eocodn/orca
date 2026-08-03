import { homedir } from 'node:os'
import { z } from 'zod'
import type { Repo, NestedRepoScanResult } from '../../shared/types'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import { isTuiAgent } from '../../shared/tui-agent-config'
import { TaskSourceContextSchema } from '../../shared/task-source-context-schema'
import { WorkspaceLinkedItemSchema } from '../../shared/workspace-linked-item-schema'
import { isWorkspaceLinkedItemSourceContextMatch } from '../../shared/workspace-linked-item-source-context'
import { gitExecFileAsync } from '../git/runner'
import { isAbsolute, join } from 'node:path'
import { cleanupClaimedCloneTarget } from '../git/repo-clone-path'
import { isGitRepo } from '../git/repo'
import { getActiveMultiplexer } from './ssh'
import { runWithGitReadCacheInvalidation } from '../git/status'

// Why: `method` is the IPC entry point the user took, not what they added (never path/URL/name); repos:create → 'folder_picker'.
// Why: `isGitRepo` is a non-identifying git-vs-folder signal from the caller's detection; pass undefined when unknown, never default false.
// Why: it replaced onboarding_completed.is_git_repo, which lost meaning once repo selection left onboarding (1.4.46).
import { createRemoteRepo,
  resolveRemoteHomePath,
  type ActiveCloneMetadata,
  type ActiveRemoteCloneMetadata,
  activeClone,
  activeRemoteClone,
  nextCloneGeneration,
  latestCloneGenerationByPath,
  pendingAbortCleanupByPath,
  cloneInFlightByPath,
  remoteCloneInFlightByPath,
  activeNestedRepoScans,
  type CompletedNestedRepoScan,
  completedNestedRepoScans,
  MAX_COMPLETED_NESTED_SCAN_RESULTS,
  GIT_AVAILABILITY_TIMEOUT_MS,
  emitCloneProgressFromText,
  ProjectGroupCreateArgs,
  ProjectGroupUpdateArgs,
  ProjectGroupSelectorArgs,
  ProjectGroupMoveProjectArgs,
  ProjectHostSetupExistingFolderIpcArgs,
  LocalWindowsRuntimePreferenceIpcArgs,
  ProjectUpdateIpcArgs,
  ProjectHostSetupCreateIpcArgs } from './repo-ipc-clone'
export { createRemoteRepo,
  resolveRemoteHomePath,
  type ActiveCloneMetadata,
  type ActiveRemoteCloneMetadata,
  activeClone,
  activeRemoteClone,
  nextCloneGeneration,
  latestCloneGenerationByPath,
  pendingAbortCleanupByPath,
  cloneInFlightByPath,
  remoteCloneInFlightByPath,
  activeNestedRepoScans,
  type CompletedNestedRepoScan,
  completedNestedRepoScans,
  MAX_COMPLETED_NESTED_SCAN_RESULTS,
  GIT_AVAILABILITY_TIMEOUT_MS,
  emitCloneProgressFromText,
  ProjectGroupCreateArgs,
  ProjectGroupUpdateArgs,
  ProjectGroupSelectorArgs,
  ProjectGroupMoveProjectArgs,
  ProjectHostSetupExistingFolderIpcArgs,
  LocalWindowsRuntimePreferenceIpcArgs,
  ProjectUpdateIpcArgs,
  ProjectHostSetupCreateIpcArgs } from './repo-ipc-clone'

export const ProjectHostSetupUpdateIpcArgs = z.object({
  setupId: z.string().min(1),
  updates: z.object({
    displayName: z.string().optional(),
    path: z.string().optional(),
    worktreeBasePath: z.string().optional(),
    setupState: z.enum(['ready', 'not-set-up', 'setting-up', 'error', 'unsupported']).optional(),
    setupMethod: z
      .enum(['legacy-repo', 'imported-existing-folder', 'cloned', 'provisioned'])
      .optional(),
    gitUsername: z.string().optional(),
    kind: z.enum(['git', 'folder']).optional()
  })
})

export const ProjectHostSetupDeleteIpcArgs = z.object({
  setupId: z.string().min(1)
})

export const FolderWorkspaceLinkedTaskArgs = WorkspaceLinkedItemSchema.nullable()

export function assertFolderWorkspaceLinkedSourceContextMatch(
  value: {
    linkedTask?: z.infer<typeof FolderWorkspaceLinkedTaskArgs>
    linkedTaskSourceContext?: z.infer<typeof TaskSourceContextSchema> | null
  },
  ctx: z.RefinementCtx
): void {
  if (
    value.linkedTask &&
    value.linkedTaskSourceContext &&
    !isWorkspaceLinkedItemSourceContextMatch(value.linkedTask, value.linkedTaskSourceContext)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Linked task and source context identities must match'
    })
  }
}

export const FolderWorkspaceCreateArgs = z
  .object({
    projectGroupId: z.string().min(1),
    name: z.string().optional(),
    folderPath: z.string().nullable().optional(),
    connectionId: z.string().nullable().optional(),
    linkedTask: FolderWorkspaceLinkedTaskArgs.optional(),
    linkedTaskSourceContext: TaskSourceContextSchema.nullable().optional(),
    createdWithAgent: z.string().refine(isTuiAgent).optional(),
    pendingFirstAgentMessageRename: z.boolean().optional()
  })
  .superRefine(assertFolderWorkspaceLinkedSourceContextMatch)

export const FolderWorkspaceUpdateArgs = z.object({
  folderWorkspaceId: z.string().min(1),
  updates: z
    .object({
      name: z.string().optional(),
      folderPath: z.string().optional(),
      linkedTask: FolderWorkspaceLinkedTaskArgs.optional(),
      linkedTaskSourceContext: TaskSourceContextSchema.nullable().optional(),
      comment: z.string().optional(),
      isArchived: z.boolean().optional(),
      isUnread: z.boolean().optional(),
      isPinned: z.boolean().optional(),
      sortOrder: z.number().finite().optional(),
      manualOrder: z.number().finite().optional(),
      workspaceStatus: z.string().optional(),
      createdWithAgent: z.string().refine(isTuiAgent).optional(),
      pendingFirstAgentMessageRename: z.boolean().optional(),
      firstAgentMessageRenameError: z.string().nullable().optional(),
      lastActivityAt: z.number().finite().optional()
    })
    .superRefine(assertFolderWorkspaceLinkedSourceContextMatch)
})

export const FolderWorkspaceSelectorArgs = z.object({
  folderWorkspaceId: z.string().min(1)
})

export const FolderWorkspacePathStatusArgs = z.discriminatedUnion('scope', [
  z.object({
    scope: z.literal('folder-workspace'),
    folderWorkspaceId: z.string().min(1)
  }),
  z.object({
    scope: z.literal('project-group'),
    projectGroupId: z.string().min(1)
  }),
  z.object({
    scope: z.literal('path'),
    path: z.string().min(1),
    connectionId: z.string().min(1).nullable().optional()
  })
])

export const ProjectGroupScanNestedArgs = z.object({
  path: z.string().min(1),
  connectionId: z.string().min(1).optional(),
  scanId: z.string().min(1).optional(),
  options: z.unknown().optional()
})

export const ProjectGroupCancelNestedScanArgs = z.object({
  scanId: z.string().min(1)
})

export const ProjectGroupImportNestedArgs = z.discriminatedUnion('mode', [
  z.object({
    parentPath: z.string().min(1),
    groupName: z.string().optional().default(''),
    projectPaths: z.array(z.string()),
    connectionId: z.string().min(1).optional(),
    scanId: z.string().min(1).optional(),
    mode: z.literal('group')
  }),
  z.object({
    parentPath: z.string().min(1),
    groupName: z.string().optional().default(''),
    projectPaths: z.array(z.string()),
    connectionId: z.string().min(1).optional(),
    scanId: z.string().min(1).optional(),
    mode: z.literal('separate')
  })
])

export function parseProjectGroupIpcArgs<T>(schema: z.ZodType<T>, value: unknown, errorCode: string): T {
  const result = schema.safeParse(value)
  if (result.success) {
    return result.data
  }
  throw new Error(errorCode)
}

export function validateNestedRepoScanRoot(path: string, connectionId?: string): void {
  if (connectionId) {
    return
  }
  if (!isAbsolute(path)) {
    throw new Error('Repo path must be an absolute path')
  }
}

export function rememberCompletedNestedRepoScan(
  scanId: string | undefined,
  context: { parentPath: string; connectionId?: string },
  scan: NestedRepoScanResult
): void {
  if (!scanId) {
    return
  }
  completedNestedRepoScans.set(scanId, {
    scan,
    parentPath: scan.selectedPath,
    connectionId: context.connectionId ?? null
  })
  while (completedNestedRepoScans.size > MAX_COMPLETED_NESTED_SCAN_RESULTS) {
    const oldestScanId = completedNestedRepoScans.keys().next().value
    if (!oldestScanId) {
      break
    }
    completedNestedRepoScans.delete(oldestScanId)
  }
}

export function getCompletedNestedRepoScan(args: {
  scanId?: string
  parentPath: string
  connectionId?: string
}): NestedRepoScanResult | undefined {
  if (!args.scanId) {
    return undefined
  }
  const completed = completedNestedRepoScans.get(args.scanId)
  if (!completed) {
    return undefined
  }
  if (
    completed.connectionId !== (args.connectionId ?? null) ||
    normalizeRuntimePathForComparison(completed.parentPath) !==
      normalizeRuntimePathForComparison(args.parentPath)
  ) {
    return undefined
  }
  return completed.scan
}

export async function cleanupOwnedCloneTarget(metadata: ActiveCloneMetadata): Promise<void> {
  if (!metadata.claimedTarget.canCleanup || !metadata.claimedTarget.ownedDirectoryIdentity) {
    return
  }
  if (latestCloneGenerationByPath.get(metadata.pathKey) !== metadata.generation) {
    return
  }
  // Why: a fast retry may attach a newer process before the aborted one closes; the old close handler must not delete it.
  if (
    activeClone &&
    activeClone.process !== metadata.process &&
    activeClone.pathKey === metadata.pathKey
  ) {
    return
  }

  if (latestCloneGenerationByPath.get(metadata.pathKey) !== metadata.generation) {
    return
  }
  await cleanupClaimedCloneTarget(metadata.path, metadata.claimedTarget)
}

export async function isGitAvailable(): Promise<boolean> {
  try {
    await gitExecFileAsync(['--version'], {
      cwd: process.cwd(),
      timeout: GIT_AVAILABILITY_TIMEOUT_MS
    })
    return true
  } catch {
    return false
  }
}

export function getDefaultCreateProjectParent(): string {
  return join(homedir(), 'orca', 'projects')
}

export function markCloneAbortCleanupPending(metadata: ActiveCloneMetadata): void {
  if (metadata.resolvePendingAbortCleanup) {
    return
  }
  metadata.pendingAbortCleanup = new Promise<void>((resolve) => {
    metadata.resolvePendingAbortCleanup = resolve
  })
  pendingAbortCleanupByPath.set(metadata.pathKey, metadata.pendingAbortCleanup)
}

export function settleCloneAbortCleanup(metadata: ActiveCloneMetadata): void {
  if (pendingAbortCleanupByPath.get(metadata.pathKey) === metadata.pendingAbortCleanup) {
    pendingAbortCleanupByPath.delete(metadata.pathKey)
  }
  metadata.resolvePendingAbortCleanup?.()
  metadata.pendingAbortCleanup = null
  metadata.resolvePendingAbortCleanup = null
}

export async function runWithClonePathLock<T>(clonePathKey: string, task: () => Promise<T>): Promise<T> {
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

export function sanitizeNestedRepoImportError(context: string, error: unknown): string {
  console.warn(`[project-groups] ${context}`, error)
  return 'Repository could not be imported'
}

export async function resolveSshProjectGroupPath(connectionId: string, path: string): Promise<string> {
  if (path === '~' || path === '~/' || path.startsWith('~/')) {
    const mux = getActiveMultiplexer(connectionId)
    if (mux) {
      try {
        const result = (await mux.request('session.resolveHome', { path })) as {
          resolvedPath: string
        }
        return result.resolvedPath
      } catch {
        return path
      }
    }
  }
  return path
}
