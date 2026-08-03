import { stat } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  GitWorktreeInfo,
  LocalBaseRefRefreshResult
} from '../../shared/types'
import { decodeGitCQuotedPath } from '../../shared/git-cquoted-path'
import {
  isUnsupportedWorktreeListZError
} from '../../shared/git-worktree-command-capabilities'
import { getLocalGitCapabilityCache } from './git-capability-state'
import { gitExecFileAsync, translateWslOutputPaths } from './runner'
import { type GitWorktreeExecOptions, type AddWorktreeOptions, SPARSE_CHECKOUT_DETECTION_CONCURRENCY, PRUNABLE_EXISTENCE_PROBE_CONCURRENCY, WORKTREE_LIST_TIMEOUT_MS, gitExecOptions, getErrorCode, isNotGitRepositoryError, evaluateLocalBaseRefRefreshability, normalizeMainWorktreePath } from './worktree-foundation'
import { translateWorktreePath, detectSparseCheckout } from './worktree-cleanup-sparse'
function parseWorktreeList(
  output: string,
  options: { nulDelimited?: boolean } = {}
): GitWorktreeInfo[] {
  const worktrees: GitWorktreeInfo[] = []
  const blocks = options.nulDelimited ? splitNulWorktreeList(output) : splitLineWorktreeList(output)

  for (const lines of blocks) {
    if (lines.length === 0) {
      continue
    }

    let path = ''
    let head = ''
    let branch = ''
    let isBare = false
    let isSparse = false
    let locked = false
    let lockReason = ''
    let prunable = false
    let prunableReason = ''

    for (const line of lines) {
      if (line.startsWith('worktree ')) {
        path = line.slice('worktree '.length)
      } else if (line.startsWith('HEAD ')) {
        head = line.slice('HEAD '.length)
      } else if (line.startsWith('branch ')) {
        branch = line.slice('branch '.length)
      } else if (line === 'bare') {
        isBare = true
      } else if (line === 'sparse') {
        isSparse = true
      } else if (line === 'locked' || line.startsWith('locked ')) {
        locked = true
        const rawReason = line.slice('locked'.length).trim()
        lockReason = options.nulDelimited ? rawReason : decodeGitCQuotedPath(rawReason)
      } else if (line === 'prunable' || line.startsWith('prunable ')) {
        // Why: Git ≥2.36 flags registrations whose directory is gone; ignoring it shows the stale worktree as live (#8389).
        prunable = true
        const rawReason = line.slice('prunable'.length).trim()
        prunableReason = options.nulDelimited ? rawReason : decodeGitCQuotedPath(rawReason)
      }
    }

    if (path) {
      // `git worktree list` always emits the main working tree first.
      worktrees.push({
        path,
        head,
        branch,
        isBare,
        ...(isSparse ? { isSparse } : {}),
        ...(locked ? { locked: true } : {}),
        ...(lockReason ? { lockReason } : {}),
        ...(prunable ? { prunable: true } : {}),
        ...(prunableReason ? { prunableReason } : {}),
        isMainWorktree: worktrees.length === 0
      })
    }
  }

  return worktrees
}

function splitLineWorktreeList(output: string): string[][] {
  return output
    .trim()
    .split(/\r?\n\r?\n/)
    .map((block) => block.trim().split(/\r?\n/))
}

function splitNulWorktreeList(output: string): string[][] {
  if (!output.includes('\0')) {
    return splitLineWorktreeList(output)
  }

  const blocks: string[][] = []
  let currentBlock: string[] = []

  for (const field of output.split('\0')) {
    if (field) {
      currentBlock.push(field)
      continue
    }
    if (currentBlock.length > 0) {
      blocks.push(currentBlock)
      currentBlock = []
    }
  }

  if (currentBlock.length > 0) {
    blocks.push(currentBlock)
  }

  return blocks
}

async function readWorktreeList(
  repoPath: string,
  options: GitWorktreeExecOptions = {}
): Promise<GitWorktreeInfo[]> {
  const capabilities = getLocalGitCapabilityCache({
    cwd: repoPath,
    wslDistro: options.wslDistro
  })
  const execOptions = {
    cwd: repoPath,
    ...options,
    timeout: options.timeout ?? WORKTREE_LIST_TIMEOUT_MS
  }
  return capabilities.runWithFallback(
    'worktree-list-z',
    async () => {
      const { stdout } = await gitExecFileAsync(
        ['worktree', 'list', '--porcelain', '-z'],
        execOptions
      )
      return normalizeMainWorktreePath(
        repoPath,
        parseWorktreeList(stdout, { nulDelimited: true }),
        options
      )
    },
    async () => {
      // Why: `-z` preserves worktree paths with newlines but Git <2.36 rejects it; fall back to the line parser.
      const { stdout } = await gitExecFileAsync(['worktree', 'list', '--porcelain'], execOptions)
      const normalized = await normalizeMainWorktreePath(
        repoPath,
        parseWorktreeList(stdout),
        options
      )
      // Why: Git <2.31 emits no `prunable`, so probe each linked path for existence instead of trusting
      // stale registrations; a harmless backstop on 2.31–2.35 where parseWorktreeList already set it (#8389).
      return annotatePrunableByExistence(normalized, repoPath, options)
    },
    isUnsupportedWorktreeListZError
  )
}

async function annotatePrunableByExistence(
  worktrees: GitWorktreeInfo[],
  repoPath: string,
  options: GitWorktreeExecOptions = {}
): Promise<GitWorktreeInfo[]> {
  const annotated = [...worktrees]
  let nextIndex = 0

  async function probeNext(): Promise<void> {
    while (nextIndex < worktrees.length) {
      const index = nextIndex
      nextIndex += 1
      const worktree = worktrees[index]
      // Git only prunes linked worktrees, never locked ones (a lock shields a missing dir; `locked`
      // parses only on Git >=2.31). A missing main worktree is handled by the repo-level ENOENT paths.
      if (
        !worktree ||
        worktree.isMainWorktree ||
        worktree.isBare ||
        worktree.locked ||
        worktree.prunable
      ) {
        continue
      }
      try {
        await stat(translateWorktreePath(worktree.path, repoPath, options))
      } catch (err) {
        if (getErrorCode(err) === 'ENOENT') {
          annotated[index] = { ...worktree, prunable: true }
        }
      }
    }
  }

  const workerCount = Math.min(PRUNABLE_EXISTENCE_PROBE_CONCURRENCY, worktrees.length)
  await Promise.all(Array.from({ length: workerCount }, () => probeNext()))
  return annotated
}

async function readTranslatedWorktreeGraph(
  repoPath: string,
  options: GitWorktreeExecOptions = {}
): Promise<GitWorktreeInfo[]> {
  return (await readWorktreeList(repoPath, options)).map((worktree) => {
    const translatedPath = translateWorktreePath(worktree.path, repoPath, options)
    return translatedPath === worktree.path ? worktree : { ...worktree, path: translatedPath }
  })
}

async function listWorktreeGraph(
  repoPath: string,
  options: GitWorktreeExecOptions = {}
): Promise<GitWorktreeInfo[]> {
  try {
    return await readTranslatedWorktreeGraph(repoPath, options)
  } catch (err) {
    if (getErrorCode(err) === 'ENOENT') {
      try {
        await stat(repoPath)
      } catch (statErr) {
        if (getErrorCode(statErr) === 'ENOENT') {
          console.warn(`[git/worktree] repo path missing; skipping worktree list: ${repoPath}`)
          return []
        }
      }
    }
    if (isNotGitRepositoryError(err)) {
      return []
    }
    console.warn(`[git/worktree] listWorktreeGraph failed for ${repoPath}:`, err)
    return []
  }
}

// Why: cold start triggers many concurrent `git worktree list` spawns per repo (expensive on Windows, #7225); share the in-flight promise to collapse duplicates.
const inFlightWorktreeScans = new Map<string, Promise<GitWorktreeInfo[]>>()

// Why: a listing after a mutation must not join a scan that predates it; bumping the generation on mutation retires older in-flight scans from sharing.
const worktreeScanGenerations = new Map<string, number>()

function hasInFlightWorktreeScanForRepo(repoPath: string): boolean {
  const keyPrefix = `${repoPath}\0`
  for (const key of inFlightWorktreeScans.keys()) {
    if (key.startsWith(keyPrefix)) {
      return true
    }
  }
  return false
}

function bumpWorktreeScanGeneration(repoPath: string): void {
  // Why: generations only prevent joining a pre-mutation scan; with no active scan, keeping the repo path just leaks completed mutation keys.
  if (!hasInFlightWorktreeScanForRepo(repoPath)) {
    return
  }
  worktreeScanGenerations.set(repoPath, (worktreeScanGenerations.get(repoPath) ?? 0) + 1)
}

function pruneWorktreeScanGeneration(repoPath: string): void {
  // Why: keep ordinary scan settlement O(1); only repos invalidated during an active scan need the cross-generation check.
  if (!worktreeScanGenerations.has(repoPath)) {
    return
  }
  if (!hasInFlightWorktreeScanForRepo(repoPath)) {
    worktreeScanGenerations.delete(repoPath)
  }
}

function _getWorktreeScanCacheSizesForTests(): { inFlight: number; generations: number } {
  return {
    inFlight: inFlightWorktreeScans.size,
    generations: worktreeScanGenerations.size
  }
}

function _resetWorktreeScanCacheForTests(): void {
  inFlightWorktreeScans.clear()
  worktreeScanGenerations.clear()
}

/**
 * List all worktrees for a git repo at the given path. Concurrent calls for
 * the same repo share one scan (unless the caller passes an AbortSignal,
 * which must only cancel its own scan).
 */
function listWorktrees(
  repoPath: string,
  options: GitWorktreeExecOptions = {}
): Promise<GitWorktreeInfo[]> {
  if (options.signal) {
    return listWorktreesUnshared(repoPath, options)
  }
  const generation = worktreeScanGenerations.get(repoPath) ?? 0
  const timeout = options.timeout ?? WORKTREE_LIST_TIMEOUT_MS
  // Why: callers with different deadlines cannot safely share which timeout wins the scan.
  const key = `${repoPath}\0${options.wslDistro ?? ''}\0${timeout}\0${generation}`
  const inFlight = inFlightWorktreeScans.get(key)
  if (inFlight) {
    return inFlight
  }
  const scan = listWorktreesUnshared(repoPath, options).finally(() => {
    if (inFlightWorktreeScans.get(key) === scan) {
      inFlightWorktreeScans.delete(key)
    }
    pruneWorktreeScanGeneration(repoPath)
  })
  inFlightWorktreeScans.set(key, scan)
  return scan
}

async function listWorktreesUnshared(
  repoPath: string,
  options: GitWorktreeExecOptions = {}
): Promise<GitWorktreeInfo[]> {
  try {
    const worktrees = await readTranslatedWorktreeGraph(repoPath, options)
    return annotateSparseCheckoutStatus(worktrees)
  } catch (err) {
    if (getErrorCode(err) === 'ENOENT') {
      try {
        await stat(repoPath)
      } catch (statErr) {
        if (getErrorCode(statErr) === 'ENOENT') {
          console.warn(`[git/worktree] repo path missing; skipping worktree list: ${repoPath}`)
          return []
        }
      }
    }
    if (isNotGitRepositoryError(err)) {
      return []
    }
    // Why: don't swallow git-compat/repo-state failures — else they resurface as opaque "created but not found in listing" errors.
    console.warn(`[git/worktree] listWorktrees failed for ${repoPath}:`, err)
    return []
  }
}

async function listWorktreesStrict(
  repoPath: string,
  options: GitWorktreeExecOptions = {}
): Promise<GitWorktreeInfo[]> {
  const worktrees = (await readWorktreeList(repoPath, options)).map((worktree) => {
    const translatedPath = translateWorktreePath(worktree.path, repoPath, options)
    return translatedPath === worktree.path ? worktree : { ...worktree, path: translatedPath }
  })
  return annotateSparseCheckoutStatus(worktrees)
}

async function annotateSparseCheckoutStatus(
  worktrees: GitWorktreeInfo[]
): Promise<GitWorktreeInfo[]> {
  const annotated = [...worktrees]
  let nextIndex = 0

  async function detectNext(): Promise<void> {
    while (nextIndex < worktrees.length) {
      const index = nextIndex
      nextIndex += 1
      const worktree = worktrees[index]
      if (!worktree || worktree.isBare || worktree.isSparse) {
        continue
      }
      const isSparse = await detectSparseCheckout(worktree.path)
      if (isSparse) {
        annotated[index] = { ...worktree, isSparse }
      }
    }
  }

  // Why: cap concurrency so status-poll refreshes don't fan out many sparse-checkout filesystem probes at once.
  const workerCount = Math.min(SPARSE_CHECKOUT_DETECTION_CONCURRENCY, worktrees.length)
  await Promise.all(Array.from({ length: workerCount }, () => detectNext()))
  return annotated
}

async function refreshLocalBaseRefForWorktreeCreate(
  repoPath: string,
  baseBranch: string,
  remoteTrackingRef: string,
  remoteTrackingBase?: AddWorktreeOptions['remoteTrackingBase'],
  options: GitWorktreeExecOptions = {}
): Promise<LocalBaseRefRefreshResult | undefined> {
  const evaluation = await evaluateLocalBaseRefRefreshability(
    repoPath,
    baseBranch,
    remoteTrackingRef,
    remoteTrackingBase,
    options
  )
  if (!evaluation) {
    return undefined
  }
  if (!evaluation.refreshable) {
    return evaluation.result
  }

  const resultBase = { baseRef: evaluation.baseRef, localBranch: evaluation.localBranch }
  try {
    if (evaluation.ownerWorktreePath) {
      const { stdout: worktreeListOutput } = await gitExecFileAsync(
        ['worktree', 'list', '--porcelain'],
        gitExecOptions(repoPath, options)
      )
      const worktrees = parseWorktreeList(
        translateWslOutputPaths(worktreeListOutput, repoPath, options)
      )
      const currentOwner = worktrees.find((wt) => wt.branch === evaluation.fullRef)
      if (!currentOwner || currentOwner.path !== evaluation.ownerWorktreePath) {
        return { ...resultBase, status: 'skipped_error' }
      }
      const { stdout: status } = await gitExecFileAsync(
        ['status', '--porcelain', '--untracked-files=no'],
        gitExecOptions(currentOwner.path, options)
      )
      if (status.trim()) {
        return {
          ...resultBase,
          status: 'skipped_dirty_worktree',
          ownerWorktreePath: currentOwner.path
        }
      }
      await gitExecFileAsync(
        ['reset', '--hard', evaluation.remoteOid],
        gitExecOptions(currentOwner.path, options)
      )
      return { ...resultBase, status: 'updated', ownerWorktreePath: currentOwner.path }
    }

    // Why: no owner worktree — fast-forward the bare ref; the expected-old-OID form is a no-op-safe CAS if the ref moved since evaluation.
    await gitExecFileAsync(
      ['update-ref', evaluation.fullRef, evaluation.remoteOid, evaluation.localOid],
      gitExecOptions(repoPath, options)
    )
    return { ...resultBase, status: 'updated' }
  } catch {
    // update-ref/reset can fail on locked refs or odd worktree states; worktree creation should still proceed.
    return { ...resultBase, status: 'skipped_error' }
  }
}

/**
 * Create a new worktree.
 * @param repoPath - Path to the main repo (or bare repo)
 * @param worktreePath - Absolute path where the worktree will be created
 * @param branch - Branch name for the new worktree
 * @param baseBranch - Optional base branch to create from (defaults to HEAD)
 * @remarks Side effects (best-effort, warn-only): passes `--no-track`, writes
 * `branch.<branch>.base` for new-branch worktrees with a base ref, and may
 * write `push.autoSetupRemote=true` to the repo's shared config.
 */

export { parseWorktreeList, splitLineWorktreeList, splitNulWorktreeList, readWorktreeList, annotatePrunableByExistence, readTranslatedWorktreeGraph, listWorktreeGraph, inFlightWorktreeScans, worktreeScanGenerations, hasInFlightWorktreeScanForRepo, bumpWorktreeScanGeneration, pruneWorktreeScanGeneration, _getWorktreeScanCacheSizesForTests, _resetWorktreeScanCacheForTests, listWorktrees, listWorktreesUnshared, listWorktreesStrict, annotateSparseCheckoutStatus, refreshLocalBaseRefForWorktreeCreate }
