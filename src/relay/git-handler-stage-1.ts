import { execFile, type ExecFileOptions } from 'node:child_process'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { loadGitHistoryFromExecutor } from '../shared/git-history'
import { capGitStatusEntries, resolveGitStatusLimit } from '../shared/git-status-limit'
import { clearGitStatusLineStatsCache } from '../shared/git-status-line-stats-cache'
import { stableInFlightKey } from '../shared/in-flight-promise-dedupe'
import { endSubprocessStdin } from '../shared/subprocess-stdin-write'
import { expandTilde } from './context'
import type { RequestContext } from './dispatcher'
import { checkIgnoredPathsOp } from './git-handler-check-ignore'
import { computeDiff, type GitExec } from './git-handler-ops'
import { getStatusOp } from './git-handler-status-ops'
import {
  buildSubmoduleInnerCommitRangeDiff,
  clearSubmodulePathsCache,
  computeSubmodulePointerDiff,
  computeSubmoduleRangeEntries,
  findContainingSubmodule,
  listSubmodulePathsCached,
  resolveSubmoduleCommitRange,
  resolveSubmoduleWorktreePath
} from './git-handler-submodule-ops'
import { commitChangesRelay } from './git-handler-worktree-ops'
import { streamRelayGitStdout } from './git-stdout-stream'
import { GIT_RESPONSE_STREAM_THRESHOLD } from './protocol'
import { buildRelayGitEnv, buildRelayUnattendedGitEnv } from './relay-command-env'

const execFileAsync = promisify(execFile)
const MAX_GIT_BUFFER = 10 * 1024 * 1024
const BULK_CHUNK_SIZE = 100

function resolveSubmoduleStatusArea(
  params: Record<string, unknown>
): 'staged' | 'unstaged' | 'untracked' {
  if (params.area === 'staged' || params.area === 'unstaged' || params.area === 'untracked') {
    return params.area
  }
  return 'unstaged'
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')
}

function resolveRelayPath(repoPath: string, value: string): string {
  if (path.posix.isAbsolute(value) || path.win32.isAbsolute(value)) {
    return value
  }
  // Old git ignores `--path-format=absolute`; resolve relative toplevel/git-dir against repoPath, picking the win32/posix resolver by its shape.
  return isWindowsAbsolutePath(repoPath)
    ? path.win32.resolve(repoPath, value)
    : path.posix.resolve(repoPath, value)
}

type RelayRepoLocation = { topLevel: string; commonDir: string }

function parseRelayRepoLocation(repoPath: string, output: string): RelayRepoLocation | undefined {
  // Old git (pre `--path-format`) echoes the unknown flag and exits 0; drop `-`-prefixed lines, take the last two paths.
  // Strip only the trailing CR, not surrounding spaces — git paths may legitimately start or end with a space.
  const lines = output
    .split('\n')
    .map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line))
    .filter((line) => line.length > 0 && !line.startsWith('-'))
  if (lines.length < 2) {
    return undefined
  }
  const [topLevel, commonDir] = lines.slice(-2)
  return {
    topLevel: resolveRelayPath(repoPath, topLevel),
    commonDir: resolveRelayPath(repoPath, commonDir)
  }
}

function execFileWithStdin(
  command: string,
  args: string[],
  options: ExecFileOptions,
  stdin: string
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (
      error: Error | null,
      stdout: string | Buffer = '',
      stderr: string | Buffer = ''
    ): void => {
      if (settled) {
        return
      }
      settled = true
      if (error) {
        reject(Object.assign(error, { stdout, stderr }))
        return
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    }
    const child = execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        finish(error, stdout, stderr)
        return
      }
      finish(null, stdout, stderr)
    })
    child.once('error', (error) => finish(error))
    endSubprocessStdin(child.stdin, stdin)
  })
}

import { GitHandler } from './git-handler-stage-state'
export abstract class GitHandlerStage1 extends GitHandler {
  dispose(): void {
    this.responseStreams.disposeAll()
    this.clearGitMutationReadCaches()
  }

  protected registerHandlers(): void {
    this.dispatcher.onRequest('git.status', (p, context) => this.getStatus(p, context))
    this.dispatcher.onRequest('git.submoduleStatus', (p, context) =>
      this.getSubmoduleStatus(p, context)
    )
    this.dispatcher.onRequest('git.checkIgnored', (p) => this.checkIgnored(p))
    this.dispatcher.onRequest('git.history', (p) => this.history(p))
    this.dispatcher.onRequest('git.commit', (p) => this.commit(p))
    this.dispatcher.onRequest('git.diff', (p, context) => this.getDiff(p, context))
    this.dispatcher.onRequest('git.stage', (p) => this.stage(p))
    this.dispatcher.onRequest('git.unstage', (p) => this.unstage(p))
    this.dispatcher.onRequest('git.bulkStage', (p) => this.bulkStage(p))
    this.dispatcher.onRequest('git.bulkUnstage', (p) => this.bulkUnstage(p))
    this.dispatcher.onRequest('git.abortMerge', (p) => this.abortMerge(p))
    this.dispatcher.onRequest('git.abortRebase', (p) => this.abortRebase(p))
    this.dispatcher.onRequest('git.checkout', (p) => this.checkout(p))
    this.dispatcher.onRequest('git.localBranches', (p) => this.localBranches(p))
    this.dispatcher.onRequest('git.discard', (p) => this.discard(p))
    this.dispatcher.onRequest('git.bulkDiscard', (p) => this.bulkDiscard(p))
    this.dispatcher.onRequest('git.conflictOperation', (p) => this.conflictOperation(p))
    this.dispatcher.onRequest('git.branchCompare', (p) => this.branchCompare(p))
    this.dispatcher.onRequest('git.commitCompare', (p) => this.commitCompare(p))
    this.dispatcher.onRequest('git.upstreamStatus', (p) => this.upstreamStatus(p))
    this.dispatcher.onRequest('git.fetch', (p) => this.fetch(p))
    this.dispatcher.onRequest('git.forkSync', (p, context) => this.forkSync(p, context))
    this.dispatcher.onRequest('git.fetchRemoteTrackingRef', (p) => this.fetchRemoteTrackingRef(p))
    this.dispatcher.onRequest('git.fetchGitHubPullRequestHead', (p) =>
      this.fetchGitHubPullRequestHead(p)
    )
    this.dispatcher.onRequest('git.fetchGitLabMergeRequestHead', (p) =>
      this.fetchGitLabMergeRequestHead(p)
    )
    // Why: the durable-ref variant is a distinct method name so an old relay
    // (which only knows FETCH_HEAD-semantics git.fetchGitLabMergeRequestHead)
    // returns -32601 and the client can prompt a reconnect instead of silently
    // resolving a stale/missing ref. Both names share the durable handler: a
    // refspec fetch still writes FETCH_HEAD, so old clients keep their semantics.
    this.dispatcher.onRequest('git.fetchGitLabMergeRequestHeadRef', (p) =>
      this.fetchGitLabMergeRequestHead(p)
    )
    this.dispatcher.onRequest('git.push', (p) => this.push(p))
    this.dispatcher.onRequest('git.pull', (p) => this.pull(p))
    this.dispatcher.onRequest('git.fastForward', (p) => this.fastForward(p))
    this.dispatcher.onRequest('git.rebaseFromBase', (p) => this.rebaseFromBase(p))
    this.dispatcher.onRequest('git.branchDiff', (p, context) => this.branchDiff(p, context))
    this.dispatcher.onRequest('git.commitDiff', (p, context) => this.commitDiff(p, context))
    this.dispatcher.onRequest('git.listWorktrees', (p, context) => this.listWorktrees(p, context))
    this.dispatcher.onRequest('git.addWorktree', (p) => this.addWorktree(p))
    this.dispatcher.onRequest('git.removeWorktree', (p) => this.removeWorktree(p))
    this.dispatcher.onRequest('git.worktreeIsClean', (p) => this.worktreeIsClean(p))
    this.dispatcher.onRequest('git.refreshLocalBaseRefForWorktreeCreate', (p) =>
      this.refreshLocalBaseRefForWorktreeCreate(p)
    )
    this.dispatcher.onRequest('git.renameCurrentBranch', (p) => this.renameCurrentBranch(p))
    this.dispatcher.onRequest('git.forceDeletePreservedBranch', (p) =>
      this.forceDeletePreservedBranch(p)
    )
    this.dispatcher.onRequest('git.exec', (p, context) => this.exec(p, context))
    this.dispatcher.onRequest('git.clone', (p, context) => this.clone(p, context))
    this.dispatcher.onRequest('git.isGitRepo', (p) => this.isGitRepo(p))
    this.dispatcher.onNotification('git.responseAck', (p, context) => this.responseAck(p, context))
    this.dispatcher.onNotification('git.cancelResponseStream', (p, context) =>
      this.cancelResponseStream(p, context)
    )
  }

  protected responseAck(params: Record<string, unknown>, context: RequestContext): void {
    const streamId = params.streamId
    const seq = params.seq
    if (typeof streamId === 'number' && typeof seq === 'number') {
      this.responseStreams.recordAck(streamId, seq, context.clientId)
    }
  }

  protected cancelResponseStream(params: Record<string, unknown>, context: RequestContext): void {
    const streamId = params.streamId
    if (typeof streamId === 'number') {
      this.responseStreams.abort(streamId, context.clientId)
    }
  }

  // Why: opt-in streaming — old clients/relays omit the flag and fall back to the plain result.
  protected maybeStreamResponse(
    result: unknown,
    params: Record<string, unknown>,
    context: RequestContext | undefined
  ): unknown {
    if (params.__streamResponse !== true || !context) {
      return result
    }
    const payload = Buffer.from(JSON.stringify(result ?? null), 'utf-8')
    if (payload.length <= GIT_RESPONSE_STREAM_THRESHOLD) {
      return result
    }
    return this.responseStreams.startStream(payload, this.dispatcher, context)
  }

  protected clearGitMutationReadCaches(): void {
    this.gitDiffReadDedupe.clear()
    clearGitStatusLineStatsCache()
    clearSubmodulePathsCache(this.submodulePathsCache)
  }

  protected async runWithGitReadCacheClear<T>(run: () => Promise<T>): Promise<T> {
    // Why: git mutations can stale in-flight diff/.gitmodules reads; clear before and after so later reads cannot join them.
    this.clearGitMutationReadCaches()
    try {
      return await run()
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async git(
    args: string[],
    cwd: string,
    opts?: {
      maxBuffer?: number
      disableOptionalLocks?: boolean
      signal?: AbortSignal
      nonInteractive?: boolean
      stdin?: string
      timeout?: number
    }
  ): Promise<{ stdout: string; stderr: string }> {
    const env = opts?.nonInteractive ? buildRelayUnattendedGitEnv() : buildRelayGitEnv()
    if (opts?.disableOptionalLocks) {
      env.GIT_OPTIONAL_LOCKS = '0'
    }
    const execOptions = {
      cwd: expandTilde(cwd),
      env,
      encoding: 'utf-8',
      maxBuffer: opts?.maxBuffer ?? MAX_GIT_BUFFER,
      timeout: opts?.timeout,
      signal: opts?.signal
    } satisfies ExecFileOptions
    if (opts?.stdin !== undefined) {
      return execFileWithStdin('git', args, execOptions, opts.stdin)
    }
    const { stdout, stderr } = await execFileAsync('git', args, execOptions)
    return { stdout: String(stdout), stderr: String(stderr) }
  }

  protected async gitBuffer(args: string[], cwd: string): Promise<Buffer> {
    const { stdout } = (await execFileAsync('git', args, {
      cwd,
      env: buildRelayGitEnv(),
      encoding: 'buffer',
      maxBuffer: MAX_GIT_BUFFER
    })) as { stdout: Buffer }
    return stdout
  }

  protected async getStatus(params: Record<string, unknown>, context: RequestContext) {
    this.gitDiffReadDedupe.clear()
    return getStatusOp(this.git.bind(this), streamRelayGitStdout, params, {
      signal: context.signal
    })
  }

  // Why: parent status lists one gitlink row per submodule; fetch inner per-file changes by running status inside the submodule's own worktree.
  protected async getSubmoduleStatus(params: Record<string, unknown>, context: RequestContext) {
    const worktreePath = params.worktreePath as string
    const submodulePath = params.submodulePath as string
    const area = resolveSubmoduleStatusArea(params)
    const staged = area === 'staged'
    const resolved = resolveSubmoduleWorktreePath(worktreePath, submodulePath)
    const limit = resolveGitStatusLimit(params.limit)
    // Why: staged expansion only represents HEAD→index; scanning the submodule worktree is wasted work.
    const workingResult = staged
      ? { entries: [], conflictOperation: 'unknown' }
      : await getStatusOp(
          this.git.bind(this),
          streamRelayGitStdout,
          {
            ...params,
            worktreePath: resolved
          },
          { signal: context.signal }
        )
    // Why: pointer/range probes are part of the same SSH request and must not outlive its cancellation.
    const requestGit: GitExec = (args, cwd, options) =>
      this.git(args, cwd, { ...options, signal: context.signal })
    // Why: a moved gitlink (clean worktree) has no uncommitted rows; surface files changed between recorded and checked-out commits so it isn't empty.
    const { fromOid, toOid } = await resolveSubmoduleCommitRange(
      requestGit,
      worktreePath,
      submodulePath,
      staged
    )
    if (fromOid && toOid && fromOid !== toOid) {
      const rangeEntries = await computeSubmoduleRangeEntries(requestGit, resolved, fromOid, toOid)
      if (staged) {
        return { ...workingResult, ...capGitStatusEntries(rangeEntries, limit) }
      }
      const rangePaths = new Set(rangeEntries.map((entry) => entry.path))
      const entries = [
        ...rangeEntries,
        ...workingResult.entries.filter((entry) => !rangePaths.has(entry.path))
      ]
      return {
        ...workingResult,
        ...capGitStatusEntries(entries, limit, workingResult)
      }
    }
    if (staged) {
      return { ...workingResult, entries: [] }
    }
    return workingResult
  }

  protected async checkIgnored(params: Record<string, unknown>) {
    return checkIgnoredPathsOp(this.git.bind(this), params)
  }

  protected async history(params: Record<string, unknown>) {
    const worktreePath = params.worktreePath as string
    return loadGitHistoryFromExecutor(this.git.bind(this), worktreePath, {
      limit: typeof params.limit === 'number' ? params.limit : undefined,
      baseRef: typeof params.baseRef === 'string' ? params.baseRef : null
    })
  }

  protected async getDiff(params: Record<string, unknown>, context?: RequestContext) {
    const worktreePath = params.worktreePath as string
    const filePath = params.filePath as string
    // Why: filePath is relative and joined for readWorkingFile; validate or `../../etc/passwd` traverses outside the worktree.
    const resolved = path.resolve(worktreePath, filePath)
    const rel = path.relative(path.resolve(worktreePath), resolved)
    if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(`Path "${filePath}" resolves outside the worktree`)
    }
    const staged = params.staged as boolean
    const compareAgainstHead = params.compareAgainstHead as boolean | undefined
    // Why: register the in-flight dedupe synchronously (before any await) so concurrent identical reads coalesce; submodule routing happens inside.
    const result = await this.gitDiffReadDedupe.run(
      stableInFlightKey(['diff', worktreePath, filePath, staged, compareAgainstHead]),
      async () => {
        // Why: gitlinks can't be read as blobs, so route the gitlink root to a pointer diff and inner files into the submodule's own worktree.
        const submodulePaths = await listSubmodulePathsCached(
          this.git.bind(this),
          worktreePath,
          this.submodulePathsCache
        )
        if (submodulePaths.length > 0) {
          const matchedSubmodule = findContainingSubmodule(submodulePaths, filePath)
          if (matchedSubmodule) {
            const normalizedFilePath = filePath.replace(/\\/g, '/').replace(/\/+$/, '')
            if (normalizedFilePath === matchedSubmodule) {
              return computeSubmodulePointerDiff(
                this.git.bind(this),
                worktreePath,
                matchedSubmodule,
                staged,
                compareAgainstHead
              )
            }
            const submoduleWorktreePath = resolveSubmoduleWorktreePath(
              worktreePath,
              matchedSubmodule
            )
            const innerPath = normalizedFilePath.slice(matchedSubmodule.length + 1)
            const { fromOid, toOid } = await resolveSubmoduleCommitRange(
              this.git.bind(this),
              worktreePath,
              matchedSubmodule,
              staged
            )
            // Why: a moved gitlink (clean worktree) keeps inner changes in committed history, so diff the two commits; otherwise read the working-tree blob.
            if (fromOid && toOid && fromOid !== toOid) {
              return buildSubmoduleInnerCommitRangeDiff(
                this.gitBuffer.bind(this),
                submoduleWorktreePath,
                innerPath,
                fromOid,
                toOid
              )
            }
            return computeDiff(
              this.gitBuffer.bind(this),
              submoduleWorktreePath,
              innerPath,
              staged,
              compareAgainstHead
            )
          }
        }
        return computeDiff(
          this.gitBuffer.bind(this),
          worktreePath,
          filePath,
          staged,
          compareAgainstHead
        )
      }
    )
    return this.maybeStreamResponse(result, params, context)
  }

  protected async stage(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const filePath = params.filePath as string
    try {
      await this.git(['add', '--', this.literalPathspec(filePath)], worktreePath)
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async commit(
    params: Record<string, unknown>
  ): Promise<{ success: boolean; error?: string }> {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const message = params.message as string
    try {
      return await commitChangesRelay(this.git.bind(this), worktreePath, message)
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async unstage(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const filePath = params.filePath as string
    try {
      await this.git(['restore', '--staged', '--', this.literalPathspec(filePath)], worktreePath)
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async bulkStage(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const filePaths = params.filePaths as string[]
    try {
      for (let i = 0; i < filePaths.length; i += BULK_CHUNK_SIZE) {
        const chunk = filePaths.slice(i, i + BULK_CHUNK_SIZE)
        await this.git(
          ['add', '--', ...chunk.map((filePath) => this.literalPathspec(filePath))],
          worktreePath
        )
      }
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async bulkUnstage(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const filePaths = params.filePaths as string[]
    try {
      for (let i = 0; i < filePaths.length; i += BULK_CHUNK_SIZE) {
        const chunk = filePaths.slice(i, i + BULK_CHUNK_SIZE)
        await this.git(
          ['restore', '--staged', '--', ...chunk.map((filePath) => this.literalPathspec(filePath))],
          worktreePath
        )
      }
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async abortMerge(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    try {
      await this.git(['merge', '--abort'], worktreePath)
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async abortRebase(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    try {
      await this.git(['rebase', '--abort'], worktreePath)
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async checkout(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const branch = params.branch as string
    // Defense-in-depth: reject `-`-prefixed branch tokens to block flag injection (this relay entrypoint is reachable independently of the RPC schema).
    if (typeof branch !== 'string' || branch.length === 0 || branch.startsWith('-')) {
      throw new Error('invalid_branch_name')
    }
    try {
      await this.git(['checkout', branch, '--'], worktreePath)
      return { ok: true as const, branch }
    } finally {
      this.clearGitMutationReadCaches()
    }
  }
}
