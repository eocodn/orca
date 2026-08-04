import { execFile,type ExecFileOptions } from 'node:child_process'
import * as path from 'node:path'
import { promisify } from 'node:util'
import { GitCapabilityCache } from '../shared/git-capability-cache'
import { InFlightPromiseDedupe } from '../shared/in-flight-promise-dedupe'
import { endSubprocessStdin } from '../shared/subprocess-stdin-write'
import type { RelayContext } from './context'
import type { RelayDispatcher,RequestContext } from './dispatcher'
import { createSubmodulePathsCache,type SubmodulePathsCache } from './git-handler-submodule-ops'
import { GitResponseStreamRegistry } from './git-response-stream'
import type { RelayFilesystemWatchRegistry } from './relay-filesystem-watch-registry'

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

// Split-stage declarations keep handler registration type-safe; the final stage owns each operation.
export abstract class GitHandler {
  protected dispatcher: RelayDispatcher
  protected readonly gitDiffReadDedupe = new InFlightPromiseDedupe<unknown>()
  protected readonly gitCapabilities = new GitCapabilityCache()
  // Why: large diff/exec responses go on the bulk lane so they don't head-of-line-block interactive pty.data echo on the shared SSH channel.
  protected readonly responseStreams = new GitResponseStreamRegistry()

  // Why: instance-level TTL cache avoids re-reading `.gitmodules` per diff click over SSH; per-instance so it can't leak across tests.
  protected submodulePathsCache: SubmodulePathsCache = createSubmodulePathsCache()

  protected abstract registerHandlers(): void
  protected abstract localBranches(params: Record<string, unknown>): Promise<unknown>
  protected abstract discard(params: Record<string, unknown>): Promise<unknown>
  protected abstract bulkDiscard(params: Record<string, unknown>): Promise<unknown>
  protected abstract conflictOperation(params: Record<string, unknown>): Promise<unknown>
  protected abstract branchCompare(params: Record<string, unknown>): Promise<unknown>
  protected abstract commitCompare(params: Record<string, unknown>): Promise<unknown>
  protected abstract upstreamStatus(params: Record<string, unknown>): Promise<unknown>
  protected abstract fetch(params: Record<string, unknown>): Promise<unknown>
  protected abstract forkSync(
    params: Record<string, unknown>,
    context?: RequestContext
  ): Promise<unknown>
  protected abstract fetchRemoteTrackingRef(params: Record<string, unknown>): Promise<unknown>
  protected abstract fetchGitHubPullRequestHead(params: Record<string, unknown>): Promise<unknown>
  protected abstract fetchGitLabMergeRequestHead(params: Record<string, unknown>): Promise<unknown>
  protected abstract push(params: Record<string, unknown>): Promise<unknown>
  protected abstract pull(params: Record<string, unknown>): Promise<unknown>
  protected abstract fastForward(params: Record<string, unknown>): Promise<unknown>
  protected abstract rebaseFromBase(params: Record<string, unknown>): Promise<unknown>
  protected abstract branchDiff(
    params: Record<string, unknown>,
    context?: RequestContext
  ): Promise<unknown>
  protected abstract commitDiff(
    params: Record<string, unknown>,
    context?: RequestContext
  ): Promise<unknown>
  protected abstract listWorktrees(
    params: Record<string, unknown>,
    context?: RequestContext
  ): Promise<unknown>
  protected abstract addWorktree(params: Record<string, unknown>): Promise<unknown>
  protected abstract removeWorktree(params: Record<string, unknown>): Promise<unknown>
  protected abstract worktreeIsClean(params: Record<string, unknown>): Promise<unknown>
  protected abstract refreshLocalBaseRefForWorktreeCreate(
    params: Record<string, unknown>
  ): Promise<unknown>
  protected abstract renameCurrentBranch(params: Record<string, unknown>): Promise<unknown>
  protected abstract forceDeletePreservedBranch(params: Record<string, unknown>): Promise<unknown>
  protected abstract exec(
    params: Record<string, unknown>,
    context?: RequestContext
  ): Promise<unknown>
  protected abstract clone(
    params: Record<string, unknown>,
    context?: RequestContext
  ): Promise<unknown>
  protected abstract isGitRepo(params: Record<string, unknown>): Promise<unknown>
  protected abstract literalPathspec(filePath: string): string

  // Why: RelayContext accepted for protocol back-compat (docs/relay-fs-allowlist-removal.md) but no longer consulted on git ops.
  constructor(
    dispatcher: RelayDispatcher,
    _context: RelayContext,
    protected readonly watcherRegistry?: Pick<RelayFilesystemWatchRegistry, 'runWithRemovalFence'>
  ) {
    this.dispatcher = dispatcher
    this.registerHandlers()
    // Why: a detached client's git.responseAck frames never arrive; wake any pump parked on the ack window so it re-checks staleness and exits.
    this.dispatcher.onClientDetached?.(() => this.responseStreams.wakeAll())
  }

}
