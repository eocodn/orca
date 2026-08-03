import type { SshChannelMultiplexer } from '../ssh/ssh-channel-multiplexer'
import type { GitProviderStatusOptions } from './types'
import type { GitStatusResult, GitDiffResult, GitStagingArea } from '../../shared/types'
import type { GitHistoryOptions, GitHistoryResult } from '../../shared/git-history'
import { JsonRpcErrorCode } from '../ssh/relay-protocol'
import { requestGitStreamable } from '../ssh/ssh-git-response-stream-reader'
import { gitExecMutatesRepository } from '../../shared/git-exec-mutation'
import type { CommitMessageDraftContext } from '../../shared/commit-message-generation'
import type { CommitMessagePlan } from '../../shared/commit-message-plan'
import type { RemoteCommitMessageExecResult } from '../text-generation/commit-message-text-generation'
import type { RemoteHostPlatform } from '../ssh/ssh-remote-platform'
import {
  describeMaxBufferOverflowError,
  isMaxBufferOverflowError
} from '../git/max-buffer-overflow'
import { InFlightPromiseDedupe, stableInFlightKey } from '../../shared/in-flight-promise-dedupe'

type NonInteractiveExecQueueEntry = {
  started: boolean
  canceled: boolean
  done: Promise<void>
  release: () => void
}

function isJsonRpcMethodNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }
  return (error as { code?: unknown }).code === JsonRpcErrorCode.MethodNotFound
}

export class SshGitProviderBase {
  protected readonly gitDiffReadDedupe = new InFlightPromiseDedupe<
    GitDiffResult | GitDiffResult[]
  >()

  protected connectionId: string
  protected mux: SshChannelMultiplexer
  private nonInteractiveExecQueues = new Map<string, NonInteractiveExecQueueEntry[]>()

  protected async runWithDiffDedupeClear<T>(run: () => Promise<T>): Promise<T> {
    // Why: git mutations can stale both existing and concurrently-started diff reads.
    // Clear before and after so later reads never join pre-mutation work.
    this.gitDiffReadDedupe.clear()
    try {
      return await run()
    } finally {
      this.gitDiffReadDedupe.clear()
    }
  }
  protected loggedWorktreeIsCleanFallback = false

  constructor(
    connectionId: string,
    mux: SshChannelMultiplexer,
    private readonly hostPlatform: RemoteHostPlatform | null = null
  ) {
    this.connectionId = connectionId
    this.mux = mux
  }

  getConnectionId(): string {
    return this.connectionId
  }

  getHostPlatform(): RemoteHostPlatform | null {
    return this.hostPlatform
  }

  async getStatus(
    worktreePath: string,
    options?: GitProviderStatusOptions
  ): Promise<GitStatusResult> {
    this.gitDiffReadDedupe.clear()
    const includeIgnoredArgs = options?.includeIgnored ? { includeIgnored: true } : {}
    const upstreamCacheBypassArgs = options?.bypassEffectiveUpstreamNegativeCache
      ? { bypassEffectiveUpstreamNegativeCache: true }
      : {}
    const lineStatsReuseArgs = options?.reuseLineStats ? { reuseLineStats: true } : {}
    const request = {
      worktreePath,
      ...includeIgnoredArgs,
      ...upstreamCacheBypassArgs,
      ...lineStatsReuseArgs
    }
    return (await (options?.signal
      ? this.mux.request('git.status', request, { signal: options.signal })
      : this.mux.request('git.status', request))) as GitStatusResult
  }

  async getSubmoduleStatus(
    worktreePath: string,
    submodulePath: string,
    area: GitStagingArea = 'unstaged'
  ): Promise<GitStatusResult> {
    // Why: mirror getStatus() — refreshing submodule state must invalidate
    // in-flight diff reads so a later diff can't reuse a stale pending RPC.
    this.gitDiffReadDedupe.clear()
    try {
      return (await this.mux.request('git.submoduleStatus', {
        worktreePath,
        submodulePath,
        area
      })) as GitStatusResult
    } catch (error) {
      // Why: a newer desktop client may talk to an older relay that predates
      // git.submoduleStatus; surface an actionable reconnect hint instead of a
      // raw JSON-RPC method-not-found error in Source Control.
      if (isJsonRpcMethodNotFoundError(error)) {
        throw new Error(
          'SSH submodule diff support is unavailable on this relay. Reconnect the SSH target to update Orca on the host, then try again.'
        )
      }
      throw error
    }
  }

  async checkIgnoredPaths(worktreePath: string, relativePaths: string[]): Promise<string[]> {
    return (await this.mux.request('git.checkIgnored', {
      worktreePath,
      paths: relativePaths
    })) as string[]
  }

  async getHistory(
    worktreePath: string,
    options: GitHistoryOptions = {}
  ): Promise<GitHistoryResult> {
    return (await this.mux.request('git.history', {
      worktreePath,
      ...options
    })) as GitHistoryResult
  }

  async commit(
    worktreePath: string,
    message: string
  ): Promise<{ success: boolean; error?: string }> {
    return this.runWithDiffDedupeClear(
      async () =>
        (await this.mux.request('git.commit', {
          worktreePath,
          message
        })) as { success: boolean; error?: string }
    )
  }

  async getStagedCommitContext(worktreePath: string): Promise<CommitMessageDraftContext | null> {
    const branchPromise = this.exec(['branch', '--show-current'], worktreePath).catch(() => ({
      stdout: ''
    }))
    const [branchResult, summaryResult] = await Promise.all([
      branchPromise,
      this.exec(['diff', '--cached', '--name-status'], worktreePath)
    ])
    const stagedSummary = summaryResult.stdout.trim()
    if (!stagedSummary) {
      return null
    }
    let stagedPatch = ''
    try {
      const patchResult = await this.exec(
        ['diff', '--cached', '--patch', '--minimal', '--no-color', '--no-ext-diff'],
        worktreePath
      )
      stagedPatch = patchResult.stdout
    } catch (error) {
      if (!isMaxBufferOverflowError(error)) {
        throw error
      }
      // Why: a very large staged diff can overflow the remote exec buffer. The
      // patch is optional context (truncated later anyway), so degrade to the
      // file-name summary instead of failing commit-message generation.
      console.warn(
        '[ssh-git] Staged patch too large to read; using file summary only:',
        describeMaxBufferOverflowError(error)
      )
    }
    return {
      branch: branchResult.stdout.trim() || null,
      stagedSummary,
      stagedPatch
    }
  }

  async exec(
    args: string[],
    cwd: string,
    options?: { signal?: AbortSignal; timeoutMs?: number }
  ): Promise<{ stdout: string; stderr: string }> {
    const run = () =>
      options
        ? requestGitStreamable(this.mux, 'git.exec', { args, cwd }, options)
        : requestGitStreamable(this.mux, 'git.exec', { args, cwd })
    const result = gitExecMutatesRepository(args)
      ? await this.runWithDiffDedupeClear(run)
      : await run()
    return result as { stdout: string; stderr: string }
  }

  async executeCommitMessagePlan(
    plan: CommitMessagePlan,
    cwd: string,
    timeoutMs: number,
    operation = 'commit-message'
  ): Promise<RemoteCommitMessageExecResult> {
    return this.runQueuedNonInteractiveExec(
      cwd,
      {
        binary: plan.binary,
        args: plan.args,
        cwd,
        stdin: plan.stdinPayload,
        timeoutMs,
        operation
      },
      undefined,
      operation
    )
  }

  async execNonInteractive(
    binary: string,
    args: string[],
    cwd: string,
    timeoutMs: number,
    signal?: AbortSignal,
    env?: Record<string, string>
  ): Promise<RemoteCommitMessageExecResult> {
    return this.runQueuedNonInteractiveExec(
      cwd,
      {
        binary,
        args,
        cwd,
        stdin: null,
        timeoutMs,
        ...(env ? { env } : {})
      },
      signal
    )
  }

  async cancelNonInteractiveExec(cwd: string, operation?: string): Promise<void> {
    const queue = this.nonInteractiveExecQueues.get(this.nonInteractiveLaneKey(cwd, operation))
    const queuedEntry = queue?.find((entry) => !entry.started && !entry.canceled)
    if (queuedEntry) {
      queuedEntry.canceled = true
      return
    }
    await this.cancelActiveNonInteractiveExec(cwd, operation)
  }

  private async cancelActiveNonInteractiveExec(cwd: string, operation?: string): Promise<void> {
    try {
      await this.mux.request('agent.cancelExec', {
        cwd,
        ...(operation ? { operation } : {})
      })
    } catch {
      // Best-effort: callers are already unwinding after cancellation.
    }
  }

  async cancelGenerateCommitMessage(
    worktreePath: string,
    operation = 'commit-message'
  ): Promise<void> {
    // Why: best-effort — the relay returns `{canceled: false}` when there is
    // nothing in flight. Callers should not block UI updates on this.
    await this.cancelNonInteractiveExec(worktreePath, operation)
  }

  private nonInteractiveLaneKey(cwd: string, operation?: string): string {
    return JSON.stringify([operation || 'default', cwd])
  }

  private async runQueuedNonInteractiveExec(
    cwd: string,
    payload: {
      binary: string
      args: string[]
      cwd: string
      stdin: string | null
      timeoutMs: number
      env?: Record<string, string>
      operation?: string
    },
    signal?: AbortSignal,
    operation?: string
  ): Promise<RemoteCommitMessageExecResult> {
    const laneKey = this.nonInteractiveLaneKey(cwd, operation)
    const queue = this.nonInteractiveExecQueues.get(laneKey) ?? []
    const previous = queue.at(-1)?.done ?? Promise.resolve()
    let releaseEntry!: () => void
    const entry: NonInteractiveExecQueueEntry = {
      started: false,
      canceled: false,
      done: previous
        .catch(() => {})
        .then(
          () =>
            new Promise<void>((resolve) => {
              releaseEntry = resolve
            })
        ),
      release: () => releaseEntry()
    }
    queue.push(entry)
    this.nonInteractiveExecQueues.set(laneKey, queue)
    const abortEntry = (): void => {
      if (!entry.started) {
        entry.canceled = true
        return
      }
      void this.cancelActiveNonInteractiveExec(cwd, operation)
    }
    if (signal?.aborted) {
      entry.canceled = true
    } else {
      signal?.addEventListener('abort', abortEntry, { once: true })
    }

    // Why: the SSH relay tracks children per operation; serialize only matching
    // lanes so commit-message and PR-field generation can coexist.
    await previous.catch(() => {})
    try {
      if (entry.canceled) {
        return {
          stdout: '',
          stderr: '',
          exitCode: null,
          timedOut: false,
          canceled: true
        }
      }
      entry.started = true
      return (await this.mux.request(
        'agent.execNonInteractive',
        payload
      )) as RemoteCommitMessageExecResult
    } finally {
      signal?.removeEventListener('abort', abortEntry)
      entry.release()
      const currentQueue = this.nonInteractiveExecQueues.get(laneKey)
      const entryIndex = currentQueue?.indexOf(entry) ?? -1
      if (entryIndex >= 0) {
        currentQueue?.splice(entryIndex, 1)
      }
      if (currentQueue?.length === 0) {
        this.nonInteractiveExecQueues.delete(laneKey)
      }
    }
  }

  async getDiff(
    worktreePath: string,
    filePath: string,
    staged: boolean,
    compareAgainstHead?: boolean
  ): Promise<GitDiffResult> {
    return this.gitDiffReadDedupe.run(
      stableInFlightKey(['diff', worktreePath, filePath, staged, compareAgainstHead]),
      async () =>
        (await requestGitStreamable(this.mux, 'git.diff', {
          worktreePath,
          filePath,
          staged,
          compareAgainstHead
        })) as GitDiffResult
    ) as Promise<GitDiffResult>
  }
}

export { isJsonRpcMethodNotFoundError }
