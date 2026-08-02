import {
  getLocalWorktreePathAccess,
  toLocalWorktreeRuntimePath
} from '../local-worktree-filesystem'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import { gitExecFileAsync } from '../git/runner'
import { isWorktreePathMissing } from '../worktree-removal-safety'
import { splitWorktreeId } from '../../shared/worktree-id'
import type { GitPushTarget, RemoveWorktreeResult, Repo } from '../../shared/types'
import type { ExecutionHostId } from '../../shared/execution-host'

export function omitUndefinedProperties<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>
}

export async function isRuntimeWorktreePathMissing(
  repo: Repo,
  worktreePath: string,
  localWorktreeGitOptions: { wslDistro?: string } = {}
): Promise<boolean> {
  if (!repo.connectionId) {
    const access = getLocalWorktreePathAccess(localWorktreeGitOptions)
    return isWorktreePathMissing(
      toLocalWorktreeRuntimePath(worktreePath, localWorktreeGitOptions),
      access.statPath
    )
  }

  const fsProvider = getSshFilesystemProvider(repo.connectionId)
  if (!fsProvider) {
    return false
  }
  return isWorktreePathMissing(worktreePath, (path) => fsProvider.stat(path))
}

export async function isLocalRuntimeGitRepository(
  runtimeWorktreePath: string,
  localWorktreeGitOptions: { wslDistro?: string } = {}
): Promise<boolean> {
  try {
    await gitExecFileAsync(['status', '--short'], {
      cwd: runtimeWorktreePath,
      ...localWorktreeGitOptions
    })
    return true
  } catch (error) {
    return !gitStatusErrorMeansNotRepository(error)
  }
}

function gitStatusErrorMeansNotRepository(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message: unknown }).message)
        : typeof error === 'string'
          ? error
          : ''
  const stderr =
    error && typeof error === 'object' && 'stderr' in error
      ? String((error as { stderr: unknown }).stderr)
      : ''
  return /not a git repository/i.test(`${message}\n${stderr}`)
}

export type RuntimeWorktreeRemovalTarget = {
  id: string
  repoId: string
  path: string
  hostId?: ExecutionHostId
  pushTarget?: GitPushTarget
}

export type RuntimeWorktreeRemovalInFlight = {
  optionsKey: string
  promise: Promise<RemoveWorktreeResult & { warning?: string }>
}

export type PreservedBranchCleanupTarget = {
  branchName: string
  head: string
  pushTarget?: GitPushTarget
}

export function getRuntimeWorktreeRemovalOptionsKey(force: boolean, runHooks: boolean): string {
  return `${force ? 'force' : 'normal'}:${runHooks ? 'run-hooks' : 'skip-hooks'}`
}

export function getRuntimeWorktreeRemovalKey(target: RuntimeWorktreeRemovalTarget): string {
  return `${target.hostId ?? 'legacy'}\0${target.id}`
}

export function parseExactWorktreeIdSelector(
  selector: string
): RuntimeWorktreeRemovalTarget | null {
  const worktreeId = selector.startsWith('id:') ? selector.slice(3) : selector
  const parsed = splitWorktreeId(worktreeId)
  if (!parsed || !parsed.repoId || !parsed.worktreePath) {
    return null
  }
  return { id: worktreeId, repoId: parsed.repoId, path: parsed.worktreePath }
}
