import { useAppStore, type AppState } from '@/store'
import { isGitRepoKind } from '../../../shared/repo-kind'
import { findWorktreeById } from '@/store/slices/worktree-helpers'
import type { OpenFile } from '@/store/slices/editor'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { notifyEditorExternalFileChange } from '@/components/editor/editor-autosave'
const EXTERNAL_RELOAD_DEBOUNCE_MS = 75
const pendingExternalReloadTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function warnExternalWatchFailure(target: WatchedTarget, err: unknown): void {
  console.warn('[filesystem-watch] failed to watch worktree', {
    worktreeId: target.worktreeId,
    worktreePath: target.worktreePath,
    connectionId: target.connectionId,
    error: err instanceof Error ? err.message : String(err)
  })
}

export function scheduleDebouncedExternalReload(notification: {
  worktreeId: string
  worktreePath: string
  relativePath: string
  runtimeEnvironmentId: string | null
}): void {
  const key = `${notification.worktreeId}::${notification.runtimeEnvironmentId ?? 'client'}::${notification.relativePath}`
  const existing = pendingExternalReloadTimers.get(key)
  if (existing !== undefined) {
    globalThis.clearTimeout(existing)
  }
  const handle = globalThis.setTimeout(() => {
    pendingExternalReloadTimers.delete(key)
    notifyEditorExternalFileChange(notification)
  }, EXTERNAL_RELOAD_DEBOUNCE_MS)
  pendingExternalReloadTimers.set(key, handle)
}

export type WatchedTarget = {
  worktreeId: string
  worktreePath: string
  connectionId: string | undefined
  runtimeEnvironmentId: string | null
}

export type ExternalWatchNotification = {
  worktreeId: string
  worktreePath: string
  relativePath: string
  runtimeEnvironmentId: string | null
}

export type WatchedTargetsSnapshot = {
  targets: WatchedTarget[]
  targetsKey: string
}

export type EditorExternalWatchTargetState = Pick<
  AppState,
  | 'openFiles'
  | 'worktreesByRepo'
  | 'repos'
  | 'activeWorktreeId'
  | 'settings'
  | 'rightSidebarOpen'
  | 'rightSidebarTab'
  | 'rightSidebarExplorerView'
  | 'gitStatusHugeByWorktree'
  | 'sshConnectionStates'
>

let cachedOpenFiles: AppState['openFiles'] | null = null
let cachedWorktreesByRepo: AppState['worktreesByRepo'] | null = null
let cachedRepos: AppState['repos'] | null = null
let cachedActiveWorktreeId: string | null = null
let cachedRuntimeEnvironmentId: string | undefined
let cachedRightSidebarOpen: boolean | null = null
let cachedRightSidebarTab: AppState['rightSidebarTab'] | null = null
let cachedRightSidebarExplorerView: AppState['rightSidebarExplorerView'] | null = null
let cachedGitStatusHugeByWorktree: AppState['gitStatusHugeByWorktree'] | null = null
let cachedSshConnectionStates: AppState['sshConnectionStates'] | null = null
let cachedWatchedTargetsSnapshot: WatchedTargetsSnapshot = { targets: [], targetsKey: '' }

export function getWatchedTargetKey(target: WatchedTarget): string {
  // Why: include connectionId so a local placeholder watch is replaced by the real SSH watch once an SSH worktree's provider metadata hydrates.
  return `${target.worktreeId}::${target.worktreePath}::${target.connectionId ?? 'local'}::${target.runtimeEnvironmentId ?? 'client'}`
}

export function openFileRuntimeOwner(file: Pick<OpenFile, 'runtimeEnvironmentId'>): string | null {
  return file.runtimeEnvironmentId?.trim() || null
}

export function getEditorExternalWatchTargets(
  state: EditorExternalWatchTargetState
): WatchedTargetsSnapshot {
  const runtimeEnvironmentId = state.settings?.activeRuntimeEnvironmentId?.trim() || undefined
  if (
    cachedOpenFiles === state.openFiles &&
    cachedWorktreesByRepo === state.worktreesByRepo &&
    cachedRepos === state.repos &&
    cachedActiveWorktreeId === state.activeWorktreeId &&
    cachedRuntimeEnvironmentId === runtimeEnvironmentId &&
    cachedRightSidebarOpen === state.rightSidebarOpen &&
    cachedRightSidebarTab === state.rightSidebarTab &&
    cachedRightSidebarExplorerView === state.rightSidebarExplorerView &&
    cachedGitStatusHugeByWorktree === state.gitStatusHugeByWorktree &&
    cachedSshConnectionStates === state.sshConnectionStates
  ) {
    return cachedWatchedTargetsSnapshot
  }

  const targetOwnersByWorktreeId = new Map<string, Set<string | null>>()
  // Why: watcher ownership is scoped by worktree + runtime owner — the same path can be open locally and in a runtime workspace, and reads/saves already route per owner.
  for (const f of state.openFiles) {
    let owners = targetOwnersByWorktreeId.get(f.worktreeId)
    if (!owners) {
      owners = new Set()
      targetOwnersByWorktreeId.set(f.worktreeId, owners)
    }
    // Why: persisted/restored tabs may have runtimeEnvironmentId undefined; new openFile calls resolve inheritance before storing, so an ownerless tab stays local.
    owners.add(openFileRuntimeOwner(f))
  }
  const activeWorktreeId = state.activeWorktreeId
  const activeWorktree = activeWorktreeId
    ? findWorktreeById(state.worktreesByRepo, activeWorktreeId)
    : undefined
  const activeRepo = activeWorktree
    ? state.repos.find((repo) => repo.id === activeWorktree.repoId)
    : undefined
  const sourceControlCanConsumeWatch =
    !!activeWorktreeId &&
    !!activeRepo &&
    isGitRepoKind(activeRepo) &&
    !state.gitStatusHugeByWorktree[activeWorktreeId] &&
    (!activeRepo.connectionId ||
      state.sshConnectionStates.get(activeRepo.connectionId)?.status === 'connected')
  const activeWorktreeNeedsSidebarWatch =
    activeWorktreeId !== null &&
    state.rightSidebarOpen &&
    ((state.rightSidebarTab === 'explorer' && state.rightSidebarExplorerView === 'files') ||
      (state.rightSidebarTab === 'source-control' && sourceControlCanConsumeWatch))
  if (activeWorktreeNeedsSidebarWatch) {
    // Why: this app-level watcher owns Explorer/Source-Control subscriptions so downstream consumers don't fight over watch/unwatch IPC.
    let owners = targetOwnersByWorktreeId.get(activeWorktreeId)
    if (!owners) {
      owners = new Set()
      targetOwnersByWorktreeId.set(activeWorktreeId, owners)
    }
    // Why: sidebar watcher must follow the selected worktree's host owner, not the host currently focused in the UI.
    owners.add(getRuntimeEnvironmentIdForWorktree(state, activeWorktreeId))
  }

  const nextTargets: WatchedTarget[] = []
  const parts: string[] = []
  const sortedWorktreeIds = Array.from(targetOwnersByWorktreeId.keys()).sort()
  for (const id of sortedWorktreeIds) {
    const wt = findWorktreeById(state.worktreesByRepo, id)
    if (!wt) {
      continue
    }
    const repo = state.repos.find((r) => r.id === wt.repoId)
    const owners = Array.from(targetOwnersByWorktreeId.get(id) ?? []).sort((a, b) =>
      (a ?? '').localeCompare(b ?? '')
    )
    for (const owner of owners) {
      const target = {
        worktreeId: id,
        worktreePath: wt.path,
        connectionId: repo?.connectionId ?? undefined,
        runtimeEnvironmentId: owner
      }
      nextTargets.push(target)
      parts.push(getWatchedTargetKey(target))
    }
  }

  const targetsKey = parts.join('|')
  cachedOpenFiles = state.openFiles
  cachedWorktreesByRepo = state.worktreesByRepo
  cachedRepos = state.repos
  cachedActiveWorktreeId = state.activeWorktreeId
  cachedRuntimeEnvironmentId = runtimeEnvironmentId
  cachedRightSidebarOpen = state.rightSidebarOpen
  cachedRightSidebarTab = state.rightSidebarTab
  cachedRightSidebarExplorerView = state.rightSidebarExplorerView
  cachedGitStatusHugeByWorktree = state.gitStatusHugeByWorktree
  cachedSshConnectionStates = state.sshConnectionStates

  if (targetsKey === cachedWatchedTargetsSnapshot.targetsKey) {
    return cachedWatchedTargetsSnapshot
  }

  cachedWatchedTargetsSnapshot = { targets: nextTargets, targetsKey }
  return cachedWatchedTargetsSnapshot
}

// Why: macOS atomic writes split delete→create across payloads; debounce the 'deleted' signal so a same-path create cancels the tombstone before it paints. Key by owner+path so a local and runtime tab for the same file can't cancel each other's tombstones.
