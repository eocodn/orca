import type { DirEntry, MarkdownDocument, SearchOptions, SearchResult } from '../../../shared/types'
import type { RuntimeFileOperationArgs } from './runtime-file-context'
import { callRuntimeRpc, getActiveRuntimeTarget } from './runtime-rpc-client'
import { toRuntimeWorktreeSelector } from './runtime-worktree-selector'
import {
  assertLocalFilesystemFallbackAllowed,
  getRemoteFileArgs,
  hasRemoteRuntimeOwner
} from './runtime-file-context'

export async function readRuntimeDirectory(
  context: RuntimeFileOperationArgs,
  dirPath: string
): Promise<DirEntry[]> {
  const remoteArgs = getRemoteFileArgs(context, dirPath)
  if (!remoteArgs) {
    assertLocalFilesystemFallbackAllowed(context)
    return window.api.fs.readDir({ dirPath, connectionId: context.connectionId })
  }
  return callRuntimeRpc<DirEntry[]>(
    remoteArgs.target,
    'files.readDir',
    { worktree: remoteArgs.worktreeSelector, relativePath: remoteArgs.relativePath },
    { timeoutMs: 15_000 }
  )
}

export async function searchRuntimeFiles(
  context: RuntimeFileOperationArgs,
  options: SearchOptions
): Promise<SearchResult> {
  if (getRuntimeFileSearchRejectedField(options)) {
    return createEmptyRuntimeFileSearchResult()
  }
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind !== 'environment' || !context.worktreeId) {
    return window.api.fs.search({
      ...options,
      connectionId: context.connectionId
    })
  }
  const { rootPath: _rootPath, ...runtimeOptions } = options
  return callRuntimeRpc<SearchResult>(
    target,
    'files.search',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId), ...runtimeOptions },
    { timeoutMs: 15_000 }
  )
}

export async function listRuntimeFiles(
  context: RuntimeFileOperationArgs,
  args: { rootPath: string; excludePaths?: string[]; requestToken?: string }
): Promise<string[]> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind !== 'environment' || !context.worktreeId) {
    return window.api.fs.listFiles({
      rootPath: args.rootPath,
      connectionId: context.connectionId,
      excludePaths: args.excludePaths,
      requestToken: args.requestToken
    })
  }
  return callRuntimeRpc<string[]>(
    target,
    'files.listAll',
    {
      worktree: toRuntimeWorktreeSelector(context.worktreeId),
      excludePaths: args.excludePaths
    },
    { timeoutMs: 15_000 }
  )
}

/**
 * Best-effort abort of an in-flight listRuntimeFiles call (#7721). Switching
 * workspaces must stop the previous workspace's full-tree scan — over SSH an
 * abandoned scan keeps loading the relay and starves fs.readDir/fs.stat.
 */
export function cancelRuntimeFileList(
  context: RuntimeFileOperationArgs,
  requestToken: string
): void {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind !== 'environment' || !context.worktreeId) {
    void window.api.fs.cancelListFiles({ requestToken }).catch(() => {
      /* cancellation is advisory; the request path has its own timeouts */
    })
  }
  // Environment runtimes bound files.listAll with their own RPC timeout.
}

export async function listRuntimeMarkdownDocuments(
  context: RuntimeFileOperationArgs,
  rootPath: string
): Promise<MarkdownDocument[]> {
  const target = getActiveRuntimeTarget(context.settings)
  if (target.kind !== 'environment' || !context.worktreeId) {
    return window.api.fs.listMarkdownDocuments({
      rootPath,
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<MarkdownDocument[]>(
    target,
    'files.listMarkdownDocuments',
    { worktree: toRuntimeWorktreeSelector(context.worktreeId) },
    { timeoutMs: 15_000 }
  )
}

export async function statRuntimePath(
  context: RuntimeFileOperationArgs,
  absolutePath: string
): Promise<{ size: number; isDirectory: boolean; mtime: number }> {
  const remoteArgs = getRemoteFileArgs(context, absolutePath)
  if (!remoteArgs) {
    assertLocalFilesystemFallbackAllowed(context)
    return window.api.fs.stat({
      filePath: absolutePath,
      connectionId: context.connectionId
    })
  }
  return callRuntimeRpc<{ size: number; isDirectory: boolean; mtime: number }>(
    remoteArgs.target,
    'files.stat',
    { worktree: remoteArgs.worktreeSelector, relativePath: remoteArgs.relativePath },
    { timeoutMs: 15_000 }
  )
}

export async function runtimePathExists(
  context: RuntimeFileOperationArgs,
  absolutePath: string,
  expectedEnvironmentPairingRevision?: number
): Promise<boolean> {
  const remoteArgs = getRemoteFileArgs(context, absolutePath)
  if (!remoteArgs) {
    assertLocalFilesystemFallbackAllowed(context)
    return window.api.fs.pathExists({
      filePath: absolutePath,
      connectionId: context.connectionId
    })
  }

  try {
    await callRuntimeRpc(
      remoteArgs.target,
      'files.stat',
      { worktree: remoteArgs.worktreeSelector, relativePath: remoteArgs.relativePath },
      { timeoutMs: 15_000, expectedEnvironmentPairingRevision }
    )
    return true
  } catch (err) {
    const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase()
    if (
      message.includes('enoent') ||
      message.includes('not found') ||
      message.includes('no such file')
    ) {
      return false
    }
    throw err
  }
}

export function isRemoteRuntimeFileOperation(
  context: RuntimeFileOperationArgs,
  path: string
): boolean {
  return getRemoteFileArgs(context, path) !== null
}

