import {
  gitExecFileAsync,
  resolveWorktreeAddBaseRef,
  type OrchestrationCompatibilityHostStamp,
  type GitWorktreeInfo,
  type Repo,
  type Worktree,
  type WorktreeLineage,
  type WorkspaceKey,
  type WorktreeLineageWarning,
  type FolderWorkspace,
  type LinearIssueSummary,
  type RuntimeTerminalWait,
  type RuntimeTerminalWaitCondition,
  type RuntimeNativeChatLaunchDraftResolution,
  type RuntimeTerminalDriverState,
  type PtyIncarnationId,
  hasCommitObjectViaGitExec,
  hasWorktreeBaseCommitRef
} from './orca-runtime-imports'

export type TerminalHandleRecord = {
  handle: string
  runtimeId: string
  rendererGraphEpoch: number
  worktreeId: string
  tabId: string
  leafId: string
  ptyId: string | null
  ptyGeneration: number
}

export type OrchestrationCompatibilityTerminalAuthority = {
  runtimeId: string
  terminalHandle: string
  ptyId: string
  worktreeId: string
  processIncarnation: string | null
  paneKey: string | null
  launchTokenHash: string | null
  hostScope:
    | { kind: 'local'; hostId: 'local' }
    | { kind: 'wsl'; hostId: 'local'; distro: string }
    | { kind: 'ssh'; targetId: string }
}

export type OrchestrationCompatibilityCallerAuthority = Readonly<{
  hostScope: OrchestrationCompatibilityTerminalAuthority['hostScope']
  paneKey: string
  terminalHandle: string
  processIncarnation: string
  launchTokenHash: string
}>

export type RestoredOrchestrationAuthorityReceipt = Readonly<{
  ptyId: string
  worktreeId: string
  terminalHandle: string
  paneKey: string
  processIncarnation: string
  hostScope: OrchestrationCompatibilityTerminalAuthority['hostScope']
}>

export type OrchestrationCompatibilitySshAttachmentAuthority = Extract<
  OrchestrationCompatibilityHostStamp,
  { kind: 'ssh' }
>

export type TerminalWaiter = {
  handle: string
  condition: RuntimeTerminalWaitCondition
  resolve: (result: RuntimeTerminalWait) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout | null
  pollInterval: NodeJS.Timeout | null
  abortCleanup: (() => void) | null
}

export type ResolvedWorktree = Worktree & {
  parentWorktreeId: string | null
  childWorktreeIds: string[]
  lineage: WorktreeLineage | null
  git: GitWorktreeInfo
}

export type LinearAgentWriteTarget = {
  issue: LinearIssueSummary
  workspaceId: string
}

export type LinearCreateFieldIntent = {
  stateId?: string
  assigneeId?: string | null
  priority?: number
  estimate?: number | null
  dueDate?: string | null
  labelIds?: string[]
  projectId?: string
}

export const AGENT_HOOK_RUNTIME_ENV_KEYS = [
  'ORCA_AGENT_HOOK_PORT',
  'ORCA_AGENT_HOOK_TOKEN',
  'ORCA_AGENT_HOOK_ENV',
  'ORCA_AGENT_HOOK_VERSION',
  'ORCA_AGENT_HOOK_ENDPOINT'
] as const

export function sameStringSet(left: string[], right: string[]): boolean {
  if (left.length !== right.length) {
    return false
  }
  const rightSet = new Set(right)
  return left.every((value) => rightSet.has(value))
}

export function labelsForIds(
  ids: string[],
  labels: { id?: string | null; name?: string | null; color?: string | null }[]
): { id: string; name: string; color?: string | null }[] {
  return ids.map((id) => {
    const label = labels.find((candidate) => candidate.id === id)
    return {
      id,
      name: label?.name ?? id,
      ...(label?.color ? { color: label.color } : {})
    }
  })
}

export type TerminalWorkspaceLaunchScope = {
  id: string
  path: string
  connectionId: string | null
  repo: Repo | null
  folderWorkspace: FolderWorkspace | null
}

export type WorktreeLineageInput = {
  parentWorkspace?: string
  envParentWorkspace?: string
  parentWorktree?: string
  cwdParentWorktree?: string
  noParent?: boolean
  callerTerminalHandle?: string
}

export type ResolvedWorkspaceParent =
  | {
      type: 'worktree'
      workspaceKey: WorkspaceKey
      worktree: ResolvedWorktree
      instanceId: string | null
    }
  | {
      type: 'folder'
      workspaceKey: WorkspaceKey
      folderWorkspace: FolderWorkspace
      instanceId: string | null
    }

export type WorktreeLineageResolution =
  | {
      kind: 'lineage'
      parent: ResolvedWorkspaceParent
      origin: WorktreeLineage['origin']
      capture: WorktreeLineage['capture']
      createdByTerminalHandle?: string
    }
  | {
      kind: 'none'
      warnings: WorktreeLineageWarning[]
    }

export type RuntimeWorktreeScanResult =
  | { ok: true; worktrees: GitWorktreeInfo[] }
  | { ok: false; worktrees: GitWorktreeInfo[] }

export type WorktreeLineageCandidate = {
  source: 'env-workspace' | 'cwd-context' | 'terminal-context'
  parent: ResolvedWorkspaceParent
}

export class RuntimeLineageError extends Error {
  code: string
  data?: unknown

  constructor(code: string, message: string, data?: unknown) {
    super(message)
    this.code = code
    this.data = data
  }
}

export class WorktreeIdRequiresFullPathError extends Error {
  readonly code = 'worktree_id_requires_full_path'

  constructor() {
    super(
      'Worktree id selectors must use the full <repo-id>::<path> value. Use the id from `orca worktree list --json`, or target by path:<path>, branch:<branch>, or issue:<number>.'
    )
  }
}
export type ResolvedWorktreeSnapshot = {
  worktrees: ResolvedWorktree[]
  platformByRepoId: ReadonlyMap<string, NodeJS.Platform>
}

// Why: notificationSeq is the desktop-assigned monotonic sequence used for
// mobile reconnect catch-up (#8129). It is added on dispatch (and replay) so a
// client can watermark the last event it delivered and request exactly the
// events after it — idempotent, no duplicate local pushes.
export type MobileNotificationDispatchEvent = {
  type: 'notification'
  source: 'agent-task-complete' | 'terminal-bell' | 'test' | 'plugin'
  title: string
  body: string
  worktreeId?: string
  notificationId?: string
  notificationSeq?: number
  notificationEpoch?: string
}

export type RuntimeWorktreeLifecycleEvent =
  | { kind: 'created'; worktreeId: string; path: string; branch: string }
  | { kind: 'removed'; worktreeId: string; path: string }

export type MobileNotificationDismissEvent = {
  type: 'dismiss'
  notificationId: string
  notificationSeq?: number
  notificationEpoch?: string
}

export type MobileNotificationEvent =
  | MobileNotificationDispatchEvent
  | MobileNotificationDismissEvent

// Why: presence-based driver state for the mobile-presence lock. Exactly one
// driver per PTY at any moment. See docs/mobile-presence-lock.md.
//   - `idle`: no mobile subscribers; desktop input flows freely
//   - `desktop`: at least one mobile client subscribed but desktop reclaimed
//      (or all mobile clients are passive `desktop`-mode watchers); desktop
//      input flows freely
//   - `mobile{clientId}`: a mobile client is the active driver; desktop
//      input/resize are dropped server-side and the lock banner is mounted.
//      `clientId` is the most recent mobile actor for this PTY.
export type DriverState = RuntimeTerminalDriverState

export type NativeChatLaunchDraftResolutionTombstone = RuntimeNativeChatLaunchDraftResolution & {
  worktreeId: string
}

export const MAX_NATIVE_CHAT_LAUNCH_DRAFT_RESOLUTION_TOMBSTONES = 200
export const MAX_DELETED_FOLDER_TERMINAL_RETIREMENT_FENCES = 4096
export const MAX_TERMINAL_SURFACE_RETIREMENT_FENCES = 4096

export async function hasLocalWorktreeBaseRef(
  repoPath: string,
  baseRef: string,
  options: { wslDistro?: string } = {}
): Promise<boolean> {
  const refExists = (qualifiedRef: string) =>
    hasWorktreeBaseCommitRef(repoPath, qualifiedRef, options)
  const resolvedBaseRef = await resolveWorktreeAddBaseRef(baseRef, refExists)
  if (resolvedBaseRef !== baseRef) {
    return true
  }
  if (baseRef.startsWith('refs/')) {
    return refExists(baseRef)
  }
  return hasCommitObjectViaGitExec(
    (gitArgs) => gitExecFileAsync(gitArgs, { cwd: repoPath, ...options }),
    baseRef
  )
}

export function makePtyDurableRetirementKey(
  ptyId: string,
  incarnationId: PtyIncarnationId
): string {
  return JSON.stringify([ptyId, incarnationId])
}
