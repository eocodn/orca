import type { ExecutionHostId } from './execution-host'
import type { GitRemoteIdentity } from './git-remote-identity'
import type { ForkSyncMode } from './git-fork-sync'
import type { RepoIcon } from './repo-icon'
import type { RepoSourceControlAiOverrides } from './source-control-ai-types'
import type { LocalWindowsRuntimePreference } from './project-execution-runtime'
import type { TaskSourceContext } from './task-source-context'
import type { GitHubRepositoryIdentity } from './types-github-review'
import type { RepoHookSettings } from './types-hooks'
import type { WorkspaceStatus } from './types-worktree'
import type { TuiAgent } from './types-settings-accounts'

// ─── Shell PATH hydration ────────────────────────────────────────────
// Why: shared so the main-side `HydrationResult` discriminator and the
// telemetry schema in `telemetry-events.ts` stay in lockstep without
// `src/shared/` taking a forbidden import from `src/main/`. A compile-time
// guard in telemetry-events.ts asserts the schema enum matches this alias —
// adding a new failure mode without updating both places fails the build.
export type ShellHydrationFailureReason =
  | 'none'
  | 'no_shell'
  | 'timeout'
  | 'spawn_error'
  | 'empty_path'

export type PathSource = 'shell_hydrate' | 'sync_seed_only'

// ─── Repo ────────────────────────────────────────────────────────────
export type RepoKind = 'git' | 'folder'

/**
 * Per-repo user choice for where issues are fetched and filed.
 *
 * Why three states, not two: storage must distinguish "user explicitly chose
 * upstream" from "heuristic happens to resolve to upstream right now." Collapsing
 * the two would let a remote-topology change (someone removes `upstream`, or
 * adds one later) silently move the effective source — the exact silent-source-
 * switch class the upstream-issue-source design rejects.
 *
 * - `'auto'` (or undefined): honor the heuristic in `getIssueOwnerRepo`
 *   (upstream-if-exists, else origin). Initial state for every repo.
 * - `'upstream'`: explicit upstream. Wins over heuristic and future topology
 *   changes. Falls back to origin if `upstream` remote vanishes, with a toast.
 * - `'origin'`: explicit origin. Same precedence.
 */
export type IssueSourcePreference = 'upstream' | 'origin' | 'auto'
export type { ForkSyncMode, GitForkSyncExpectedUpstream, GitForkSyncResult } from './git-fork-sync'
export type ExternalWorktreeVisibility = 'hide' | 'show'

export type ProjectProviderIdentity = {
  provider: 'github'
  owner: string
  repo: string
  host?: string
}

export type Project = {
  id: string
  displayName: string
  badgeColor: string
  repoIcon?: RepoIcon | null
  kind?: RepoKind
  providerIdentity?: ProjectProviderIdentity
  gitRemoteIdentity?: GitRemoteIdentity
  /** Local Windows projects inherit the global runtime default unless this override is set. */
  localWindowsRuntimePreference?: LocalWindowsRuntimePreference
  sourceRepoIds: string[]
  createdAt: number
  updatedAt: number
}

export type ProjectUpdateArgs = {
  projectId: string
  updates: Partial<Pick<Project, 'localWindowsRuntimePreference'>>
}

export type ProjectHostSetupState = 'ready' | 'not-set-up' | 'setting-up' | 'error' | 'unsupported'
export type ProjectHostSetupMethod =
  | 'legacy-repo'
  | 'imported-existing-folder'
  | 'cloned'
  | 'provisioned'
export type RepoProjectHostSetupMethod = Extract<
  ProjectHostSetupMethod,
  'imported-existing-folder' | 'cloned'
>

export type ProjectHostSetup = {
  id: string
  projectId: string
  hostId: ExecutionHostId
  repoId: string
  path: string
  displayName: string
  kind?: RepoKind
  connectionId?: string | null
  executionHostId?: ExecutionHostId | null
  /** Renderer projection of the paired runtime that owns this setup's transport. */
  runtimeOwnerEnvironmentId?: string
  worktreeBasePath?: string
  hookSettings?: RepoHookSettings
  gitUsername?: string
  setupState: ProjectHostSetupState
  setupMethod: ProjectHostSetupMethod
  sourceControlAi?: RepoSourceControlAiOverrides
  createdAt: number
  updatedAt: number
}

export type ProjectHostSetupExistingFolderArgs = {
  projectId: string
  projectProviderIdentity?: ProjectProviderIdentity
  hostId: ExecutionHostId
  path: string
  kind?: RepoKind
  displayName?: string
  setupMethod?: RepoProjectHostSetupMethod
}

export type ProjectHostSetupCreateArgs = {
  projectId: string
  hostId: ExecutionHostId
  setupId?: string
  path?: string
  kind?: RepoKind
  displayName?: string
  worktreeBasePath?: string
  gitUsername?: string
  setupState?: ProjectHostSetupState
  setupMethod?: Exclude<ProjectHostSetupMethod, 'legacy-repo'>
}

export type ProjectHostSetupCloneArgs = {
  projectId: string
  projectProviderIdentity?: ProjectProviderIdentity
  hostId: ExecutionHostId
  url: string
  destination: string
  displayName?: string
}

export type ProjectHostSetupUpdateArgs = {
  setupId: string
  updates: Partial<
    Pick<
      ProjectHostSetup,
      | 'displayName'
      | 'path'
      | 'worktreeBasePath'
      | 'setupState'
      | 'setupMethod'
      | 'gitUsername'
      | 'kind'
    >
  >
}

export type ProjectHostSetupDeleteArgs = {
  setupId: string
}

export type ProjectHostSetupResult = {
  project: Project
  setup: ProjectHostSetup
  repo: Repo
}

export type ProjectHostSetupCreateResult = {
  project: Project
  setup: ProjectHostSetup
}

export type ProjectHostSetupUpdateResult = {
  project: Project
  setup: ProjectHostSetup
  repo?: Repo
}

export type ProjectHostSetupDeleteResult = {
  project: Project
  setup: ProjectHostSetup
  repo?: Repo
}

export type Repo = {
  id: string
  path: string
  displayName: string
  badgeColor: string
  repoIcon?: RepoIcon | null
  /** Set when the repo is a fork: the upstream/parent owner/repo. Drives the
   *  default avatar (upstream owner, not the personal fork) and the fork
   *  indicator. Absent = not a fork, or fork status not yet resolved. */
  upstream?: GitHubRepositoryIdentity | null
  addedAt: number
  kind?: RepoKind
  gitUsername?: string
  worktreeBaseRef?: string
  /** Optional repo-scoped workspace root override. Relative paths resolve from `path`. */
  worktreeBasePath?: string
  hookSettings?: RepoHookSettings
  /** SSH target ID for remote repos. null/undefined = local. */
  connectionId?: string | null
  /**
   * Explicit execution owner for this repo. Runtime-host repos need this
   * because they otherwise look identical to local repos (`connectionId: null`).
   */
  executionHostId?: 'local' | `ssh:${string}` | `runtime:${string}` | null
  /** Per-repo override for issue-source resolution. `undefined` is treated
   *  identically to `'auto'`; writers leave it undefined on creation so
   *  existing persisted records stay forward-compatible. */
  issueSourcePreference?: IssueSourcePreference
  /** Controls Orca's fork-default-branch sync offer for repos with upstream metadata. */
  forkSyncMode?: ForkSyncMode
  /** Canonical identity for the repo remote Orca should use for provider-level grouping. */
  gitRemoteIdentity?: GitRemoteIdentity | null
  /** Controls whether worktrees Orca did not create appear in the sidebar. */
  externalWorktreeVisibility?: ExternalWorktreeVisibility
  /** True when the repo predates hidden-by-default external worktrees. */
  externalWorktreeVisibilityLegacy?: boolean
  /** One-shot guard for the optional existing-user visibility prompt. */
  externalWorktreeVisibilityPromptDismissedAt?: number
  /** Hidden external worktree paths acknowledged by Keep hidden on the inbox. */
  externalWorktreeInboxBaselinePaths?: string[]
  /** External worktree paths explicitly imported while global visibility stays hide. */
  importedExternalWorktreePaths?: string[]
  /** User permanently opted out of the new-external-worktree inbox for this repo. */
  externalWorktreeDiscoverySuppressedAt?: number
  /** Paths (relative to the primary checkout) that should be APFS clone-copied
   *  on macOS when possible, otherwise symlinked, into newly created worktrees.
   *  Undefined/empty means no shared paths are created for this repo. */
  symlinkPaths?: string[]
  /** Durable sidebar-only repo organization. Execution remains repo-scoped. */
  projectGroupId?: string | null
  /** User-authored ordering inside the project group or ungrouped bucket. */
  projectGroupOrder?: number
  /** Repo-specific source-control AI overrides. Missing fields inherit global settings. */
  sourceControlAi?: RepoSourceControlAiOverrides
  /** Transitional source for ProjectHostSetup.setupMethod while Repo remains compatibility storage. */
  projectHostSetupMethod?: RepoProjectHostSetupMethod
}

export type ProjectGroupCreatedFrom = 'manual' | 'folder-scan' | 'migration'

export type ProjectGroup = {
  id: string
  name: string
  parentPath: string | null
  /** SSH target ID for folder-backed groups imported from a remote root. */
  connectionId?: string | null
  /** Renderer-owned host stamp for groups fetched from a runtime environment. */
  executionHostId?: string | null
  parentGroupId: string | null
  createdFrom: ProjectGroupCreatedFrom
  tabOrder: number
  isCollapsed: boolean
  color: string | null
  createdAt: number
  updatedAt: number
}

export type WorkspaceScope =
  | { type: 'worktree'; worktreeId: string }
  | { type: 'folder'; folderWorkspaceId: string }

export type WorkspaceKey = `worktree:${string}` | `folder:${string}`

export type FolderWorkspace = {
  id: string
  /** Stable caller identity for replay-safe creation; never reused for another payload. */
  creationOperationId?: string
  /** Canonical create payload bound to creationOperationId for conflict detection. */
  creationFingerprint?: string
  projectGroupId: string
  name: string
  folderPath: string
  /** SSH target ID for folder workspaces whose folder path lives remotely. */
  connectionId?: string | null
  /** Renderer-owned host stamp for host-qualified folder catalogs. */
  executionHostId?: ExecutionHostId | null
  linkedTask: WorkspaceLinkedItem | null
  linkedTaskSourceContext?: TaskSourceContext | null
  comment: string
  isArchived: boolean
  isUnread: boolean
  isPinned: boolean
  sortOrder: number
  /** User-authored sidebar ordering. Higher values render earlier in Manual sort. */
  manualOrder?: number
  workspaceStatus?: WorkspaceStatus
  createdWithAgent?: TuiAgent
  pendingFirstAgentMessageRename?: boolean
  firstAgentMessageRenameError?: string | null
  lastActivityAt: number
  createdAt: number
  updatedAt: number
}

export type WorkspaceLinkedItem = {
  provider: 'github' | 'gitlab' | 'linear' | 'jira'
  type: 'issue' | 'pr' | 'mr'
  number: number
  title: string
  url: string
  linearIdentifier?: string
  jiraIdentifier?: string
  repoId?: string
}

export type FolderWorkspaceLinkedTask = WorkspaceLinkedItem

export type NestedRepoScanOptions = {
  maxDepth?: number
  maxRepos?: number
  timeoutMs?: number | null
}

export type NestedRepoCandidate = {
  path: string
  displayName: string
  depth: number
}

export type NestedRepoScanResult = {
  selectedPath: string
  selectedPathKind: 'git_repo' | 'non_git_folder'
  repos: NestedRepoCandidate[]
  truncated: boolean
  timedOut: boolean
  stopped: boolean
  durationMs: number
  maxDepth: number
  maxRepos: number
  timeoutMs: number | null
}

export type ProjectGroupImportMode = 'group' | 'separate'

export type ProjectGroupImportProjectResult = {
  path: string
  projectId?: string
  status: 'imported' | 'already-known' | 'failed'
  error?: string
}

export type ProjectGroupImportResult = {
  group?: ProjectGroup
  projects: ProjectGroupImportProjectResult[]
  importedCount: number
  alreadyKnownCount: number
  failedCount: number
}

export type SetupRunPolicy = 'ask' | 'run-by-default' | 'skip-by-default'
export type SetupAgentStartupPolicy = 'start-immediately' | 'wait-for-setup'
export type SetupDecision = 'inherit' | 'run' | 'skip'
export type HookCommandSourcePolicy = 'shared-only' | 'local-only' | 'run-both'

/**
 * Envelope returned by the `repos:getBaseRefDefault` IPC handler.
 *
 * Why: declared in `shared/` rather than colocated with the handler so the
 * preload bridge and renderer can import the same named type. Before this
 * lived in `src/main/git/repo.ts` — the preload layer cannot import from
 * `src/main/`, which forced three sites to inline the same structural shape
 * and risk silent drift.
 *
 * Why `remoteCount`: BaseRefPicker renders a multi-remote hint when the repo
 * has more than one configured remote; piggybacking the count on this IPC
 * avoids a second round-trip.
 *
 * Why `defaultBaseRef` (not `default`): `default` is a reserved word and is
 * awkward to destructure.
 */
export type BaseRefDefaultResult = {
  defaultBaseRef: string | null
  remoteCount: number
}

export type BaseRefSearchResult = {
  refName: string
  localBranchName: string
}
