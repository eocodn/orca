import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  getGitHubRuntimeRepoId,
  getGitHubSourceRuntimeHost
} from '@/lib/github-source-runtime-context'
import { githubRepoIdentityKey } from '../../../shared/github-repository-identity-key'
import { MAX_RENDERED_DIFF_COMBINED_CHARACTERS } from '@/components/editor/large-diff-render-limit'
import {
  getTaskSourceCacheScope,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import type {
  GitHubOwnerRepo,
  GitHubPRFile,
  GitHubPRFileContents
} from '../../../shared/types'

export const PR_FILE_CONTENT_CACHE_MAX = 64
// Why: overflow is a sentinel; force reported size past the render budget so downstream checks reliably pick fallback mode.
export const GITHUB_PR_RAW_CONTENT_OVERFLOW_CHARACTER_COUNT = MAX_RENDERED_DIFF_COMBINED_CHARACTERS + 1
export const PR_FILE_CONTENT_CACHE_MAX_BYTES = MAX_RENDERED_DIFF_COMBINED_CHARACTERS * 4
export type PRFileContentCacheEntry = {
  value: Promise<GitHubPRFileContents> | GitHubPRFileContents
  byteCount: number
}
export const prFileContentCache = new Map<string, PRFileContentCacheEntry>()
export let prFileContentCacheBytes = 0

export function getUtf8ByteCount(value: string): number {
  let byteCount = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code < 0x80) {
      byteCount += 1
    } else if (code < 0x800) {
      byteCount += 2
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length) {
      const next = value.charCodeAt(index + 1)
      if (next >= 0xdc00 && next <= 0xdfff) {
        byteCount += 4
        index += 1
      } else {
        byteCount += 3
      }
    } else {
      byteCount += 3
    }
  }
  return byteCount
}

export function isPRFileContentsTooLargeSentinel(contents: GitHubPRFileContents): boolean {
  return contents.originalTooLarge === true || contents.modifiedTooLarge === true
}

export function getPRFileContentsCacheByteCount(contents: GitHubPRFileContents): number {
  if (isPRFileContentsTooLargeSentinel(contents)) {
    return 0
  }
  return getUtf8ByteCount(contents.original) + getUtf8ByteCount(contents.modified)
}

export function getRetainedPRFileContentsByteCount(contents: GitHubPRFileContents): number | null {
  if (isPRFileContentsTooLargeSentinel(contents)) {
    return 0
  }
  const byteCount = getPRFileContentsCacheByteCount(contents)
  return byteCount <= PR_FILE_CONTENT_CACHE_MAX_BYTES ? byteCount : null
}

export function touchPRFileContentCache(
  key: string,
  value: Promise<GitHubPRFileContents> | GitHubPRFileContents
): void {
  const retainedByteCount = value instanceof Promise ? 0 : getRetainedPRFileContentsByteCount(value)
  if (retainedByteCount === null) {
    const existing = prFileContentCache.get(key)
    prFileContentCacheBytes -= existing?.byteCount ?? 0
    prFileContentCache.delete(key)
    return
  }

  const existing = prFileContentCache.get(key)
  prFileContentCacheBytes -= existing?.byteCount ?? 0
  // Why: re-insert to move to MRU position; Map insertion order keeps the oldest key first for eviction.
  prFileContentCache.delete(key)
  const byteCount = retainedByteCount
  prFileContentCache.set(key, { value, byteCount })
  prFileContentCacheBytes += byteCount
  while (
    prFileContentCache.size > PR_FILE_CONTENT_CACHE_MAX ||
    prFileContentCacheBytes > PR_FILE_CONTENT_CACHE_MAX_BYTES
  ) {
    const oldest = prFileContentCache.keys().next().value
    if (oldest === undefined) {
      break
    }
    const evicted = prFileContentCache.get(oldest)
    prFileContentCacheBytes -= evicted?.byteCount ?? 0
    prFileContentCache.delete(oldest)
  }
}

export function getPRFileContentCacheKey(args: {
  repoPath: string
  repoId: string
  sourceContext?: TaskSourceContext | null
  prNumber: number
  prRepo?: GitHubOwnerRepo | null
  file: GitHubPRFile
  headSha: string
  baseSha: string
}): string {
  const repositoryKey = args.repoId ? `repo:${args.repoId}` : `path:${args.repoPath}`
  const sourceKey =
    args.sourceContext?.provider === 'github'
      ? `source:${getTaskSourceCacheScope(args.sourceContext)}`
      : 'source:local'
  return [
    repositoryKey,
    sourceKey,
    args.prNumber,
    args.prRepo ? githubRepoIdentityKey(args.prRepo) : '',
    args.file.path,
    args.file.oldPath ?? '',
    args.file.status,
    args.headSha,
    args.baseSha
  ].join('\0')
}

export function loadPRFileContents(args: {
  repoPath: string
  repoId: string
  sourceContext?: TaskSourceContext | null
  prNumber: number
  prRepo?: GitHubOwnerRepo | null
  file: GitHubPRFile
  headSha: string
  baseSha: string
}): Promise<GitHubPRFileContents> {
  const cacheKey = getPRFileContentCacheKey(args)
  const cached = prFileContentCache.get(cacheKey)
  if (cached) {
    touchPRFileContentCache(cacheKey, cached.value)
    return Promise.resolve(cached.value)
  }
  let request: Promise<GitHubPRFileContents>
  const runtimeHost = getGitHubSourceRuntimeHost(args.sourceContext)
  request = (
    runtimeHost
      ? callRuntimeRpc<GitHubPRFileContents>(
          { kind: 'environment', environmentId: runtimeHost.environmentId },
          'github.prFileContents',
          {
            repo: getGitHubRuntimeRepoId(args.sourceContext, args.repoId),
            prNumber: args.prNumber,
            prRepo: args.prRepo ?? null,
            path: args.file.path,
            oldPath: args.file.oldPath,
            status: args.file.status,
            headSha: args.headSha,
            baseSha: args.baseSha
          },
          { timeoutMs: 30_000 }
        )
      : window.api.gh.prFileContents({
          repoPath: args.repoPath,
          repoId: args.repoId,
          sourceContext: args.sourceContext,
          prNumber: args.prNumber,
          prRepo: args.prRepo ?? null,
          path: args.file.path,
          oldPath: args.file.oldPath,
          status: args.file.status,
          headSha: args.headSha,
          baseSha: args.baseSha
        })
  )
    .then((contents) => {
      if (prFileContentCache.get(cacheKey)?.value === request) {
        touchPRFileContentCache(cacheKey, contents)
      }
      return contents
    })
    .catch((err) => {
      const cachedRequest = prFileContentCache.get(cacheKey)
      if (cachedRequest?.value === request) {
        prFileContentCacheBytes -= cachedRequest.byteCount
        prFileContentCache.delete(cacheKey)
      }
      throw err
    })
  touchPRFileContentCache(cacheKey, request)
  return request
}

