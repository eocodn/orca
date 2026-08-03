import { posix, win32 } from 'node:path'
import { platform } from 'node:process'
import type { GitWorktreeInfo, Repo, Worktree } from '../shared/types'
import type {
  WorkspaceSpaceDirectoryScanResult,
  WorkspaceSpaceItem,
  WorkspaceSpaceRepoSummary,
  WorkspaceSpaceScanProgress,
  WorkspaceSpaceScanStatus,
  WorkspaceSpaceWorktree
} from '../shared/workspace-space-types'
import type { WorkspaceSpaceEntryScan } from '../shared/workspace-space-entry-traversal'
import { WorkspaceSpaceScanCapacityError } from '../shared/workspace-space-scan-budget'

export const REPO_SCAN_CONCURRENCY = 2
export const WORKTREE_SCAN_CONCURRENCY = 3
export const LOCAL_WORKTREE_SCAN_CONCURRENCY = 1
// Why: the SSH compatibility walker traverses inside the desktop main process
// and each traversal carries its own admission budget, so repo × worktree
// concurrency would otherwise stack six independent budgets on this heap.
export const REMOTE_FALLBACK_SCAN_CONCURRENCY = 2
export const LOCAL_FS_CONCURRENCY = 48
export const REMOTE_FS_CONCURRENCY = 10
export const DU_TIMEOUT_MS = 120_000
export const DU_MAX_BUFFER_BYTES = 16 * 1024 * 1024

export type AsyncLimiter = <T>(task: () => Promise<T>) => Promise<T>

export type WorkspaceSpaceScanLimiters = {
  localWorktree: AsyncLimiter
  remoteFallbackTraversal: AsyncLimiter
}

export type ScanStats = WorkspaceSpaceEntryScan

export type WorktreeListResult =
  | { ok: true; worktrees: GitWorktreeInfo[] }
  | { ok: false; status: Exclude<WorkspaceSpaceScanStatus, 'ok'>; error: string }

export type RepoScanResult = {
  summary: WorkspaceSpaceRepoSummary
  worktrees: WorkspaceSpaceWorktree[]
}

export type WorkspaceSpaceAnalyzeOptions = {
  signal?: AbortSignal
  scanId?: string
  onProgress?: (progress: WorkspaceSpaceScanProgress) => void
}

export type WorkspaceSpaceProgressState = WorkspaceSpaceScanProgress

export class WorkspaceSpaceScanCancelledError extends Error {
  constructor() {
    super('Workspace space scan cancelled')
    this.name = 'WorkspaceSpaceScanCancelledError'
  }
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new WorkspaceSpaceScanCancelledError()
  }
}

export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  return (error as { name?: unknown }).name === 'AbortError'
}

export function isRelayMethodNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  return (error as { code?: unknown }).code === -32601
}

export function createAsyncLimiter(maxConcurrent: number, signal?: AbortSignal): AsyncLimiter {
  let active = 0
  const queue: { resolve: () => void; reject: (error: Error) => void }[] = []

  const acquire = async (): Promise<void> => {
    throwIfAborted(signal)
    if (active < maxConcurrent) {
      active += 1
      return
    }
    await new Promise<void>((resolve, reject) => {
      let onAbort: (() => void) | null = null
      const waiter = {
        resolve: () => {
          if (onAbort) {
            signal?.removeEventListener('abort', onAbort)
          }
          resolve()
        },
        reject
      }
      onAbort = () => {
        const index = queue.indexOf(waiter)
        if (index !== -1) {
          queue.splice(index, 1)
        }
        reject(new WorkspaceSpaceScanCancelledError())
      }
      queue.push(waiter)
      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true })
        if (signal.aborted) {
          onAbort()
        }
      }
    })
    throwIfAborted(signal)
    active += 1
  }

  return async <T>(task: () => Promise<T>): Promise<T> => {
    await acquire()
    try {
      return await task()
    } finally {
      active -= 1
      const next = queue.shift()
      next?.resolve()
    }
  }
}

export function looksLikeWindowsPath(pathValue: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(pathValue) || pathValue.startsWith('\\\\')
}

export function basenameFilesystemPath(pathValue: string): string {
  return looksLikeWindowsPath(pathValue) ? win32.basename(pathValue) : posix.basename(pathValue)
}

export function joinFilesystemPath(parent: string, child: string): string {
  return looksLikeWindowsPath(parent) ? win32.join(parent, child) : posix.join(parent, child)
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function normalizeLocalDuPath(pathValue: string): string {
  const separator = platform === 'win32' ? '\\' : '/'
  const trimmed = pathValue.replace(new RegExp(`${escapeRegExp(separator)}+$`), '')
  return trimmed.length > 0 ? trimmed : pathValue
}

export function parseDuDepthOneOutput(stdout: string): Map<string, number> {
  const sizes = new Map<string, number>()
  for (const line of stdout.split('\n')) {
    const normalizedLine = line.endsWith('\r') ? line.slice(0, -1) : line
    if (!normalizedLine) {
      continue
    }
    const match = /^(\d+)\s+(.+)$/.exec(normalizedLine)
    if (!match) {
      continue
    }
    sizes.set(normalizeLocalDuPath(match[2]), Number(match[1]) * 1024)
  }
  return sizes
}

export async function readLocalDuDepthOne(
  rootPath: string,
  signal?: AbortSignal
): Promise<Map<string, number>> {
  const stdout = await new Promise<string>((resolve, reject) => {
    let settled = false
    let child: ReturnType<typeof execFile> | undefined
    let onAbort: (() => void) | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    const settle = (callback: () => void): void => {
      if (settled) {
        return
      }
      settled = true
      if (timer) {
        clearTimeout(timer)
      }
      if (onAbort) {
        signal?.removeEventListener('abort', onAbort)
      }
      callback()
    }
    timer = setTimeout(() => {
      settle(() => {
        child?.kill()
        reject(new Error(`du timed out after ${DU_TIMEOUT_MS}ms`))
      })
    }, DU_TIMEOUT_MS)
    onAbort = () => {
      settle(() => {
        child?.kill()
        reject(new Error('Workspace space scan cancelled'))
      })
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) {
      onAbort()
      return
    }

    // Why: execFile's timeout only signals `du`; a wedged child that never
    // calls back must not block the Space scan or its portable fallback.
    try {
      child = execFile(
        'du',
        ['-k', '-d', '1', rootPath],
        {
          encoding: 'utf8',
          maxBuffer: DU_MAX_BUFFER_BYTES,
          signal,
          timeout: DU_TIMEOUT_MS
        },
        (error, stdout) => {
          if (error) {
            settle(() => reject(error))
            return
          }
          settle(() => resolve(String(stdout)))
        }
      )
    } catch (error) {
      settle(() => reject(error))
    }
  })
  return parseDuDepthOneOutput(stdout)
}

export function classifyError(error: unknown): {
  status: Exclude<WorkspaceSpaceScanStatus, 'ok'>
  message: string
} {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
  const message = error instanceof Error ? error.message : String(error)

  // Why: a workspace over the scan budget is intact and readable, just too big
  // to size safely, so it reads as unavailable rather than a filesystem error.
  if (error instanceof WorkspaceSpaceScanCapacityError) {
    return { status: 'unavailable', message }
  }
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return { status: 'missing', message }
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return { status: 'permission-denied', message }
  }
  return { status: 'error', message }
}

export function toWorkspaceSpaceItem(stats: ScanStats): WorkspaceSpaceItem {
  return {
    name: stats.name,
    path: stats.path,
    kind: stats.kind,
    sizeBytes: stats.sizeBytes
  }
}

export function createBaseWorktreeRow(
  repo: Repo,
  worktree: Worktree,
  scannedAt: number
): Omit<
  WorkspaceSpaceWorktree,
  | 'status'
  | 'error'
  | 'sizeBytes'
  | 'reclaimableBytes'
  | 'skippedEntryCount'
  | 'topLevelItems'
  | 'omittedTopLevelItemCount'
  | 'omittedTopLevelSizeBytes'
> {
  const canDelete = !worktree.isMainWorktree
  return {
    worktreeId: worktree.id,
    repoId: repo.id,
    repoDisplayName: repo.displayName,
    repoPath: repo.path,
    displayName: worktree.displayName,
    path: worktree.path,
    branch: worktree.branch,
    isMainWorktree: worktree.isMainWorktree,
    isRemote: Boolean(repo.connectionId),
    isSparse: worktree.isSparse === true,
    canDelete,
    lastActivityAt: worktree.lastActivityAt,
    scannedAt
  }
}

export function createUnavailableWorktreeRow(
  repo: Repo,
  worktree: Worktree,
  scannedAt: number,
  status: Exclude<WorkspaceSpaceScanStatus, 'ok'>,
  error: string
): WorkspaceSpaceWorktree {
  return {
    ...createBaseWorktreeRow(repo, worktree, scannedAt),
    status,
    error,
    sizeBytes: 0,
    reclaimableBytes: 0,
    skippedEntryCount: 0,
    topLevelItems: [],
    omittedTopLevelItemCount: 0,
    omittedTopLevelSizeBytes: 0
  }
}

export function createScannedWorktreeRow(
  repo: Repo,
  worktree: Worktree,
  scannedAt: number,
  scan: WorkspaceSpaceDirectoryScanResult
): WorkspaceSpaceWorktree {
  return {
    ...createBaseWorktreeRow(repo, worktree, scannedAt),
    status: 'ok',
    error: null,
    sizeBytes: scan.sizeBytes,
    reclaimableBytes: worktree.isMainWorktree ? 0 : scan.sizeBytes,
    skippedEntryCount: scan.skippedEntryCount,
    topLevelItems: scan.topLevelItems,
    omittedTopLevelItemCount: scan.omittedTopLevelItemCount,
    omittedTopLevelSizeBytes: scan.omittedTopLevelSizeBytes
  }
}
