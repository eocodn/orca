import { execFile,spawn,type ExecFileOptions } from 'node:child_process'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { getGitCloneFailureMessage } from '../shared/git-clone-failure-message'
import { resolveEffectiveGitUpstream } from '../shared/git-effective-upstream'
import { gitExecMutatesRepository } from '../shared/git-exec-mutation'
import type { GitCommandRunner } from '../shared/git-publish-target-status'
import { assertGitPushTargetShape } from '../shared/git-push-target-validation'
import { resolveGitRemoteRebaseSource } from '../shared/git-rebase-source'
import {
  isExecKilledError,
  normalizeGitErrorMessage,
  runPullWithDivergenceFallback
} from '../shared/git-remote-error'
import {
  hasUnsupportedRevParsePathFormatEcho,
  isUnsupportedRevParsePathFormatError
} from '../shared/git-worktree-command-capabilities'
import { stableInFlightKey } from '../shared/in-flight-promise-dedupe'
import {
  githubPullRequestHeadLocalRef,
  isSafeReviewHeadFetchRemote,
  isValidReviewHeadNumber,
  REVIEW_HEAD_FETCH_TIMEOUT_MS
} from '../shared/review-head-tracking-ref'
import { endSubprocessStdin } from '../shared/subprocess-stdin-write'
import type { GitPushTarget } from '../shared/types'
import { expandTilde } from './context'
import type { RequestContext } from './dispatcher'
import { forceDeletePreservedRelayBranch } from './git-handler-branch-cleanup'
import { commitDiffEntry } from './git-handler-commit-diff-ops'
import {
  branchDiffEntries,
  validateGitExecArgs
} from './git-handler-ops'
import { resolveRelayPushTarget } from './git-handler-push-target'
import {
  isUnsupportedWorktreeListZError,
  parseWorktreeList
} from './git-handler-utils'
import { annotatePrunableWorktreesByExistence } from './git-handler-worktree-list'
import { areRelayWorktreePathsEqual } from './git-handler-worktree-ops'
import { buildRelayUnattendedGitEnv } from './relay-command-env'

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

import { GitHandlerStage2 } from './git-handler-stage-2'
export abstract class GitHandlerStage3 extends GitHandlerStage2 {
  protected async fetchGitHubPullRequestHead(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const remote = params.remote
    const prNumber = params.prNumber
    try {
      if (typeof remote !== 'string' || !isValidReviewHeadNumber(prNumber)) {
        throw new Error('Invalid GitHub pull request fetch request.')
      }
      if (!isSafeReviewHeadFetchRemote(remote)) {
        throw new Error('GitHub pull request fetch remote must not start with "-".')
      }

      try {
        const remoteComponent = await this.reviewHeadRemoteComponent(worktreePath, remote)
        // Why: return the written path so resolve can rev-parse the same ref the host wrote.
        const localRef = githubPullRequestHeadLocalRef(remoteComponent, prNumber)
        await this.git(
          ['fetch', '--no-tags', remote, `+refs/pull/${prNumber}/head:${localRef}`],
          worktreePath,
          { timeout: REVIEW_HEAD_FETCH_TIMEOUT_MS }
        )
        return { localRef }
      } catch (error) {
        // Why: a timeout kill has no git stderr; name it so the client can classify it as transient.
        if (isExecKilledError(error)) {
          throw new Error(`Fetching refs/pull/${prNumber}/head from "${remote}" timed out.`)
        }
        throw new Error(normalizeGitErrorMessage(error, 'fetch'))
      }
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async push(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    // Why: mirror src/main/git/remote.ts — push to a configured upstream when present so SSH worktrees with non-origin targets aren't repointed.
    void params.publish
    try {
      try {
        const target = await resolveRelayPushTarget(
          this.git.bind(this),
          worktreePath,
          params.pushTarget
        )
        const args = [
          'push',
          ...(params.forceWithLease === true ? ['--force-with-lease'] : []),
          '--set-upstream',
          ...(target ? [target.remote, target.refspec] : ['origin', 'HEAD'])
        ]
        await this.git(args, worktreePath)
      } catch (error) {
        // Why: mirror local gitPush normalization so SSH users get "non-fast-forward / pull first" guidance instead of raw git stderr.
        throw new Error(normalizeGitErrorMessage(error, 'push'))
      }
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async pullWithArgs(params: Record<string, unknown>, pullArgs: string[]) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const runPull = async (effectiveArgs: string[]): Promise<void> => {
      if (params.pushTarget !== undefined) {
        assertGitPushTargetShape(params.pushTarget)
        const pushTarget = params.pushTarget as GitPushTarget
        await this.git(['check-ref-format', '--branch', pushTarget.branchName], worktreePath)
        await this.git(
          ['pull', ...effectiveArgs, pushTarget.remoteName, pushTarget.branchName],
          worktreePath
        )
        return
      }
      const upstream = await resolveEffectiveGitUpstream((args) => this.git(args, worktreePath))
      if (upstream && !upstream.isConfiguredUpstream) {
        // Why: legacy Orca branches may track origin/main while pushes target origin/<branch>; pull the same effective branch the UI reports.
        await this.git(
          ['pull', ...effectiveArgs, upstream.remoteName, upstream.branchName],
          worktreePath
        )
        return
      }
      await this.git(['pull', ...effectiveArgs], worktreePath)
    }

    try {
      try {
        await runPullWithDivergenceFallback(pullArgs, runPull)
      } catch (error) {
        // Why: mirror local gitPull normalization so SSH users get actionable messages instead of raw git stderr.
        throw new Error(normalizeGitErrorMessage(error, 'pull'))
      }
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async pull(params: Record<string, unknown>) {
    // Why: plain `git pull` honors the user's merge/rebase/ff policy; with none, Git's policy error is normalized with setup guidance.
    await this.pullWithArgs(params, [])
  }

  protected async fastForward(params: Record<string, unknown>) {
    await this.pullWithArgs(params, ['--ff-only'])
  }

  protected async rebaseFromBase(params: Record<string, unknown>) {
    this.clearGitMutationReadCaches()
    const worktreePath = params.worktreePath as string
    const baseRef = params.baseRef as string
    try {
      try {
        const source = await resolveGitRemoteRebaseSource(
          ((args) => this.git(args, worktreePath)) as GitCommandRunner,
          baseRef
        )
        await this.git(['pull', '--rebase', source.remoteName, source.branchName], worktreePath)
      } catch (error) {
        throw new Error(normalizeGitErrorMessage(error, 'pull'))
      }
    } finally {
      this.clearGitMutationReadCaches()
    }
  }

  protected async branchDiff(params: Record<string, unknown>, context?: RequestContext) {
    const worktreePath = params.worktreePath as string
    const baseRef = params.baseRef as string
    if (baseRef.startsWith('-')) {
      throw new Error('Base ref must not start with "-"')
    }
    const options = {
      includePatch: params.includePatch as boolean | undefined,
      filePath: params.filePath as string | undefined,
      oldPath: params.oldPath as string | undefined
    }
    const result = await this.gitDiffReadDedupe.run(
      stableInFlightKey([
        'branchDiff',
        worktreePath,
        baseRef,
        options.includePatch ?? null,
        options.filePath ?? null,
        options.oldPath ?? null
      ]),
      () =>
        branchDiffEntries(
          this.git.bind(this),
          this.gitBuffer.bind(this),
          worktreePath,
          baseRef,
          options
        )
    )
    return this.maybeStreamResponse(result, params, context)
  }

  protected async commitDiff(params: Record<string, unknown>, context?: RequestContext) {
    const worktreePath = params.worktreePath as string
    const args = {
      commitOid: params.commitOid as string,
      parentOid: params.parentOid as string | null | undefined,
      filePath: params.filePath as string,
      oldPath: params.oldPath as string | undefined
    }
    const result = await this.gitDiffReadDedupe.run(
      stableInFlightKey([
        'commitDiff',
        worktreePath,
        args.commitOid,
        args.parentOid ?? null,
        args.filePath,
        args.oldPath ?? null
      ]),
      () => commitDiffEntry(this.gitBuffer.bind(this), worktreePath, args)
    )
    return this.maybeStreamResponse(result, params, context)
  }

  protected async exec(params: Record<string, unknown>, context?: RequestContext) {
    const args = params.args as string[]
    const cwd = params.cwd as string

    validateGitExecArgs(args)
    const run = () => this.git(args, cwd, { signal: context?.signal })
    const { stdout, stderr } = gitExecMutatesRepository(args)
      ? await this.runWithGitReadCacheClear(run)
      : await run()
    return this.maybeStreamResponse({ stdout, stderr }, params, context)
  }

  protected async clone(params: Record<string, unknown>, context?: RequestContext) {
    const args = params.args as string[]
    const cwd = params.cwd as string
    const progressId = params.progressId
    validateGitExecArgs(args)
    if (typeof progressId !== 'string' || progressId.length === 0) {
      throw new Error('Missing clone progress id.')
    }
    if (args[0] !== 'clone') {
      throw new Error('git.clone only supports clone commands.')
    }
    return await this.runWithGitReadCacheClear(() =>
      this.spawnClone(args, cwd, progressId, context)
    )
  }

  protected async spawnClone(
    args: string[],
    cwd: string,
    progressId: string,
    context?: RequestContext
  ): Promise<{ stdout: string; stderr: string }> {
    return await new Promise((resolve, reject) => {
      const child = spawn('git', args, {
        cwd: expandTilde(cwd),
        env: buildRelayUnattendedGitEnv(),
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let stdout = ''
      let stderr = ''
      let settled = false
      const cleanup = (): void => {
        context?.signal?.removeEventListener('abort', onAbort)
      }
      const onAbort = (): void => {
        child.kill()
      }
      context?.signal?.addEventListener('abort', onAbort, { once: true })
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout = (stdout + chunk.toString('utf-8')).slice(-4096)
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf-8')
        stderr = (stderr + text).slice(-4096)
        for (const line of text.split(/[\r\n]+/)) {
          const match = line.match(/^([\w\s]+):\s+(\d+)%/)
          if (match) {
            this.dispatcher.notify('git.cloneProgress', {
              progressId,
              phase: match[1].trim(),
              percent: Number.parseInt(match[2], 10)
            })
          }
        }
      })
      child.on('error', (error) => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        reject(error)
      })
      child.on('close', (code, signal) => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        if (context?.signal?.aborted) {
          reject(new Error('Clone aborted'))
          return
        }
        if (code === 0 && !signal) {
          resolve({ stdout, stderr })
          return
        }
        reject(new Error(`Clone failed: ${getGitCloneFailureMessage(stderr)}`))
      })
    })
  }

  protected async renameCurrentBranch(params: Record<string, unknown>) {
    return this.runWithGitReadCacheClear(async () => {
      const worktreePath = params.worktreePath
      const newBranch = params.newBranch
      if (typeof worktreePath !== 'string' || typeof newBranch !== 'string') {
        throw new Error('Invalid branch rename request.')
      }
      if (newBranch.startsWith('-')) {
        throw new Error('Branch name must not start with "-".')
      }
      try {
        // Why: generic git.exec blocks destructive branch flags; this narrow RPC permits only the already-checked current-branch rename.
        await this.git(['check-ref-format', '--branch', newBranch], worktreePath)
        await this.git(['branch', '-m', newBranch], worktreePath)
      } catch (error) {
        throw new Error(normalizeGitErrorMessage(error))
      }
    })
  }

  protected async forceDeletePreservedBranch(params: Record<string, unknown>) {
    const repoPath = params.repoPath
    const branchName = params.branchName
    const expectedHead = params.expectedHead
    if (
      typeof repoPath !== 'string' ||
      typeof branchName !== 'string' ||
      typeof expectedHead !== 'string'
    ) {
      throw new Error('Invalid preserved branch force-delete request.')
    }
    // Why: empty repoPath would target the relay's own cwd with a destructive update-ref, and NUL bytes can't reach git safely — reject both.
    if (!repoPath || repoPath.includes('\0') || expectedHead.includes('\0')) {
      throw new Error('Invalid preserved branch force-delete request.')
    }
    return this.runWithGitReadCacheClear(() =>
      forceDeletePreservedRelayBranch(this.git.bind(this), repoPath, branchName, expectedHead)
    )
  }

  protected async isGitRepo(params: Record<string, unknown>) {
    const dirPath = params.dirPath as string
    try {
      const { stdout } = await this.git(['rev-parse', '--show-toplevel'], dirPath)
      return { isRepo: true, rootPath: stdout.trim() }
    } catch {
      return { isRepo: false, rootPath: null }
    }
  }

  protected async readRepoLocation(repoPath: string): Promise<RelayRepoLocation | undefined> {
    try {
      return await this.gitCapabilities.runWithFallback(
        'rev-parse-path-format',
        async () => {
          const { stdout } = await this.git(
            ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'],
            repoPath
          )
          if (hasUnsupportedRevParsePathFormatEcho(stdout)) {
            // Why: old Git echoes the unknown option and exits zero; remember the signal though the paths still parse.
            this.gitCapabilities.rememberUnsupported('rev-parse-path-format')
          }
          return parseRelayRepoLocation(repoPath, stdout)
        },
        async () => {
          const { stdout } = await this.git(
            ['rev-parse', '--show-toplevel', '--git-common-dir'],
            repoPath
          )
          return parseRelayRepoLocation(repoPath, stdout)
        },
        isUnsupportedRevParsePathFormatError
      )
    } catch {
      return undefined
    }
  }

  protected async normalizeMainWorktreePath(
    repoPath: string,
    worktrees: Record<string, unknown>[]
  ): Promise<Record<string, unknown>[]> {
    const mainIndex = worktrees.findIndex((worktree) => worktree.isMainWorktree === true)
    const mainWorktree = worktrees[mainIndex]
    const mainPath = typeof mainWorktree?.path === 'string' ? mainWorktree.path : ''
    // Expand `~` so legacy tilde SSH repo paths match git's absolute path, sparing a rev-parse per poll.
    const resolvedRepoPath = expandTilde(repoPath)
    if (!mainPath || areRelayWorktreePathsEqual(mainPath, resolvedRepoPath)) {
      return worktrees
    }

    const location = await this.readRepoLocation(resolvedRepoPath)
    if (!location) {
      return worktrees
    }

    // Why: only separate-git-dir/submodule repos have main entry == git-common-dir; gate on it so we don't clobber a linked worktree's real root.
    if (!areRelayWorktreePathsEqual(mainPath, location.commonDir)) {
      return worktrees
    }

    const normalized = [...worktrees]
    normalized[mainIndex] = { ...mainWorktree, path: location.topLevel }
    return normalized
  }

  protected async listWorktrees(params: Record<string, unknown>, context?: RequestContext) {
    const repoPath = params.repoPath as string
    return this.gitCapabilities
      .runWithFallback(
        'worktree-list-z',
        async () => {
          const { stdout } = await this.git(['worktree', 'list', '--porcelain', '-z'], repoPath, {
            signal: context?.signal
          })
          return this.normalizeMainWorktreePath(
            repoPath,
            parseWorktreeList(stdout, { nulDelimited: true })
          )
        },
        async () => {
          // Why: Git <2.36 lacks worktree-list `-z`, so fall back to the newline-block parser (loses newline-in-path safety).
          try {
            const { stdout } = await this.git(['worktree', 'list', '--porcelain'], repoPath, {
              signal: context?.signal
            })
            const normalized = await this.normalizeMainWorktreePath(
              repoPath,
              parseWorktreeList(stdout)
            )
            // Why: Git <2.31 emits no `prunable` annotation, so probe each linked worktree's existence instead of trusting stale registrations (issue #8389).
            return annotatePrunableWorktreesByExistence(normalized)
          } catch {
            return []
          }
        },
        isUnsupportedWorktreeListZError
      )
      .catch(() => [])
  }

}
