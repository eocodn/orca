import { readFile, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { Store } from '../persistence'
import { getProjectHostSetupWorktreeMeta } from '../../shared/project-host-setup-projection'
import { TaskSourceContextSchema } from '../../shared/task-source-context-schema'
import { WorkspaceLinkedItemSchema } from '../../shared/workspace-linked-item-schema'
import { isWorkspaceLinkedItemSourceContextMatch } from '../../shared/workspace-linked-item-source-context'
import { deleteWorktreeHistoryDir } from '../terminal-history-deletion'
import type {
  AutomationWorkspaceProvenance,
  CliWorkspaceProvenance,
  CreateWorktreeArgs,
  OrcaHooks,
  Repo,
  WorktreeMeta
} from '../../shared/types'
import {
  getRepoExecutionHostId,
  type ExecutionHostId
} from '../../shared/execution-host'
import type { ListDetectedWorktreesArgs } from '../../shared/detected-worktree-provider-contract'
import { gitExecFileAsync } from '../git/runner'
import { pruneWorktreePRRefreshAliases } from '../github/pr-refresh-coordinator'
import { getSshFilesystemProvider } from '../providers/ssh-filesystem-dispatch'
import {
  getEffectiveHooks,
  getEffectiveHooksFromConfig,
  parseOrcaYaml
} from '../hooks'
import { joinWorktreeRelativePath } from '../runtime/runtime-relative-paths'
import type { OrcaRuntimeService } from '../runtime/orca-runtime'
import { killAllProcessesForWorktree } from '../runtime/worktree-teardown'
import { clearProviderPtyState, getLocalPtyProvider, getSshPtyProvider } from './pty'

export type CreateWorktreeArgsWithSystemProvenance = CreateWorktreeArgs & {
  automationProvenance?: AutomationWorkspaceProvenance
  cliProvenance?: CliWorkspaceProvenance
}

export type RemoveWorktreeArgs = {
  worktreeId: string
  hostId?: ExecutionHostId
  force?: boolean
  skipArchive?: boolean
}

export type DetectedWorktreeRequestArgs = { repoId: string } | ListDetectedWorktreesArgs

export async function stopPtysForDestructiveWorktreeRemoval(
  runtime: OrcaRuntimeService,
  worktreeId: string,
  connectionId?: string
): Promise<void> {
  const provider = connectionId ? getSshPtyProvider(connectionId) : getLocalPtyProvider()
  if (!provider) {
    throw new Error(`PTY provider unavailable for worktree deletion: ${worktreeId}`)
  }
  const teardownResult = await killAllProcessesForWorktree(worktreeId, {
    runtime,
    localProvider: provider,
    onPtyStopped: clearProviderPtyState,
    requirePhysicalStop: true,
    ...(connectionId ? { includeLocalRegistry: false } : {})
  })
  const total =
    teardownResult.runtimeStopped + teardownResult.providerStopped + teardownResult.registryStopped
  if (total > 0) {
    console.info(
      `[worktree-teardown] ${worktreeId} killed runtime=${teardownResult.runtimeStopped} provider=${teardownResult.providerStopped} registry=${teardownResult.registryStopped}`
    )
  }
}

export function getRepoForWorktreeRemoval(
  store: Store,
  repoId: string,
  hostId?: ExecutionHostId
): Repo | undefined {
  const matches = store
    .getRepos()
    .filter((repo) => repo.id === repoId && (!hostId || getRepoExecutionHostId(repo) === hostId))
  // Why: deletion must never guess between host owners; legacy unscoped calls work only while the repo id has one unique owner.
  if (matches.length === 1) {
    return matches[0]
  }
  if (matches.length > 1) {
    return undefined
  }
  const legacyMatch = store.getRepo(repoId)
  return legacyMatch && (!hostId || getRepoExecutionHostId(legacyMatch) === hostId)
    ? legacyMatch
    : undefined
}
import { advertisedUrlWatcher } from '../ports/advertised-url-watcher'
import { localhostWorktreeLabelProxy } from '../localhost-worktree-label-proxy'
import {
  isWorktreePathMissing,
} from '../worktree-removal-safety'
import {
  getLocalWorktreePathAccess,
  toLocalWorktreeRuntimePath
} from '../local-worktree-filesystem'

export const NullableWorkspaceLinkedItemSchema = WorkspaceLinkedItemSchema.nullable()
export const NullableTaskSourceContextSchema = TaskSourceContextSchema.nullable()
export const WORKTREE_ARCHIVE_HOOK_TIMEOUT_MS = 120_000
export const WORKTREE_LIST_ALL_CONCURRENCY = 8

export function normalizeLinkedWorkItemFields<
  T extends {
    linkedWorkItem?: unknown
    linkedTaskSourceContext?: unknown
  }
>(input: T): T {
  const linkedWorkItem =
    input.linkedWorkItem === undefined
      ? undefined
      : NullableWorkspaceLinkedItemSchema.parse(input.linkedWorkItem)
  const linkedTaskSourceContext =
    input.linkedTaskSourceContext === undefined
      ? undefined
      : NullableTaskSourceContextSchema.parse(input.linkedTaskSourceContext)
  if (
    linkedWorkItem &&
    linkedTaskSourceContext &&
    !isWorkspaceLinkedItemSourceContextMatch(linkedWorkItem, linkedTaskSourceContext)
  ) {
    throw new Error('Linked work item and source context identities must match')
  }
  return {
    ...input,
    ...(linkedWorkItem !== undefined ? { linkedWorkItem } : {}),
    ...(linkedTaskSourceContext !== undefined ? { linkedTaskSourceContext } : {})
  }
}

export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = []
  let nextIndex = 0
  const workerCount = Math.min(limit, items.length)
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex
        nextIndex += 1
        results[index] = await fn(items[index])
      }
    })
  )
  return results
}

export function removeWorktreeMetadataAndTransientState(store: Store, worktreeId: string): void {
  // Why: worktree IDs are path-derived and reusable; drop process-local caches before the same ID can map to a new workspace.
  store.removeWorktreeMeta(worktreeId)
  advertisedUrlWatcher.forgetWorktree(worktreeId)
  // Why: drop this worktree's localhost label routes so they don't accumulate in the proxy's route maps all session.
  localhostWorktreeLabelProxy.unregisterWorktree(worktreeId)
  // Why: schedule async history tree removal — never recursive-rmSync on the delete critical path.
  deleteWorktreeHistoryDir(worktreeId)
  // Why: release the removed worktree's PR-refresh aliases so coalesced queue entries don't retain it all session (memory creep).
  pruneWorktreePRRefreshAliases(worktreeId)
}

export function getProjectHostSetupMetaUpdates(
  store: Store,
  repo: Repo,
  existing?: WorktreeMeta
): Partial<Pick<WorktreeMeta, 'projectId' | 'hostId' | 'projectHostSetupId'>> {
  const ownership = getProjectHostSetupWorktreeMeta(store.getProjectHostSetups(), repo)
  const sameSetup =
    existing?.projectHostSetupId === undefined ||
    existing.projectHostSetupId === ownership.projectHostSetupId
  return {
    // Why: project IDs can upgrade from legacy repo IDs to provider-backed ones; repair ownership on discovery when the host setup matches.
    ...(sameSetup && existing?.projectId !== ownership.projectId
      ? { projectId: ownership.projectId }
      : {}),
    ...(sameSetup && existing?.hostId === undefined ? { hostId: ownership.hostId } : {}),
    ...(existing?.projectHostSetupId === undefined
      ? { projectHostSetupId: ownership.projectHostSetupId }
      : {})
  }
}

// Why: disk-discovered worktrees have no WorktreeMeta, so lastActivityAt=0 sinks them to the bottom of "Recent"; also backfill host-setup ownership here.
export function resolveWorktreeMetaWithDiscoveryBackfill(
  store: Store,
  repo: Repo,
  worktreeId: string
): WorktreeMeta {
  const existing = store.getWorktreeMeta(worktreeId)
  const ownershipUpdates = getProjectHostSetupMetaUpdates(store, repo, existing)
  if (existing) {
    const updates = {
      ...(!existing.instanceId ? { instanceId: randomUUID() } : {}),
      ...ownershipUpdates
    }
    if (Object.keys(updates).length > 0) {
      // Why: pre-lineage profiles already have WorktreeMeta rows; backfill on discovery so upgraded workspaces get lineage and host routing.
      return store.setWorktreeMeta(worktreeId, updates)
    }
    return existing
  }
  return store.setWorktreeMeta(worktreeId, {
    lastActivityAt: Date.now(),
    ...ownershipUpdates
  })
}

export async function isAlreadyRemovedWorktreePath(
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

export async function isLocalGitRepository(
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

export function gitStatusErrorMeansNotRepository(error: unknown): boolean {
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

export function getWorktreeRemovalOptionsKey(args: { force?: boolean; skipArchive?: boolean }): string {
  const forceKey = args.force === true ? 'force' : 'normal'
  const archiveKey = args.skipArchive === true ? 'skip-archive' : 'run-archive'
  return `${forceKey}:${archiveKey}`
}

export function getWorktreeRemovalInFlightKey(worktreeId: string, hostId?: ExecutionHostId): string {
  return `${hostId ?? ''}\0${worktreeId}`
}

export async function getArchiveHooksForRemoval(repo: Repo): Promise<OrcaHooks | null> {
  if (!repo.connectionId) {
    return getEffectiveHooks(repo)
  }

  const fsProvider = getSshFilesystemProvider(repo.connectionId)
  if (!fsProvider) {
    return getEffectiveHooksFromConfig(repo, null)
  }

  try {
    const result = await fsProvider.readFile(joinWorktreeRelativePath(repo.path, 'orca.yaml'))
    const yamlHooks = result.isBinary ? null : parseOrcaYaml(result.content)
    return getEffectiveHooksFromConfig(repo, yamlHooks)
  } catch {
    return getEffectiveHooksFromConfig(repo, null)
  }
}
