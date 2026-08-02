import { isAgentScratchRepoRootPath } from '../../shared/agent-scratch-worktrees'
import { normalizeRuntimePathForComparison } from '../../shared/cross-platform-path'
import type { Repo } from '../../shared/types'
import { splitWorktreeIdForFilesystem } from '../../shared/worktree-id'

const WORKTREE_SCAN_CACHE_TTL_MS = 30_000
const WORKTREE_SCAN_AGENT_SCRATCH_TTL_MS = 5 * 60_000

export function resolveWorktreeScanCacheTtlMs(repo: Pick<Repo, 'path' | 'connectionId'>): number {
  return !repo.connectionId && isAgentScratchRepoRootPath(repo.path)
    ? WORKTREE_SCAN_AGENT_SCRATCH_TTL_MS
    : WORKTREE_SCAN_CACHE_TTL_MS
}

export async function waitForWorktreeTerminalMutation(
  previous: Promise<void>,
  deadline?: number
): Promise<void> {
  if (deadline === undefined) {
    await previous
    return
  }
  const remainingMs = deadline - Date.now()
  if (remainingMs <= 0) {
    throw new Error('terminal_worktree_sleep_timeout')
  }
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      previous,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('terminal_worktree_sleep_timeout')),
          remainingMs
        )
      })
    ])
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout)
    }
  }
}

export function notifyRuntimeListeners<L>(
  listeners: Iterable<L>,
  deliver: (listener: L) => void,
  context: string
): void {
  for (const listener of listeners) {
    try {
      deliver(listener)
    } catch (error) {
      console.error(`[runtime] ${context} listener threw`, error)
    }
  }
}

export function setBoundedMapEntry<K, V>(
  map: Map<K, V>,
  key: K,
  value: V,
  maxEntries: number
): void {
  if (map.has(key)) {
    map.delete(key)
  }
  map.set(key, value)
  while (map.size > maxEntries) {
    const oldest = map.keys().next()
    if (oldest.done) {
      return
    }
    map.delete(oldest.value)
  }
}

export function getExplicitWorktreeIdSelector(selector: string | undefined): string | null {
  if (!selector?.startsWith('id:')) {
    return null
  }
  const id = selector.slice(3)
  return id.length > 0 ? id : null
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null
  return new Promise<T>((resolve) => {
    timeout = setTimeout(() => resolve(fallback), timeoutMs)
    promise.then(
      (value) => resolve(value),
      () => resolve(fallback)
    )
  }).finally(() => {
    if (timeout) {
      clearTimeout(timeout)
    }
  })
}

export function withTimeoutResult<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<{ ok: true; value: T } | { ok: false }> {
  return withTimeout(
    promise.then((value) => ({ ok: true, value }) as const),
    timeoutMs,
    { ok: false }
  )
}

export function branchSelectorMatches(branch: string, selector: string): boolean {
  return normalizeBranchName(branch) === normalizeBranchName(selector)
}

function normalizeBranchName(branch: string): string {
  return branch.startsWith('refs/heads/') ? branch.slice('refs/heads/'.length) : branch
}

export function runtimePathsEqual(left: string, right: string): boolean {
  return normalizeRuntimePathForComparison(left) === normalizeRuntimePathForComparison(right)
}

export function runtimeWorktreeIdsEqual(left: string, right: string): boolean {
  const parsedLeft = splitWorktreeIdForFilesystem(left)
  const parsedRight = splitWorktreeIdForFilesystem(right)
  return parsedLeft && parsedRight
    ? parsedLeft.repoId === parsedRight.repoId &&
        runtimePathsEqual(parsedLeft.worktreePath, parsedRight.worktreePath)
    : left === right
}

export function runtimeWorktreeIdentityKey(worktreeId: string): string {
  const parsed = splitWorktreeIdForFilesystem(worktreeId)
  return parsed
    ? `${parsed.repoId}\0${normalizeRuntimePathForComparison(parsed.worktreePath)}`
    : worktreeId
}
