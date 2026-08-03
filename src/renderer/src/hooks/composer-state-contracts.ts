import { getDefaultRepoHookSettings } from '../../../shared/constants'
import {
  getLinkedWorkItemProvider,
  getLinkedWorkItemSuggestedName,
  getLinkedWorkItemWorkspaceName,
  type LinkedWorkItemSummary,
  type SetupConfig
} from '@/lib/new-workspace'
import { resolveGitHubWorkItemIdentity, type GitHubWorkItemIdentity } from '@/lib/github-work-item-identity'
import { isWorkItemLookupText } from '@/lib/work-item-lookup-text'
import { isWorkspaceLinkedItemSourceContextMatch } from '../../../shared/workspace-linked-item-source-context'
import { normalizeExecutionHostId, type ExecutionHostId } from '../../../shared/execution-host'
import type { SmartGitHubSubmitResolution } from '@/lib/smart-github-submit'
import type {
  GitHubPrStartPoint,
  GitHubWorkItem,
  GitLabWorkItem,
  GitPushTarget,
  JiraIssue,
  LinearIssue,
  OrcaHooks,
  RepoHookSettings,
  SetupAgentStartupPolicy,
  SparsePreset,
  TuiAgent,
  WorkspaceCreateTelemetrySource,
  WorkspaceStatus
} from '../../../shared/types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { SshConnectionStatus } from '../../../shared/ssh-types'
import type { SmartNameMode } from '@/components/new-workspace/smart-workspace-source-results'
import type { SmartWorkspaceNameSelection } from '@/components/new-workspace/SmartWorkspaceNameField'
import type { ProjectHostSetupOption } from '@/lib/project-host-setup-options'
import type { NewWorkspaceProjectOption } from '@/lib/new-workspace-project-options'
import type { WorkspaceCreateErrorDisplay } from '@/lib/workspace-create-error-format'

export type PendingSmartGitHubSubmitResolution =
  | { kind: 'none' }
  | (SmartGitHubSubmitResolution & { kind: 'metadata-only' })
  | (SmartGitHubSubmitResolution & {
      kind: 'pr-start-point'
      baseBranch: string
      compareBaseRef?: string
      pushTarget?: GitPushTarget
      branchNameOverride?: string
    })

export type SmartGitHubPrStartPointSelection = {
  repoId: string
  item: GitHubWorkItem
  resolved?: GitHubPrStartPoint
}

export type UseComposerStateOptions = {
  initialRepoId?: string
  initialEphemeralVmRecipeId?: string
  initialProjectGroupId?: string
  initialName?: string
  initialPrompt?: string
  initialLinkedWorkItem?: LinkedWorkItemSummary | null
  initialTaskSourceContext?: TaskSourceContext | null
  initialWorkspaceStatus?: WorkspaceStatus
  /** Seeds the Start-from selection on open; the Create-from → Quick fallback uses it so a PR pick lands with the resolved PR head as base. */
  initialBaseBranch?: string
  /** The full-page composer persists drafts across navigation; the transient quick-composer modal must not clobber that draft. */
  persistDraft: boolean
  /** Invoked after a successful createWorktree; the caller usually closes its surface (palette modal, full page, etc.). */
  onCreated?: () => void
  /** External repoId override — used by TaskPage's work-item list, which drives repo selection from the page header, not the card. */
  repoIdOverride?: string
  onRepoIdOverrideChange?: (value: string) => void
  /** Telemetry surface that opened this composer; threaded into createWorktree so workspace_created.source reflects the entry point. Defaults to unknown. */
  telemetrySource?: WorkspaceCreateTelemetrySource
  /** Quick-create skips the issueCommand probe (no automation), which the full composer needs for linked-item prompt previews. */
  enableIssueAutomation?: boolean
  createGateMode?: 'full' | 'quick'
}

export type ComposerCardProps = {
  eligibleRepos: ReturnType<typeof import('@/store').useAppStore.getState>['repos']
  repoId: string
  projectOptions: NewWorkspaceProjectOption[]
  selectedProjectId: string | null
  selectedRepoIsGit: boolean
  onRepoChange: (value: string) => void
  onProjectChange: (value: string) => void
  projectHostSetupOptions: ProjectHostSetupOption[]
  selectedProjectHostSetupId: string | null
  onProjectHostSetupChange: (setupId: string) => void
  ephemeralVmRecipes: NonNullable<OrcaHooks['environmentRecipes']>
  selectedEphemeralVmRecipeId: string | null
  onEphemeralVmRecipeChange: (recipeId: string | null) => void
  ephemeralVmRecipeError: string | null
  repoBackedSearchRepos?: ReturnType<typeof import('@/store').useAppStore.getState>['repos']
  repoBackedSourcesDisabled?: boolean
  allowSmartNameAddProject?: boolean
  smartNameRepoSwitchTarget?: 'project' | 'task-source'
  name: string
  onNameValueChange: (value: string) => void
  branchNameOverride: string | undefined
  onBranchNameOverrideChange: (value: string | undefined) => void
  onSmartGitHubItemSelect: (item: GitHubWorkItem) => void
  onSmartGitLabItemSelect: (item: GitLabWorkItem) => void
  onSmartBranchSelect: (refName: string, localBranchName: string) => void
  onSmartNameModeChange?: (mode: SmartNameMode) => void
  onSmartLinearIssueSelect: (issue: LinearIssue) => void
  onSmartJiraIssueSelect: (issue: JiraIssue, sourceContext: TaskSourceContext) => void
  onOpenJiraSettings: () => void
  smartNameGitHubSourceContext?: TaskSourceContext | null
  smartNameJiraSourceContext?: TaskSourceContext | null
  /** GitLab parallel of onBaseBranchPrSelect. */
  onBaseBranchMrSelect?: (
    baseBranch: string,
    item: GitLabWorkItem,
    pushTarget?: GitPushTarget,
    compareBaseRef?: string
  ) => void
  smartNameSelection: SmartWorkspaceNameSelection | null
  onClearSmartNameSelection: () => void
  /** True when the selected source is an existing LOCAL branch that can be reused (checked out) — gates the reuse checkbox. */
  canReuseSelectedBranch: boolean
  /** Whether the selected existing local branch is reused (checked out) rather than branched from. */
  reuseSelectedBranch: boolean
  onReuseSelectedBranchChange: (next: boolean) => void
  /** Whether the "create multiple" toggle shows — worktree (git) targets only; folder workspaces create-and-close. */
  showCreateMultiple: boolean
  /** When on, the modal stays open after each create and resets identity fields to allow creating several in a row. */
  createMultiple: boolean
  onCreateMultipleChange: (next: boolean) => void
  agentPrompt: string
  onAgentPromptChange: (value: string) => void
  /** Rendered issueCommand template previewed in the empty prompt when a work item is linked but nothing typed. */
  linkedOnlyTemplatePreview: string | null
  attachmentPaths: string[]
  getAttachmentLabel: (pathValue: string) => string
  onAddAttachment: () => void
  onRemoveAttachment: (pathValue: string) => void
  linkedWorkItem: LinkedWorkItemSummary | null
  onRemoveLinkedWorkItem: () => void
  linkPopoverOpen: boolean
  onLinkPopoverOpenChange: (open: boolean) => void
  linkQuery: string
  onLinkQueryChange: (value: string) => void
  filteredLinkItems: GitHubWorkItem[]
  linkItemsLoading: boolean
  linkDirectLoading: boolean
  normalizedLinkQuery: { query: string }
  onSelectLinkedItem: (item: GitHubWorkItem) => void
  tuiAgent: TuiAgent
  onTuiAgentChange: (value: TuiAgent) => void
  detectedAgentIds: Set<TuiAgent> | null
  onOpenAgentSettings: () => void
  advancedOpen: boolean
  onToggleAdvanced: () => void
  createDisabled: boolean
  projectError: string | null
  creating: boolean
  onCreate: () => void
  note: string
  onNoteChange: (value: string) => void
  baseBranch: string | undefined
  onBaseBranchChange: (next: string | undefined) => void
  /** Called when a PR is selected in the Start-from picker; updates baseBranch and linkedWorkItem/linkedPR in one pass. */
  onBaseBranchPrSelect: (
    baseBranch: string,
    item: GitHubWorkItem,
    pushTarget?: GitPushTarget,
    branchNameOverride?: string,
    compareBaseRef?: string
  ) => void
  /** PR number selected via the Start-from picker, so the field can render "PR #N" copy. */
  baseBranchLinkedPrNumber: number | null
  /** Absolute path of the selected repo, used by Start-from picker for SWR. */
  selectedRepoPath: string | null
  /** True when the selected repo is a remote SSH repo. */
  selectedRepoIsRemote: boolean
  selectedRepoConnectionId: string | null
  selectedRepoSshStatus: SshConnectionStatus | null
  selectedRepoRequiresConnection: boolean
  selectedRepoConnectInProgress: boolean
  onConnectSelectedRepo: () => Promise<void>
  branchesEnabled?: boolean
  /** Inline hint next to the Start-from trigger after a repo switch resets a prior selection (e.g. "was PR #8778"). Null when none. */
  startFromResetHint: string | null
  /** Warning when a selected fork PR has "Allow edits from maintainers" off, so a push may be rejected. Null when none. */
  forkPushWarning: string | null
  setupConfig: SetupConfig | null
  setupControlsEnabled?: boolean
  requiresExplicitSetupChoice: boolean
  setupDecision: 'run' | 'skip' | null
  onSetupDecisionChange: (value: 'run' | 'skip') => void
  setupAgentStartupPolicy: SetupAgentStartupPolicy
  onSetupAgentStartupPolicyChange: (value: SetupAgentStartupPolicy) => void
  shouldWaitForSetupCheck: boolean
  resolvedSetupDecision: 'run' | 'skip' | null
  createError: WorkspaceCreateErrorDisplay | null
  canUseSparseCheckout: boolean
  /** Saved sparse presets for the selected repo; empty when none exist or the repo is remote. */
  sparsePresets: SparsePreset[]
  /** ID of the selected sparse preset. Null means sparse checkout is off. */
  sparseSelectedPresetId: string | null
  onSparseSelectPreset: (preset: SparsePreset | null) => void
  sparseControlsEnabled?: boolean
}

export type UseComposerStateResult = {
  cardProps: ComposerCardProps
  /** Attach to the composer wrapper so the global Enter-to-submit handler scopes to the visible composer. */
  composerRef: React.RefObject<HTMLDivElement | null>
  onComposerNodeChange: (node: HTMLDivElement | null) => void
  promptTextareaRef: React.RefObject<HTMLTextAreaElement | null>
  nameInputRef: React.RefObject<HTMLInputElement | null>
  submit: () => Promise<void>
  submitQuick: (agent: TuiAgent | null) => Promise<void>
  /** Invoked by the Enter handler to re-check whether submission should fire. */
  createDisabled: boolean
  /** Selects the repo a nested Add Project flow just added, clearing any folder-group target so the composer lands on it. */
  selectAddedProjectRepo: (repoId: string) => void
}

export type InitialWorkspaceRunSeedInput = {
  draftProjectId?: string | null
  draftHostId?: string | null
  draftProjectHostSetupId?: string | null
  initialTaskSourceContext?: Pick<
    TaskSourceContext,
    'projectId' | 'hostId' | 'projectHostSetupId'
  > | null
}

export function getRepoSetupAgentStartupPolicy(repo?: {
  hookSettings?: Pick<RepoHookSettings, 'setupAgentStartupPolicy'>
}): SetupAgentStartupPolicy {
  return repo?.hookSettings?.setupAgentStartupPolicy ?? 'start-immediately'
}

export function buildSetupAgentStartupHookSettings(
  current: RepoHookSettings | undefined,
  setupAgentStartupPolicy: SetupAgentStartupPolicy
): RepoHookSettings {
  const defaults = getDefaultRepoHookSettings()
  return {
    ...defaults,
    ...current,
    setupRunPolicy: current?.setupRunPolicy ?? defaults.setupRunPolicy,
    setupAgentStartupPolicy,
    commandSourcePolicy: current?.commandSourcePolicy ?? defaults.commandSourcePolicy,
    scripts: {
      ...defaults.scripts,
      ...current?.scripts
    }
  }
}

export function resolveInitialWorkspaceRunSeed({
  draftProjectId,
  draftHostId,
  draftProjectHostSetupId,
  initialTaskSourceContext
}: InitialWorkspaceRunSeedInput): {
  projectId: string | null
  hostId: ExecutionHostId | null
  projectHostSetupId: string | null
} {
  return {
    projectId: draftProjectId ?? initialTaskSourceContext?.projectId ?? null,
    hostId: normalizeExecutionHostId(draftHostId ?? initialTaskSourceContext?.hostId),
    projectHostSetupId:
      draftProjectHostSetupId ?? initialTaskSourceContext?.projectHostSetupId ?? null
  }
}

export function isExplicitWorkspaceNameInput({
  name,
  lastAutoName
}: {
  name: string
  lastAutoName: string
}): boolean {
  // Why: a user-authored name must win over linked-item and first-message AI naming.
  return Boolean(name.trim()) && name !== lastAutoName && !isWorkItemLookupText(name)
}

export function resolveSmartGitHubCreateNames({
  resolutionKind,
  smartWorkspaceName,
  smartDisplayName,
  fallbackWorkspaceName,
  nameIsAutoManaged
}: {
  resolutionKind: Exclude<PendingSmartGitHubSubmitResolution['kind'], 'none'>
  smartWorkspaceName: string
  smartDisplayName: string
  fallbackWorkspaceName: string
  nameIsAutoManaged: boolean
}): { workspaceName: string; displayName: string | undefined } {
  if (resolutionKind === 'pr-start-point' && !nameIsAutoManaged && fallbackWorkspaceName) {
    // Why: submit-time PR start-point augments an already-linked PR; don't reclaim a name the user edited after selecting.
    return { workspaceName: fallbackWorkspaceName, displayName: undefined }
  }
  return { workspaceName: smartWorkspaceName, displayName: smartDisplayName }
}

function getLinkedWorkItemSeedName(item: LinkedWorkItemSummary | null | undefined): string {
  if (!item) {
    return ''
  }
  return getLinkedWorkItemWorkspaceName(item)?.seedName ?? getLinkedWorkItemSuggestedName(item)
}

export function getGitHubLinkedWorkItemIdentity(
  item: LinkedWorkItemSummary | null | undefined
): GitHubWorkItemIdentity | null {
  if (
    !item ||
    getLinkedWorkItemProvider(item) !== 'github' ||
    (item.type !== 'issue' && item.type !== 'pr')
  ) {
    return null
  }

  return resolveGitHubWorkItemIdentity({
    type: item.type,
    number: item.number,
    url: item.url
  })
}

export function normalizeGitHubLinkedWorkItem(
  item: LinkedWorkItemSummary | null | undefined
): LinkedWorkItemSummary | null {
  if (!item) {
    return null
  }
  const identity = getGitHubLinkedWorkItemIdentity(item)
  if (!identity || (identity.type === item.type && identity.number === item.number)) {
    return item
  }

  return { ...item, type: identity.type, number: identity.number }
}

export function getMatchingLinkedTaskSourceContext(
  item: LinkedWorkItemSummary | null | undefined,
  context: TaskSourceContext | null | undefined
): TaskSourceContext | null {
  return isWorkspaceLinkedItemSourceContextMatch(item, context) ? (context ?? null) : null
}

export function getInitialAutoManagedWorkspaceName({
  draftName,
  draftLinkedWorkItem,
  initialName,
  initialLinkedWorkItem
}: {
  draftName?: string | null
  draftLinkedWorkItem?: LinkedWorkItemSummary | null
  initialName: string
  initialLinkedWorkItem?: LinkedWorkItemSummary | null
}): string {
  // Why: a prefilled name counts as user input unless it exactly matches the linked-item seed Orca generated.
  const candidateName = draftName ?? initialName
  const seedName = getLinkedWorkItemSeedName(draftLinkedWorkItem ?? initialLinkedWorkItem)
  return candidateName && seedName && candidateName === seedName ? candidateName : ''
}

export function canResolveFolderSmartGitHubSubmit({
  hasFolderSourceRepos
}: {
  hasFolderSourceRepos: boolean
}): boolean {
  return hasFolderSourceRepos
}
