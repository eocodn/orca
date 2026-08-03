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

import { GitHandlerStage3 } from './git-handler-stage-3'
export class GitHandler extends GitHandlerStage3 {
  protected async addWorktree(params: Record<string, unknown>) {
    return this.runWithGitReadCacheClear(() => addWorktreeOp(this.git.bind(this), params))
  }

  protected async removeWorktree(params: Record<string, unknown>) {
    const remove = () =>
      this.runWithGitReadCacheClear(() =>
        removeWorktreeOp(this.git.bind(this), params, this.gitCapabilities)
      )
    const worktreePath = params.worktreePath
    return this.watcherRegistry && typeof worktreePath === 'string'
      ? this.watcherRegistry.runWithRemovalFence(expandTilde(worktreePath), remove)
      : remove()
  }

  protected async worktreeIsClean(params: Record<string, unknown>) {
    return worktreeIsCleanOp(this.git.bind(this), params)
  }

  protected async refreshLocalBaseRefForWorktreeCreate(params: Record<string, unknown>) {
    return this.runWithGitReadCacheClear(() =>
      refreshLocalBaseRefForWorktreeCreateOp(this.git.bind(this), params, this.gitCapabilities)
    )
  }
}
