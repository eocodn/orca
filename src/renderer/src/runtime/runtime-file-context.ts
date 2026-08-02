import type {
  DirEntry,
  FsChangedPayload,
  GlobalSettings,
  MarkdownDocument,
  SearchOptions,
  SearchResult
} from '../../../shared/types'
import type {
  RuntimeFilePreviewResult,
  RuntimeFileReadChunkResult,
  RuntimeFileReadResult,
  RuntimeStatus
} from '../../../shared/runtime-types'
import {
  callRuntimeRpc,
  getActiveRuntimeTarget,
  RuntimeRpcCallError,
  unwrapRuntimeRpcResult
} from './runtime-rpc-client'
import type { RuntimeRpcResponse } from '../../../shared/runtime-rpc-envelope'
import { basename, joinPath, normalizeRelativePath } from '@/lib/path'
import {
  isWindowsAbsolutePathLike,
  relativePathInsideRoot
} from '../../../shared/cross-platform-path'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import {
  createEmptyRuntimeFileSearchResult,
  getRuntimeFileSearchRejectedField
} from './runtime-file-search-bounds'
import { assertFileMutationOwnershipCapability } from '../../../shared/file-mutation-ownership'
import {
  captureRuntimeEnvironmentRequestRevision,
  getRuntimeEnvironmentRevision
} from './runtime-environment-revision'

export type RuntimeReadableFileContent = {
  content: string
  isBinary: boolean
  isImage?: boolean
  mimeType?: string
  fileIdentity?: string
}

export type RuntimeFileReadArgs = {
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  filePath: string
  relativePath?: string
  worktreeId?: string
  connectionId?: string
  expectedExternalSshTargetId?: string
  includeLocalLogMetadata?: boolean
}

export type RuntimeFileOperationArgs = {
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  worktreeId: string | null | undefined
  worktreePath: string | null | undefined
  connectionId?: string
  expectedExecutionHostId?: 'local' | `ssh:${string}`
  expectedSshTargetId?: string
  expectedSshConnectionGeneration?: number
  expectedExternalSshTargetId?: string
}

export function assertExternalSshReadOwnership(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
  connectionId: string | undefined,
  expectedExternalSshTargetId: string | undefined
): void {
  const expectedTargetId = expectedExternalSshTargetId?.trim()
  if (
    expectedTargetId &&
    (getActiveRuntimeTarget(settings).kind === 'environment' || connectionId !== expectedTargetId)
  ) {
    throw new Error('External SSH files are not available after the workspace host changes.')
  }
}

export function withSshMutationExpectation<T extends object>(
  context: RuntimeFileOperationArgs,
  params: T
): T & {
  expectedExecutionHostId: 'local' | `ssh:${string}`
  expectedSshTargetId?: string
  expectedSshConnectionGeneration?: number
} {
  const sshTargetId = context.expectedSshTargetId ?? context.connectionId
  return {
    ...params,
    expectedExecutionHostId:
      context.expectedExecutionHostId ??
      (sshTargetId ? `ssh:${encodeURIComponent(sshTargetId)}` : 'local'),
    ...(context.expectedSshTargetId === undefined
      ? {}
      : { expectedSshTargetId: context.expectedSshTargetId }),
    ...(context.expectedSshConnectionGeneration === undefined
      ? {}
      : { expectedSshConnectionGeneration: context.expectedSshConnectionGeneration })
  }
}

export type RuntimeFileDownloadResult =
  | { canceled: true }
  | { canceled: false; destinationPath: string }

export type StagedRuntimeImportSource =
  | {
      sourcePath: string
      status: 'staged'
      name: string
      kind: 'file' | 'directory'
      entries: StagedRuntimeImportEntry[]
    }
  | {
      sourcePath: string
      status: 'skipped'
      reason: 'missing' | 'symlink' | 'permission-denied' | 'unsupported'
    }
  | { sourcePath: string; status: 'failed'; reason: string }

export type StagedRuntimeImportEntry =
  | { relativePath: string; kind: 'directory' }
  | { relativePath: string; kind: 'file'; contentBase64: string }

export type RuntimeImportResult =
  | {
      sourcePath: string
      status: 'imported'
      destPath: string
      kind: 'file' | 'directory'
      renamed: boolean
    }
  | {
      sourcePath: string
      status: 'skipped'
      reason: 'missing' | 'symlink' | 'permission-denied' | 'unsupported'
    }
  | {
      sourcePath: string
      status: 'failed'
      reason: string
    }

export type RuntimeFileWatchEvent =
  | { type: 'starting'; subscriptionId: string }
  | { type: 'ready'; subscriptionId: string }
  | { type: 'changed'; worktree: string; events: FsChangedPayload['events'] }
  | { type: 'error'; message: string }
  | { type: 'end' }

export const REMOTE_UPLOAD_BASE64_CHUNK_CHARS = 512 * 1024
export const REMOTE_DOWNLOAD_CHUNK_BYTES = 384 * 1024
export const REMOTE_DOWNLOAD_UPDATE_REQUIRED_MESSAGE =
  'Remote file download requires a newer Orca server. Update the headless server and try again.'

export type RemoteFileDownloadArgs = NonNullable<ReturnType<typeof getRemoteFileArgs>>
type RuntimeFileMutationTarget = { kind: 'environment'; environmentId: string }

export async function assertRuntimeFileMutationCapability(
  target: RuntimeFileMutationTarget,
  expectedEnvironmentPairingRevision: number | undefined
): Promise<void> {
  const status = await callRuntimeRpc<RuntimeStatus>(target, 'status.get', undefined, {
    timeoutMs: 15_000,
    expectedEnvironmentPairingRevision
  })
  assertFileMutationOwnershipCapability(status)
}

export async function callRuntimeFileMutation<TResult>(
  target: RuntimeFileMutationTarget,
  method: string,
  params: unknown,
  timeoutMs: number,
  expectedEnvironmentPairingRevision?: number
): Promise<TResult> {
  const requestRevision = captureRuntimeEnvironmentRequestRevision(
    target.environmentId,
    expectedEnvironmentPairingRevision
  )
  await assertRuntimeFileMutationCapability(target, requestRevision)
  return callRuntimeRpc<TResult>(target, method, params, {
    timeoutMs,
    expectedEnvironmentPairingRevision: requestRevision
  })
}

export function createRuntimeImportSessionGuard(
  environmentId: string,
  expectedEnvironmentPairingRevision: number | undefined,
  assertCallerCurrent?: () => void
): () => void {
  return () => {
    if (getRuntimeEnvironmentRevision(environmentId) !== expectedEnvironmentPairingRevision) {
      throw new Error('Runtime pairing changed; retry the import.')
    }
    assertCallerCurrent?.()
  }
}

export type RuntimeFileWatchListener = {
  onPayload: (payload: FsChangedPayload) => void
  onError?: (error: Error) => void
}

export type SharedRuntimeFileWatch = {
  target: { kind: 'environment'; environmentId: string }
  worktreeId: string
  listeners: Set<RuntimeFileWatchListener>
  start: Promise<void>
  unsubscribe: (() => void) | null
  remoteSubscriptionId: string | null
  keepStreamUntilReady: boolean
  closed: boolean
}

export const sharedRuntimeFileWatches = new Map<string, SharedRuntimeFileWatch>()

export function getSharedRuntimeFileWatchKey(
  environmentId: string,
  worktreeId: string,
  worktreePath: string
): string {
  return `${environmentId}\0${worktreeId}\0${worktreePath}`
}

export function getRuntimeFileReadScope(
  settings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined,
  connectionId: string | undefined
): string | undefined {
  const target = getActiveRuntimeTarget(settings)
  return target.kind === 'environment' ? `runtime:${target.environmentId}` : connectionId
}

export function canReadRelativeRuntimeFile(relativePath: string | undefined): relativePath is string {
  return Boolean(relativePath && relativePath.trim() && !isAbsolutePathLike(relativePath))
}

export function isAbsolutePathLike(value: string): boolean {
  return value.startsWith('/') || isWindowsAbsolutePathLike(value)
}

export function getRemoteFileArgs(
  context: RuntimeFileOperationArgs,
  absolutePath: string
): {
  target: ReturnType<typeof getActiveRuntimeTarget> & { kind: 'environment' }
  worktreeId: string
  worktreeSelector: string
  relativePath: string
} | null {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind !== 'environment' || !context.worktreeId) {
    return null
  }
  const relativePath = getRelativePathInsideWorktree(context.worktreePath, absolutePath)
  if (relativePath === null) {
    return null
  }
  return {
    target,
    worktreeId: context.worktreeId,
    worktreeSelector: toRuntimeWorktreeSelector(context.worktreeId),
    relativePath
  }
}

export function hasRemoteRuntimeOwner(context: RuntimeFileOperationArgs): boolean {
  return (
    getActiveRuntimeTarget(context.settings).kind === 'environment' && Boolean(context.worktreeId)
  )
}

export function assertLocalFilesystemFallbackAllowed(context: RuntimeFileOperationArgs): void {
  if (hasRemoteRuntimeOwner(context)) {
    throw new Error('Remote file is outside the owning runtime worktree')
  }
}

export function getRelativePathInsideWorktree(
  worktreePath: string | null | undefined,
  absolutePath: string
): string | null {
  if (!worktreePath) {
    return null
  }
  return relativePathInsideRoot(worktreePath, absolutePath)
}

export function joinRuntimeRelativePath(basePath: string, relativePath: string): string {
  const normalizedBase = normalizeRelativePath(basePath)
  const normalizedRelative = normalizeRelativePath(relativePath)
  if (!normalizedBase) {
    return normalizedRelative
  }
  if (!normalizedRelative) {
    return normalizedBase
  }
  return `${normalizedBase}/${normalizedRelative}`
}
