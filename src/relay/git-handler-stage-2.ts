import { execFile, spawn, type ExecFileOptions } from 'node:child_process'
import { promisify } from 'node:util'
import * as path from 'node:path'
import type { RelayDispatcher, RequestContext } from './dispatcher'
import type { RelayContext } from './context'
import { expandTilde } from './context'
import {
  isUnsupportedWorktreeListZError,
  parseBranchDiff,
  parseWorktreeList
} from './git-handler-utils'
import { parseNumstat } from '../shared/git-uncommitted-line-stats'
import {
  computeDiff,
  branchCompare as branchCompareOp,
  branchDiffEntries,
  validateGitExecArgs,
  type GitExec
} from './git-handler-ops'
import {
  buildSubmoduleInnerCommitRangeDiff,
  computeSubmodulePointerDiff,
  computeSubmoduleRangeEntries,
  clearSubmodulePathsCache,
  createSubmodulePathsCache,
  findContainingSubmodule,
  listSubmodulePathsCached,
  resolveSubmoduleWorktreePath,
  resolveSubmoduleCommitRange,
  type SubmodulePathsCache
} from './git-handler-submodule-ops'
import { commitCompare as commitCompareOp, commitDiffEntry } from './git-handler-commit-diff-ops'
import {
  areRelayWorktreePathsEqual,
  commitChangesRelay,
  addWorktreeOp,
  removeWorktreeOp,
  worktreeIsCleanOp
} from './git-handler-worktree-ops'
import { annotatePrunableWorktreesByExistence } from './git-handler-worktree-list'
import { forceDeletePreservedRelayBranch } from './git-handler-branch-cleanup'
import { refreshLocalBaseRefForWorktreeCreateOp } from './git-handler-local-base-ref-refresh'
import { gitExecMutatesRepository } from '../shared/git-exec-mutation'
import { detectConflictOperation, getStatusOp } from './git-handler-status-ops'
import { capGitStatusEntries, resolveGitStatusLimit } from '../shared/git-status-limit'
import { checkIgnoredPathsOp } from './git-handler-check-ignore'
import { resolveRelayPushTarget } from './git-handler-push-target'
import {
  isExecKilledError,
  isNoUpstreamError,
  normalizeGitErrorMessage,
  runPullWithDivergenceFallback
} from '../shared/git-remote-error'
import { upstreamOnlyCommitsArePatchEquivalent } from '../shared/git-upstream-status'
import { assertGitPushTargetShape } from '../shared/git-push-target-validation'
import { getPublishTargetStatus, type GitCommandRunner } from '../shared/git-publish-target-status'
import { resolveGitRemoteRebaseSource } from '../shared/git-rebase-source'
import type { GitPushTarget } from '../shared/types'
import {
  getEffectiveGitUpstreamStatus,
  resolveEffectiveGitUpstream
} from '../shared/git-effective-upstream'
import { loadGitHistoryFromExecutor } from '../shared/git-history'
import { buildRelayGitEnv, buildRelayUnattendedGitEnv } from './relay-command-env'
import {
  removeSafeUntrackedDiscardTarget,
  removeSafeUntrackedDiscardTargets
} from '../shared/git-discard-path-safety'
import { getGitCloneFailureMessage } from '../shared/git-clone-failure-message'
import { syncForkDefaultBranch, validateGitForkSyncExpectedUpstream } from '../shared/git-fork-sync'
import { InFlightPromiseDedupe, stableInFlightKey } from '../shared/in-flight-promise-dedupe'
import { GIT_FETCH_SKIP_AUTO_MAINTENANCE_CONFIG_ARGS } from '../shared/git-fetch-auto-maintenance'
import { GitCapabilityCache } from '../shared/git-capability-cache'
import {
  githubPullRequestHeadLocalRef,
  gitlabMergeRequestHeadLocalRef,
  isSafeReviewHeadFetchRemote,
  isValidReviewHeadNumber,
  reviewHeadRemoteRefComponent,
  REVIEW_HEAD_FETCH_TIMEOUT_MS
} from '../shared/review-head-tracking-ref'
import type { RelayFilesystemWatchRegistry } from './relay-filesystem-watch-registry'
import {
  hasUnsupportedRevParsePathFormatEcho,
  isUnsupportedRevParsePathFormatError
} from '../shared/git-worktree-command-capabilities'
import { GitResponseStreamRegistry } from './git-response-stream'
import { GIT_RESPONSE_STREAM_THRESHOLD } from './protocol'
import { endSubprocessStdin } from '../shared/subprocess-stdin-write'
import { clearGitStatusLineStatsCache } from '../shared/git-status-line-stats-cache'
import { streamRelayGitStdout } from './git-stdout-stream'

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

import { GitHandlerStage1 } from './git-handler-stage-1'
export class GitHandlerStage2 extends GitHandlerStage1 {
  protected async localBranches(params: Record<string, unknown>) {
    const worktreePath = params.worktreePath as string
    const { stdout } = await this.git(
      ['for-each-ref', '--format=%(HEAD)%09%(refname:short)', 'refs/heads/'],
      worktreePath
    )
    let current: string | null = null
    const branches: string[] = []
    for (const line of stdout.split('\n')) {
      if (line.length === 0) {
        continue
      }
      const [marker, name] = line.split('\t')
      if (!name) {
        continue
      }
      if (marker === '*') {
        current = name
      }
      branches.push(name)
    }
    branches.sort((a, b) => (a === current ? -1 : b === current ? 1 : 0))
    return { current, branches }
  }

  protected normalizeGitPathForCompare(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/\/+$/, '')
  }

  protected isTrackedPathSpec(filePath: string, trackedPaths: readonly string[]): boolean {
    const normalized = this.normalizeGitPathForCompare(filePath)
    return trackedPaths.some((trackedPath) => {
      const normalizedTracked = this.normalizeGitPathForCompare(trackedPath)
      return normalizedTracked === normalized || normalizedTracked.startsWith(`${normalized}/`)
    })
  }

  protected assertInWorktree(worktreePath: string, filePath: string): string {
    const resolved = path.resolve(worktreePath, filePath)
    const rel = path.relative(path.resolve(worktreePath), resolved)
    // Why: empty rel or '.' means the path IS the worktree root; reject (with parent-escaping paths) so a discard can't wipe the whole worktree.
    if (
      !rel ||
      rel === '.' ||
      rel === '..' ||
      rel.startsWith(`..${path.sep}`) ||
      path.isAbsolute(rel)
    ) {
      throw new Error(`Path "${filePath}" resolves outside the worktree`)
    }
    return resolved
  }

  protected async discard(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const filePath = params.filePath as string
    try {
      this.assertInWorktree(worktreePath, filePath)

      let tracked = false
      try {
        await this.git(
          ['ls-files', '--error-unmatch', '--', this.literalPathspec(filePath)],
          worktreePath
        )
        tracked = true
      } catch {
        // untracked
      }

      if (tracked) {
        await this.git(
          ['restore', '--worktree', '--source=HEAD', '--', this.literalPathspec(filePath)],
          worktreePath
        )
        return
      }

      await removeSafeUntrackedDiscardTarget(worktreePath, filePath, (targetPath) =>
        this.cleanUntrackedPaths(worktreePath, [targetPath])
      )
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async bulkDiscard(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const filePaths = params.filePaths as string[]
    if (filePaths.length === 0) {
      return
    }
    try {
      for (const filePath of filePaths) {
        this.assertInWorktree(worktreePath, filePath)
      }

      const trackedPathSpecs: string[] = []
      for (let i = 0; i < filePaths.length; i += BULK_CHUNK_SIZE) {
        const chunk = filePaths.slice(i, i + BULK_CHUNK_SIZE)
        const { stdout } = await this.git(
          ['ls-files', '-z', '--', ...chunk.map((p) => this.literalPathspec(p))],
          worktreePath
        )
        // Why: a selected tracked directory can make `ls-files -z` return enough descendants for push(...split) to exceed the argument limit.
        for (const trackedPathSpec of stdout.split('\0')) {
          if (trackedPathSpec) {
            trackedPathSpecs.push(trackedPathSpec)
          }
        }
      }

      const trackedPaths = filePaths.filter((filePath) =>
        this.isTrackedPathSpec(filePath, trackedPathSpecs)
      )
      const untrackedPaths = filePaths.filter(
        (filePath) => !this.isTrackedPathSpec(filePath, trackedPathSpecs)
      )
      await removeSafeUntrackedDiscardTargets(
        worktreePath,
        untrackedPaths,
        (targetPaths) => this.cleanUntrackedPaths(worktreePath, targetPaths),
        async () => {
          for (let i = 0; i < trackedPaths.length; i += BULK_CHUNK_SIZE) {
            const chunk = trackedPaths.slice(i, i + BULK_CHUNK_SIZE)
            await this.git(
              [
                'restore',
                '--worktree',
                '--source=HEAD',
                '--',
                ...chunk.map((p) => this.literalPathspec(p))
              ],
              worktreePath
            )
          }
        }
      )
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected literalPathspec(filePath: string): string {
    // Why: source-control selections are concrete paths, not user-authored Git globs.
    return `:(literal)${filePath}`
  }

  protected async cleanUntrackedPaths(worktreePath: string, filePaths: readonly string[]) {
    for (let i = 0; i < filePaths.length; i += BULK_CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + BULK_CHUNK_SIZE)
      if (chunk.length > 0) {
        // Why: Git pathspec cleanup avoids raw recursive deletion through symlinked parents.
        await this.git(
          ['clean', '-ffdx', '--', ...chunk.map((p) => this.literalPathspec(p))],
          worktreePath
        )
      }
    }
  }

  protected async conflictOperation(params: Record<string, unknown>) {
    const worktreePath = params.worktreePath as string
    return detectConflictOperation(worktreePath)
  }

  protected async branchCompare(params: Record<string, unknown>) {
    const worktreePath = params.worktreePath as string
    const baseRef = params.baseRef as string
    // Why: a baseRef starting with '-' would be read as a git rev-parse flag, potentially leaking environment variables or config.
    if (baseRef.startsWith('-')) {
      throw new Error('Base ref must not start with "-"')
    }
    const gitBound = this.git.bind(this)
    return branchCompareOp(gitBound, worktreePath, baseRef, async (mergeBase, headOid) => {
      // Why: -c core.quotePath=false keeps non-ASCII filenames as raw UTF-8; without it parseBranchDiff would get C-style octal-escaped paths.
      const [{ stdout }, { stdout: numstat }] = await Promise.all([
        gitBound(
          ['-c', 'core.quotePath=false', 'diff', '--name-status', '-M', '-C', mergeBase, headOid],
          worktreePath
        ),
        gitBound(
          ['-c', 'core.quotePath=false', 'diff', '--numstat', '-M', '-C', mergeBase, headOid],
          worktreePath
        )
      ])
      return parseBranchDiff(stdout, parseNumstat(numstat))
    })
  }

  protected async commitCompare(params: Record<string, unknown>) {
    const worktreePath = params.worktreePath as string
    const commitId = params.commitId as string
    return commitCompareOp(this.git.bind(this), worktreePath, commitId)
  }

  protected async upstreamStatus(params: Record<string, unknown>) {
    const worktreePath = params.worktreePath as string

    try {
      if (params.pushTarget !== undefined) {
        assertGitPushTargetShape(params.pushTarget)
        const pushTarget = params.pushTarget as GitPushTarget
        await this.git(['check-ref-format', '--branch', pushTarget.branchName], worktreePath)
        return await getPublishTargetStatus(
          ((args) => this.git(args, worktreePath)) as GitCommandRunner,
          pushTarget,
          (upstreamName) => this.getBehindCommitsArePatchEquivalent(worktreePath, upstreamName)
        )
      }
      return await getEffectiveGitUpstreamStatus(
        (args) => this.git(args, worktreePath),
        (upstreamName) => this.getBehindCommitsArePatchEquivalent(worktreePath, upstreamName)
      )
    } catch (error) {
      // Why: swallow only 'no upstream configured' (an expected state); other errors (auth, corruption, network) must surface to the user.
      if (isNoUpstreamError(error)) {
        return { hasUpstream: false, ahead: 0, behind: 0 }
      }
      // Why: match fetch/push/pull normalization so execFile preamble and local paths don't leak to the renderer.
      throw new Error(normalizeGitErrorMessage(error, 'upstream'))
    }
  }

  protected async getBehindCommitsArePatchEquivalent(
    worktreePath: string,
    upstreamName: string
  ): Promise<boolean> {
    try {
      const { stdout } = await this.git(
        ['log', '--oneline', '--cherry-mark', '--right-only', `HEAD...${upstreamName}`, '--'],
        worktreePath
      )
      return upstreamOnlyCommitsArePatchEquivalent(stdout)
    } catch {
      // Why: this only identifies stale post-rebase upstreams; if the probe fails over SSH, keep the conservative pull-first sync path.
      return false
    }
  }

  protected async fetch(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    try {
      try {
        if (params.pushTarget !== undefined) {
          assertGitPushTargetShape(params.pushTarget)
          const pushTarget = params.pushTarget as GitPushTarget
          await this.git(['check-ref-format', '--branch', pushTarget.branchName], worktreePath)
          await this.git(['fetch', '--prune', pushTarget.remoteName], worktreePath)
          return
        }
        await this.git(['fetch', '--prune'], worktreePath)
      } catch (error) {
        // Why: normalize like local gitFetch so SSH users get actionable messages, not raw stderr (may embed credentials).
        throw new Error(normalizeGitErrorMessage(error, 'fetch'))
      }
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async forkSync(params: Record<string, unknown>, context?: RequestContext) {
    return this.runWithGitReadCacheClear(async () => {
      const worktreePath = params.worktreePath as string
      const expectedUpstream = validateGitForkSyncExpectedUpstream(params.expectedUpstream, {
        required: true
      })
      const controller = new AbortController()
      const abortFromContext = () => controller.abort()
      if (context?.signal?.aborted) {
        controller.abort()
      } else {
        context?.signal?.addEventListener('abort', abortFromContext, { once: true })
      }
      const timeout = setTimeout(() => controller.abort(), 60_000)
      try {
        return await syncForkDefaultBranch(
          (args) =>
            this.git(args, worktreePath, {
              nonInteractive: true,
              signal: controller.signal
            }),
          { expectedUpstream }
        )
      } catch (error) {
        throw new Error(normalizeGitErrorMessage(error, 'push'))
      } finally {
        clearTimeout(timeout)
        context?.signal?.removeEventListener('abort', abortFromContext)
      }
    })
  }

  protected async fetchRemoteTrackingRef(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const remote = params.remote
    const branch = params.branch
    const ref = params.ref
    const skipAutoMaintenance = params.skipAutoMaintenance
    try {
      if (typeof remote !== 'string' || typeof branch !== 'string' || typeof ref !== 'string') {
        throw new Error('Invalid remote-tracking fetch request.')
      }
      if (skipAutoMaintenance !== undefined && typeof skipAutoMaintenance !== 'boolean') {
        throw new Error('Invalid remote-tracking fetch maintenance option.')
      }
      if (remote.startsWith('-') || branch.startsWith('-')) {
        throw new Error('Remote-tracking fetch inputs must not start with "-".')
      }
      if (ref !== `refs/remotes/${remote}/${branch}`) {
        throw new Error('Remote-tracking ref does not match the requested remote and branch.')
      }

      try {
        const { stdout } = await this.git(['remote'], worktreePath)
        const remotes = stdout
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
        if (!remotes.includes(remote)) {
          throw new Error(`Remote "${remote}" is not configured.`)
        }
        await this.git(['check-ref-format', `refs/heads/${branch}`], worktreePath)
        await this.git(['check-ref-format', ref], worktreePath)
        await this.git(
          [
            ...(skipAutoMaintenance ? GIT_FETCH_SKIP_AUTO_MAINTENANCE_CONFIG_ARGS : []),
            'fetch',
            '--no-tags',
            remote,
            `+refs/heads/${branch}:${ref}`
          ],
          worktreePath
        )
      } catch (error) {
        // Why: create-worktree needs a write-capable fetch that generic git.exec rejects; narrow RPC keeps the allowlist tight.
        throw new Error(normalizeGitErrorMessage(error, 'fetch'))
      }
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  // Why: the durable review-head ref embeds the remote's identity, and a
  // missing remote must fail with an actionable message, not a raw fetch error.
  protected async reviewHeadRemoteComponent(worktreePath: string, remote: string): Promise<string> {
    let remoteUrl: string
    try {
      const { stdout } = await this.git(['remote', 'get-url', remote], worktreePath)
      remoteUrl = stdout.trim()
    } catch {
      remoteUrl = ''
    }
    if (!remoteUrl) {
      throw new Error(`Remote "${remote}" is not configured.`)
    }
    return reviewHeadRemoteRefComponent(remote, remoteUrl)
  }

  protected async fetchGitLabMergeRequestHead(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const remote = params.remote
    const mrIid = params.mrIid
    try {
      if (typeof remote !== 'string' || !isValidReviewHeadNumber(mrIid)) {
        throw new Error('Invalid GitLab merge request fetch request.')
      }
      const mergeRequestIid = mrIid
      if (!isSafeReviewHeadFetchRemote(remote)) {
        throw new Error('GitLab merge request fetch remote must not start with "-".')
      }

      try {
        const remoteComponent = await this.reviewHeadRemoteComponent(worktreePath, remote)
        // Why: GitLab fork heads need a dedicated write RPC and ref outside refs/heads/*.
        // Return the exact written path so the client does not re-hash a second get-url.
        const localRef = gitlabMergeRequestHeadLocalRef(remoteComponent, mergeRequestIid)
        await this.git(
          [
            'fetch',
            '--no-tags',
            remote,
            `+refs/merge-requests/${mergeRequestIid}/head:${localRef}`
          ],
          worktreePath,
          { timeout: REVIEW_HEAD_FETCH_TIMEOUT_MS }
        )
        return { localRef }
      } catch (error) {
        // Why: a timeout kill has no git stderr; name it so the client can classify it as transient.
        if (isExecKilledError(error)) {
          throw new Error(
            `Fetching refs/merge-requests/${mergeRequestIid}/head from "${remote}" timed out.`
          )
        }
        throw new Error(normalizeGitErrorMessage(error, 'fetch'))
      }
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

}
