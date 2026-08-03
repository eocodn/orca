/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: composer state synchronizes selected repo metadata, setup policy, issue-command hooks, and provider link lookups from async runtime IPC. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { getAgentLaunchPlatformForRepo } from '@/lib/agent-launch-platform'
import { getAgentCatalog } from '@/lib/agent-catalog'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  parseGitHubIssueOrPRNumber,
  parseGitHubIssueOrPRLink,
  normalizeGitHubLinkQuery
} from '@/lib/github-links'
import { activateAndRevealWorktree, type AgentStartedTelemetry } from '@/lib/worktree-activation'
import { runBackgroundWorktreeCreation } from '@/lib/worktree-creation-flow'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import { buildAgentDraftLaunchPlan, buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import { filterEnabledTuiAgents, isTuiAgentEnabled } from '../../../shared/tui-agent-selection'
import { repoIsRemote } from '../../../shared/agent-launch-remote'
import { resolveLocalWindowsAgentStartupShell } from '../../../shared/windows-terminal-shell'
import { resolveNativeChatSessionOptionDefaults } from '../../../shared/native-chat-session-option-defaults'
import { seedNativeChatAppliedSessionOptions } from '@/components/native-chat/native-chat-session-option-cache'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import { isGitRepoKind } from '../../../shared/repo-kind'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { resolveWorktreeCreateBaseBranch } from '@/runtime/worktree-create-base'
import {
  buildTaskSourceContextFromRepo,
  getTaskSourceRuntimeSettings,
  normalizeTaskSourceContext,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import type {
  GitHubRepositoryIdentity,
  GitHubWorkItem,
  GitPushTarget,
  GitLabWorkItem,
  JiraIssue,
  LinearIssue,
  OrcaHooks,
  SetupAgentStartupPolicy,
  SetupDecision,
  SetupRunPolicy,
  SparsePreset,
  TuiAgent,
  WorktreeMeta,
  ProjectGroup
} from '../../../shared/types'
import { githubRepoIdentityKey } from '../../../shared/github-repository-identity-key'
import { isWorkspaceStatusId } from '../../../shared/workspace-statuses'
import {
  CLIENT_PLATFORM,
  DEFAULT_ISSUE_COMMAND_TEMPLATE,
  buildAgentPromptWithContext,
  canUseIssueCommandForLinkedItemProvider,
  ensureAgentStartupInTerminal,
  getAttachmentLabel,
  getLinkedWorkItemProvider,
  getLinkedWorkItemSuggestedName,
  getLinkedWorkItemWorkspaceName,
  getSetupConfig,
  getWorkspaceSeedName,
  isGitLabIssueUrl,
  PER_REPO_FETCH_LIMIT,
  renderIssueCommandTemplate,
  type LinkedWorkItemSummary,
  type SetupConfig
} from '@/lib/new-workspace'
import {
  getLinkedWorkItemPromptContext,
  resolveQuickCreateLinkedWorkItemPrompt
} from '@/lib/linked-work-item-context'
import { getLocalRepoProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import {
  buildLinearIssueLinkedWorkItem,
  getLinearLinkedWorkItemBranchName,
  isLinearLinkedWorkItem
} from '@/lib/linear-linked-work-item'
import { getLinearIssueWorkspaceName } from '../../../shared/workspace-name'
import {
  getFullComposerCreateDisabled,
  getQuickComposerCreateDisabled
} from '@/lib/new-workspace-create-gates'
import { lookupGitHubWorkItemByOwnerRepoForSource, lookupGitHubWorkItemForSource } from '@/lib/github-work-item-source-lookup'
import { resolveGitHubWorkItemIdentity } from '@/lib/github-work-item-identity'
import { resolveGitHubPrStartPointForRepo } from '@/lib/github-pr-start-point'
import {
  canUseRepoBackedComposerSources,
  getSelectedRepoSshGate,
  isSshConnectInProgress
} from '@/lib/new-workspace-ssh-gate'
import {
  getComposerEligibleRepos,
  resolveComposerActiveRepoId
} from '@/lib/new-workspace-composer-repo'
import {
  resolveWorkspaceCreationRepoId,
  resolveWorkspaceCreationTarget
} from '@/lib/project-host-workspace-target'
import { buildProjectHostSetupOptions } from '@/lib/project-host-setup-options'
import {
  buildNewWorkspaceCreateTargetOptions,
  getProjectGroupIdFromNewWorkspaceOptionId
} from '@/lib/new-workspace-project-options'
import { useDetectedAgents } from '@/hooks/useDetectedAgents'
import { useEphemeralVmRecipeOptions } from '@/hooks/useEphemeralVmRecipeOptions'
import {
  getFolderSourceRepos,
  getLinkedItemDisplayName,
  getSmartNameSelection as getFolderSmartNameSelection,
  toFolderWorkspaceLinkedTask,
  toGitHubLinkedWorkItem,
  toGitLabLinkedWorkItem,
  toLinearLinkedWorkItem
} from '@/components/sidebar/folder-workspace-composer-helpers'
import { useFolderWorkspaceComposerPathStatus } from '@/components/sidebar/folder-workspace-composer-path-status'
import { submitFolderWorkspaceCreate } from '@/components/sidebar/folder-workspace-composer-submit'
import { buildExecutionHostRegistry } from '../../../shared/execution-host-registry'
import { getRepoExecutionHostId, parseExecutionHostId } from '../../../shared/execution-host'
import { getHostDisplayLabelOverrides } from '../../../shared/host-setting-overrides'
import { queueWorkspaceActivationTerminalFocus } from '@/lib/workspace-activation-terminal-focus'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { getSuggestedCreatureName } from '@/components/sidebar/worktree-name-suggestions'
import type { SmartWorkspaceNameSelection } from '@/components/new-workspace/SmartWorkspaceNameField'
import {
  isBlockingJiraUrlIntent,
  type SmartNameMode
} from '@/components/new-workspace/smart-workspace-source-results'
import { getForkPushWarning } from './fork-push-warning'
import {
  buildJiraWorkspaceSource,
  buildWorkspaceSourceSelection,
  shouldApplyWorkspaceSourceAutoName,
  shouldPreserveWorkspaceSourceOnRepoChange
} from '../../../shared/new-workspace/workspace-source'
import { CONTEXTUAL_TOUR_ENABLE_AUTO_WORKSPACE_NAME_EVENT } from '@/components/contextual-tours/contextual-tour-composer-events'
import { ensureHooksConfirmed } from '@/lib/ensure-hooks-confirmed'
import { normalizeSparseDirectoryLines, sparseDirectoriesMatch } from '@/lib/sparse-paths'
import {
  checkRuntimeHooks,
  readRuntimeIssueCommand,
  type HookCheckResult
} from '@/runtime/runtime-hooks-client'
import {
  formatWorkspaceCreateError,
  getWorkspaceCreateErrorToastMessage,
  type WorkspaceCreateErrorDisplay
} from '@/lib/workspace-create-error-format'
import type { SshConnectionStatus } from '../../../shared/ssh-types'
import {
  resolveComposerBranchNameOverrideForCreate,
  resolveComposerBranchPick,
  resolveComposerManualBranchNameChange,
  getComposerRepoWorktreeBranches
} from './composer-branch-selection'
import { translate } from '@/i18n/i18n'
import { useComposerAttachmentActions } from './composer-state-attachment-actions'
import { resolveJiraSourceHostId } from '@/lib/jira-source-host'
import { usePendingSmartGitHubSubmitResolver } from './composer-state-pending-github-submit'
import {
  canResolveFolderSmartGitHubSubmit,
  buildSetupAgentStartupHookSettings,
  getInitialAutoManagedWorkspaceName,
  getMatchingLinkedTaskSourceContext,
  getRepoSetupAgentStartupPolicy,
  getGitHubLinkedWorkItemIdentity,
  isExplicitWorkspaceNameInput,
  normalizeGitHubLinkedWorkItem,
  resolveInitialWorkspaceRunSeed,
  resolveSmartGitHubCreateNames,
  type ComposerCardProps,
  type SmartGitHubPrStartPointSelection,
  type UseComposerStateOptions,
  type UseComposerStateResult
} from './composer-state-contracts'
export {
  canResolveFolderSmartGitHubSubmit,
  getInitialAutoManagedWorkspaceName,
  getMatchingLinkedTaskSourceContext,
  isExplicitWorkspaceNameInput,
  resolveInitialWorkspaceRunSeed,
  resolveSmartGitHubCreateNames
} from './composer-state-contracts'
export type {
  ComposerCardProps,
  InitialWorkspaceRunSeedInput,
  UseComposerStateOptions,
  UseComposerStateResult
} from './composer-state-contracts'

const EMPTY_SPARSE_PRESETS: SparsePreset[] = []

export function useComposerState(options: UseComposerStateOptions): UseComposerStateResult {
  const {
    initialRepoId,
    initialEphemeralVmRecipeId,
    initialName = '',
    initialPrompt = '',
    initialLinkedWorkItem = null,
    initialTaskSourceContext = null,
    initialWorkspaceStatus,
    initialBaseBranch,
    persistDraft,
    onCreated,
    repoIdOverride,
    onRepoIdOverrideChange,
    telemetrySource,
    enableIssueAutomation = true,
    createGateMode = 'full',
    initialProjectGroupId
  } = options

  // Why: fold stable actions into one subscription so store mutations run one equality check.
  const actions = useAppStore(
    useShallow((s) => ({
      setNewWorkspaceDraft: s.setNewWorkspaceDraft,
      clearNewWorkspaceDraft: s.clearNewWorkspaceDraft,
      createWorktree: s.createWorktree,
      updateRepo: s.updateRepo,
      updateWorktreeMeta: s.updateWorktreeMeta,
      createFolderWorkspace: s.createFolderWorkspace,
      setSidebarOpen: s.setSidebarOpen,
      closeModal: s.closeModal,
      openSettingsPage: s.openSettingsPage,
      openSettingsTarget: s.openSettingsTarget,
      setActiveRuntimeEnvironmentPreference: s.setActiveRuntimeEnvironmentPreference,
      prefetchWorktreeCreateBase: s.prefetchWorktreeCreateBase,
      prefetchWorkItems: s.prefetchWorkItems,
      fetchSparsePresets: s.fetchSparsePresets
    }))
  )
  const {
    setNewWorkspaceDraft,
    clearNewWorkspaceDraft,
    createWorktree,
    updateRepo,
    updateWorktreeMeta,
    createFolderWorkspace,
    setSidebarOpen,
    closeModal,
    openSettingsPage,
    openSettingsTarget,
    setActiveRuntimeEnvironmentPreference,
    prefetchWorktreeCreateBase,
    prefetchWorkItems,
    fetchSparsePresets
  } = actions

  const repos = useAppStore((s) => s.repos)
  const projects = useAppStore((s) => s.projects)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const projectHostSetups = useAppStore((s) => s.projectHostSetups)
  const activeRepoId = useAppStore((s) => s.activeRepoId)
  const settings = useAppStore((s) => s.settings)
  const newWorkspaceDraft = useAppStore((s) => s.newWorkspaceDraft)
  const worktreesByRepo = useAppStore((s) => s.worktreesByRepo)
  const sparsePresetsByRepo = useAppStore((s) => s.sparsePresetsByRepo)
  const workspaceStatuses = useAppStore((s) => s.workspaceStatuses)
  const sshConnectionStates = useAppStore((s) => s.sshConnectionStates)
  const sshTargetLabels = useAppStore((s) => s.sshTargetLabels)
  const sshConnectedGeneration = useAppStore((s) => s.sshConnectedGeneration)
  const runtimeEnvironments = useAppStore((s) => s.runtimeEnvironments)
  const runtimeStatusByEnvironmentId = useAppStore((s) => s.runtimeStatusByEnvironmentId)
  const workspaceHostScope = useAppStore((s) => s.workspaceHostScope)
  const eligibleRepos = useMemo(() => getComposerEligibleRepos(repos), [repos])
  // Why: a runtime-owned SSH repo (active right after creating a per-workspace-env) is ineligible; seed from its local same-project sibling, not another project.
  const seedActiveRepoId = useMemo(
    () => resolveComposerActiveRepoId(repos, eligibleRepos, activeRepoId),
    [repos, eligibleRepos, activeRepoId]
  )
  const draftRepoId = persistDraft ? (newWorkspaceDraft?.repoId ?? null) : null
  const draftProjectId = persistDraft ? (newWorkspaceDraft?.projectId ?? null) : null
  const draftProjectGroupId = persistDraft ? (newWorkspaceDraft?.projectGroupId ?? null) : null
  const draftHostId = persistDraft ? (newWorkspaceDraft?.hostId ?? null) : null
  const draftProjectHostSetupId = persistDraft
    ? (newWorkspaceDraft?.projectHostSetupId ?? null)
    : null
  // Why: Tasks can start from non-repo Linear/Jira contexts; seed from the logical project/source host so the modal doesn't fall back to the active repo.
  const initialRunSeed = resolveInitialWorkspaceRunSeed({
    draftProjectId,
    draftHostId,
    draftProjectHostSetupId,
    initialTaskSourceContext
  })
  const resolvedInitialWorkspaceStatus = useMemo(
    () =>
      initialWorkspaceStatus && isWorkspaceStatusId(initialWorkspaceStatus, workspaceStatuses)
        ? initialWorkspaceStatus
        : undefined,
    [initialWorkspaceStatus, workspaceStatuses]
  )

  const resolvedInitialRepoId = resolveWorkspaceCreationRepoId({
    eligibleRepos,
    projects,
    projectHostSetups,
    draftRepoId,
    initialRepoId,
    activeRepoId: seedActiveRepoId,
    projectId: initialRunSeed.projectId,
    hostId: initialRunSeed.hostId,
    projectHostSetupId: initialRunSeed.projectHostSetupId,
    focusedHostScope: workspaceHostScope
  })

  const [internalRepoId, setInternalRepoId] = useState<string>(resolvedInitialRepoId)
  const initialFolderProjectGroupId = initialProjectGroupId ?? draftProjectGroupId
  const initialFolderProjectGroup = projectGroups.find(
    (group) => group.id === initialFolderProjectGroupId && Boolean(group.parentPath?.trim())
  )
  const [selectedProjectGroupId, setSelectedProjectGroupId] = useState<string | null>(
    initialFolderProjectGroup?.id ?? null
  )
  const initialProjectGroupAppliedRef = useRef(Boolean(initialFolderProjectGroup))
  const [projectError, setProjectError] = useState<string | null>(null)
  const repoId = repoIdOverride ?? internalRepoId
  const selectedProjectGroup = useMemo<ProjectGroup | null>(
    () =>
      selectedProjectGroupId
        ? (projectGroups.find(
            (group) => group.id === selectedProjectGroupId && Boolean(group.parentPath?.trim())
          ) ?? null)
        : null,
    [projectGroups, selectedProjectGroupId]
  )
  useEffect(() => {
    if (selectedProjectGroupId && !selectedProjectGroup) {
      setSelectedProjectGroupId(null)
    }
  }, [selectedProjectGroup, selectedProjectGroupId])
  useEffect(() => {
    if (
      selectedProjectGroupId ||
      !initialFolderProjectGroupId ||
      initialProjectGroupAppliedRef.current
    ) {
      return
    }
    const nextGroup = projectGroups.find(
      (group) => group.id === initialFolderProjectGroupId && Boolean(group.parentPath?.trim())
    )
    if (nextGroup) {
      initialProjectGroupAppliedRef.current = true
      setSelectedProjectGroupId(nextGroup.id)
    }
  }, [initialFolderProjectGroupId, projectGroups, selectedProjectGroupId])
  const isProjectGroupTarget = selectedProjectGroup !== null
  const folderSourceRepos = useMemo(
    () => getFolderSourceRepos(repos, projectGroups, selectedProjectGroup),
    [projectGroups, repos, selectedProjectGroup]
  )
  const parsedFolderTargetHost = parseExecutionHostId(selectedProjectGroup?.executionHostId)
  const folderTargetRuntimeEnvironmentId =
    parsedFolderTargetHost?.kind === 'runtime' ? parsedFolderTargetHost.environmentId : null
  const folderTargetConnectionId =
    parsedFolderTargetHost?.kind === 'runtime' ? null : (selectedProjectGroup?.connectionId ?? null)
  const folderTargetIsRemote =
    folderTargetConnectionId !== null || folderTargetRuntimeEnvironmentId !== null
  const folderTargetAgentDetectionTarget = folderTargetRuntimeEnvironmentId
    ? { kind: 'runtime' as const, environmentId: folderTargetRuntimeEnvironmentId }
    : folderTargetConnectionId
      ? { kind: 'ssh' as const, connectionId: folderTargetConnectionId }
      : selectedProjectGroup
        ? { kind: 'local' as const }
        : undefined
  const folderTargetSshState = folderTargetConnectionId
    ? (sshConnectionStates.get(folderTargetConnectionId) ?? null)
    : null
  const {
    selectedRepoSshStatus: folderTargetSshStatus,
    selectedRepoRequiresConnection: folderTargetRequiresConnection,
    selectedRepoConnectInProgress: folderTargetConnectInProgress
  } = getSelectedRepoSshGate({
    connectionId: folderTargetConnectionId,
    status: folderTargetSshState?.status ?? null
  })
  const { pathStatusBlocksCreate: folderPathStatusBlocksCreate, pathStatusProjectError } =
    useFolderWorkspaceComposerPathStatus(
      selectedProjectGroup,
      true,
      folderTargetRuntimeEnvironmentId
    )
  const { detectedIds: folderDetectedIds } = useDetectedAgents(folderTargetAgentDetectionTarget)
  const folderDetectedAgentIds = useMemo<Set<TuiAgent> | null>(
    () => (folderDetectedIds ? new Set(folderDetectedIds) : null),
    [folderDetectedIds]
  )
  const selectedWorkspaceTarget = useMemo(
    () =>
      resolveWorkspaceCreationTarget({
        eligibleRepos,
        projects,
        projectHostSetups,
        draftRepoId: repoId,
        focusedHostScope: workspaceHostScope
      }),
    [eligibleRepos, projectHostSetups, projects, repoId, workspaceHostScope]
  )
  const selectedRepo = eligibleRepos.find((repo) => repo.id === repoId)
  const selectedRepoIsGit = selectedRepo ? isGitRepoKind(selectedRepo) : false
  const selectedRepoAgentLaunchPlatform = useMemo(() => {
    if (!selectedRepo) {
      return CLIENT_PLATFORM
    }
    const projectRuntime = selectedRepo.connectionId
      ? undefined
      : getLocalRepoProjectExecutionRuntimeContext(
          {
            activeRepoId,
            activeWorktreeId: null,
            projects,
            repos,
            settings,
            worktreesByRepo
          },
          selectedRepo.id,
          CLIENT_PLATFORM
        )
    return getAgentLaunchPlatformForRepo(selectedRepo, projectRuntime)
  }, [activeRepoId, projects, repos, selectedRepo, settings, worktreesByRepo])
  // Why: SSH remotes deploy the CLI shim as plain `orca`, so the Linux-only `orca-ide` rename must not apply to remote launch commands.
  const selectedRepoIsRemote = selectedRepo ? repoIsRemote(selectedRepo) : false
  const selectedRepoStartupShell = resolveLocalWindowsAgentStartupShell({
    platform: selectedRepoAgentLaunchPlatform,
    isRemote: selectedRepoIsRemote,
    terminalWindowsShell: settings?.terminalWindowsShell
  })
  const selectedRepoProjectId =
    selectedWorkspaceTarget.status === 'ready' ? selectedWorkspaceTarget.target.projectId : null
  const selectedProjectId = selectedProjectGroup
    ? `project-group:${selectedProjectGroup.id}`
    : selectedRepoProjectId
  const selectedProjectHostSetupId =
    !selectedProjectGroup && selectedWorkspaceTarget.status === 'ready'
      ? selectedWorkspaceTarget.target.projectHostSetupId
      : null
  const hostOptions = useMemo(
    () =>
      buildExecutionHostRegistry({
        repos,
        settings,
        sshTargetLabels,
        sshConnectionStates,
        runtimeEnvironments,
        runtimeStatusByEnvironmentId,
        hostLabelOverrides: getHostDisplayLabelOverrides(settings)
      }),
    [
      repos,
      settings,
      sshConnectionStates,
      sshTargetLabels,
      runtimeEnvironments,
      runtimeStatusByEnvironmentId
    ]
  )
  const projectHostSetupOptions = useMemo(
    () =>
      buildProjectHostSetupOptions({
        projectId: selectedRepoProjectId,
        projectHostSetups,
        eligibleRepos,
        hosts: hostOptions
      }),
    [eligibleRepos, hostOptions, projectHostSetups, selectedRepoProjectId]
  )
  const projectOptions = useMemo(
    () =>
      buildNewWorkspaceCreateTargetOptions({
        projects,
        projectHostSetups,
        eligibleRepos,
        projectGroups,
        hosts: hostOptions
      }),
    [eligibleRepos, hostOptions, projectGroups, projectHostSetups, projects]
  )
  const selectedRepoSettings = useMemo(() => {
    if (!settings) {
      return settings
    }
    // Why: probes and attachment uploads inspect the selected repo, even though creation defaults still follow host scope.
    return getSettingsForRepoRuntimeOwner(
      { repos: selectedRepo ? [selectedRepo] : [], settings },
      selectedRepo?.id ?? null
    )
  }, [selectedRepo, settings])
  // Why: key on repo id, not the repo object — updateRepo replaces it by reference and would re-run this effect, wiping the user's chosen recipe.
  const selectedRecipeRepoId = selectedRepo?.id ?? null
  const selectedRecipeRepoConnectionId = selectedRepo?.connectionId ?? null
  // Why: gate recipe probing on the experimental toggle, since discovery can surface setup errors for a hidden feature.
  const ephemeralVmsEnabled = settings?.experimentalEphemeralVms === true
  const {
    recipes: ephemeralVmRecipes,
    selectedRecipeId: selectedEphemeralVmRecipeId,
    setSelectedRecipeId: setSelectedEphemeralVmRecipeId,
    error: ephemeralVmRecipeError
  } = useEphemeralVmRecipeOptions({
    enabled: ephemeralVmsEnabled,
    repoId: selectedRecipeRepoId,
    repoIsGit: selectedRepoIsGit,
    repoConnectionId: selectedRecipeRepoConnectionId,
    repoExecutionHostId: selectedRepo ? getRepoExecutionHostId(selectedRepo) : null,
    projectGroupTarget: isProjectGroupTarget,
    initialRecipeId: initialEphemeralVmRecipeId
  })
  const selectedRepoConnectionId = selectedRepo?.connectionId ?? null
  const selectedRepoSshState = selectedRepoConnectionId
    ? (sshConnectionStates.get(selectedRepoConnectionId) ?? null)
    : null
  const { selectedRepoSshStatus, selectedRepoRequiresConnection, selectedRepoConnectInProgress } =
    getSelectedRepoSshGate({
      connectionId: selectedRepoConnectionId,
      status: selectedRepoSshState?.status ?? null
    })
  const repoIdRef = useRef(repoId)
  repoIdRef.current = repoId
  const setRepoId = useCallback(
    (value: string) => {
      if (onRepoIdOverrideChange) {
        onRepoIdOverrideChange(value)
      } else {
        setInternalRepoId(value)
      }
    },
    [onRepoIdOverrideChange]
  )

  const [name, setName] = useState<string>(
    persistDraft ? (newWorkspaceDraft?.name ?? initialName) : initialName
  )
  const [agentPrompt, setAgentPrompt] = useState<string>(
    persistDraft ? (newWorkspaceDraft?.prompt ?? initialPrompt) : initialPrompt
  )
  const [note, setNote] = useState<string>(persistDraft ? (newWorkspaceDraft?.note ?? '') : '')
  const [attachmentPaths, setAttachmentPaths] = useState<string[]>(
    persistDraft ? (newWorkspaceDraft?.attachments ?? []) : []
  )
  const normalizedInitialLinkedWorkItem = normalizeGitHubLinkedWorkItem(initialLinkedWorkItem)
  const normalizedDraftLinkedWorkItem = persistDraft
    ? normalizeGitHubLinkedWorkItem(newWorkspaceDraft?.linkedWorkItem)
    : null
  const draftLinkedTaskSourceContext = persistDraft
    ? getMatchingLinkedTaskSourceContext(
        normalizedDraftLinkedWorkItem,
        newWorkspaceDraft?.linkedTaskSourceContext ?? newWorkspaceDraft?.taskSourceContext
      )
    : null
  const initialLinkedTaskSourceContext = getMatchingLinkedTaskSourceContext(
    normalizedInitialLinkedWorkItem,
    initialTaskSourceContext
  )
  const initialLinkedWorkItemSeed =
    normalizedInitialLinkedWorkItem &&
    getLinkedWorkItemProvider(normalizedInitialLinkedWorkItem) === 'jira' &&
    !initialLinkedTaskSourceContext
      ? null
      : normalizedInitialLinkedWorkItem
  const draftLinkedWorkItemSeed =
    normalizedDraftLinkedWorkItem &&
    getLinkedWorkItemProvider(normalizedDraftLinkedWorkItem) === 'jira' &&
    !draftLinkedTaskSourceContext
      ? null
      : normalizedDraftLinkedWorkItem
  const linkedWorkItemSeed = persistDraft
    ? (draftLinkedWorkItemSeed ?? initialLinkedWorkItemSeed)
    : initialLinkedWorkItemSeed
  const linkedWorkItemSeedIdentity = getGitHubLinkedWorkItemIdentity(linkedWorkItemSeed)
  const [linkedWorkItem, setLinkedWorkItem] = useState<LinkedWorkItemSummary | null>(
    () => linkedWorkItemSeed
  )
  const initialLinearBranchName = getLinearLinkedWorkItemBranchName(linkedWorkItemSeed)
  const [linkedTaskSourceContext, setLinkedTaskSourceContext] = useState<TaskSourceContext | null>(
    () => draftLinkedTaskSourceContext ?? initialLinkedTaskSourceContext
  )
  const derivedGitHubTaskSourceContext = useMemo(() => {
    if (
      !linkedWorkItem ||
      getLinkedWorkItemProvider(linkedWorkItem) !== 'github' ||
      !selectedRepo ||
      selectedWorkspaceTarget.status !== 'ready'
    ) {
      return null
    }
    const selectedProject = projects.find(
      (project) => project.id === selectedWorkspaceTarget.target.projectId
    )
    if (selectedProject?.providerIdentity?.provider !== 'github') {
      return null
    }
    return buildTaskSourceContextFromRepo({
      provider: 'github',
      projectId: selectedWorkspaceTarget.target.projectId,
      repo: selectedRepo,
      projectHostSetupId: selectedWorkspaceTarget.target.projectHostSetupId,
      providerIdentity: selectedProject.providerIdentity
    })
  }, [linkedWorkItem, projects, selectedRepo, selectedWorkspaceTarget])
  const taskSourceContext = linkedTaskSourceContext ?? derivedGitHubTaskSourceContext
  const selectedRepoGitHubSourceContext = useMemo(() => {
    if (!selectedRepo || !selectedRepoIsGit) {
      return null
    }
    if (taskSourceContext?.provider === 'github') {
      return taskSourceContext
    }
    if (selectedWorkspaceTarget.status === 'ready') {
      const selectedProject = projects.find(
        (project) => project.id === selectedWorkspaceTarget.target.projectId
      )
      return buildTaskSourceContextFromRepo({
        provider: 'github',
        projectId: selectedWorkspaceTarget.target.projectId,
        repo: selectedRepo,
        projectHostSetupId: selectedWorkspaceTarget.target.projectHostSetupId,
        providerIdentity:
          selectedProject?.providerIdentity?.provider === 'github'
            ? selectedProject.providerIdentity
            : null
      })
    }
    return buildTaskSourceContextFromRepo({
      provider: 'github',
      projectId: selectedRepo.id,
      repo: selectedRepo
    })
  }, [projects, selectedRepo, selectedRepoIsGit, selectedWorkspaceTarget, taskSourceContext])
  const smartNameJiraSourceContext = useMemo(() => {
    if (!selectedProjectId) {
      return null
    }
    const sourceRepo = isProjectGroupTarget
      ? (folderSourceRepos.find((repo) => repo.id === repoId) ?? null)
      : selectedRepo
    return normalizeTaskSourceContext({
      provider: 'jira',
      projectId: selectedProjectGroup?.id ?? selectedProjectId,
      hostId: resolveJiraSourceHostId({
        workspaceHostId:
          selectedWorkspaceTarget.status === 'ready' ? selectedWorkspaceTarget.target.hostId : null,
        groupExecutionHostId: selectedProjectGroup?.executionHostId,
        groupConnectionId: selectedProjectGroup?.connectionId
      }),
      projectHostSetupId: selectedProjectGroup ? null : selectedProjectHostSetupId,
      repoId: sourceRepo?.id ?? null,
      providerIdentity: null,
      accountLabel: null
    })
  }, [
    folderSourceRepos,
    isProjectGroupTarget,
    repoId,
    selectedProjectGroup,
    selectedProjectHostSetupId,
    selectedProjectId,
    selectedRepo,
    selectedWorkspaceTarget
  ])
  const [linkedIssue, setLinkedIssue] = useState<string>(() => {
    if (linkedWorkItemSeedIdentity?.type === 'issue') {
      return String(linkedWorkItemSeedIdentity.number)
    }
    if (persistDraft && newWorkspaceDraft?.linkedIssue) {
      return newWorkspaceDraft.linkedIssue
    }
    if (
      initialLinkedWorkItem?.type === 'issue' &&
      getLinkedWorkItemProvider(initialLinkedWorkItem) === 'github'
    ) {
      return String(initialLinkedWorkItem.number)
    }
    return ''
  })
  const [linkedPR, setLinkedPR] = useState<number | null>(() => {
    if (linkedWorkItemSeedIdentity?.type === 'pr') {
      return linkedWorkItemSeedIdentity.number
    }
    if (linkedWorkItemSeedIdentity?.type === 'issue') {
      return null
    }
    if (persistDraft && newWorkspaceDraft?.linkedPR !== undefined) {
      return newWorkspaceDraft.linkedPR
    }
    return initialLinkedWorkItem?.type === 'pr' ? initialLinkedWorkItem.number : null
  })
  // Why: GitLab parallels of linkedIssue/linkedPR, kept as separate state so existing GitHub auto-name/badge/persistence paths stay untouched.
  const [linkedGitLabIssue, setLinkedGitLabIssue] = useState<number | null>(() => {
    if (persistDraft && newWorkspaceDraft?.linkedGitLabIssue !== undefined) {
      return newWorkspaceDraft.linkedGitLabIssue
    }
    return initialLinkedWorkItem?.type === 'issue' && isGitLabIssueUrl(initialLinkedWorkItem.url)
      ? initialLinkedWorkItem.number
      : null
  })
  const [linkedGitLabMR, setLinkedGitLabMR] = useState<number | null>(() => {
    if (persistDraft && newWorkspaceDraft?.linkedGitLabMR !== undefined) {
      return newWorkspaceDraft.linkedGitLabMR
    }
    return initialLinkedWorkItem?.type === 'mr' ? initialLinkedWorkItem.number : null
  })
  const [baseBranch, setBaseBranch] = useState<string | undefined>(
    persistDraft ? newWorkspaceDraft?.baseBranch : initialBaseBranch
  )
  const [compareBaseRef, setCompareBaseRef] = useState<string | undefined>(
    persistDraft ? newWorkspaceDraft?.compareBaseRef : undefined
  )
  const [branchNameOverride, setBranchNameOverride] = useState<string | undefined>(
    initialLinearBranchName
  )
  const [branchNameOverridePreservesNameEdits, setBranchNameOverridePreservesNameEdits] = useState(
    Boolean(initialLinearBranchName)
  )
  const [smartNameMode, setSmartNameMode] = useState<SmartNameMode>('smart')
  // Why: a pasted Jira URL is not a workspace name yet — block create until it resolves to an issue.
  const sourceIntentBlocksCreate = !linkedWorkItem && isBlockingJiraUrlIntent(smartNameMode, name)
  // Why (#5181): reuseEligibleBranch = local branch name eligible for checkout-reuse (null if none); reuseSelectedBranch = the checkbox that enacts it.
  const [reuseEligibleBranch, setReuseEligibleBranch] = useState<string | null>(null)
  const [reuseSelectedBranch, setReuseSelectedBranch] = useState(false)
  const [pushTarget, setPushTarget] = useState<GitPushTarget | undefined>(undefined)
  // Why: when a repo switch wipes a prior Start-from selection, surface the reset inline (e.g. "was PR #8778") so it doesn't slip past the user.
  const [startFromResetHint, setStartFromResetHint] = useState<string | null>(null)
  // Why: a fork PR with "Allow edits from maintainers" off can't be pushed to; warn (don't block) so a rejected push isn't a surprise.
  const [forkPushWarning, setForkPushWarning] = useState<string | null>(null)
  const disabledTuiAgentKey = (settings?.disabledTuiAgents ?? []).join('\u0000')
  const disabledTuiAgents = useMemo<TuiAgent[]>(
    () => settings?.disabledTuiAgents ?? [],
    // Why: settings IPC clones arrays, so key on the disabled-agent content, not the array ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [disabledTuiAgentKey]
  )
  // Why: the long-form composer requires a real TuiAgent, so a global 'blank' pref collapses to Claude (blank only exists in quick-create).
  const enabledCatalogAgents = useMemo(
    () =>
      filterEnabledTuiAgents(
        getAgentCatalog().map((agent) => agent.id),
        disabledTuiAgents
      ),
    [disabledTuiAgents]
  )
  const fallbackDefaultAgent: TuiAgent =
    settings?.defaultTuiAgent &&
    settings.defaultTuiAgent !== 'blank' &&
    isTuiAgentEnabled(settings.defaultTuiAgent, disabledTuiAgents)
      ? settings.defaultTuiAgent
      : (enabledCatalogAgents[0] ?? 'claude')
  const [tuiAgent, setTuiAgent] = useState<TuiAgent>(
    persistDraft ? (newWorkspaceDraft?.agent ?? fallbackDefaultAgent) : fallbackDefaultAgent
  )
  // Why: for a repo on an SSH host or runtime env, read the per-host agent list so the dialog shows the host's installed agents, not local.
  const connectionId = selectedRepoConnectionId
  const isRemote = typeof connectionId === 'string'
  const runtimeEnvironmentId = selectedRepoSettings?.activeRuntimeEnvironmentId?.trim() || null
  const detectedAgentList = useAppStore((s) => {
    if (isRemote) {
      return s.remoteDetectedAgentIds[connectionId] ?? null
    }
    if (runtimeEnvironmentId) {
      return s.runtimeDetectedAgentIds[runtimeEnvironmentId] ?? null
    }
    return s.detectedAgentIds
  })
  const ensureDetectedAgents = useAppStore((s) => s.ensureDetectedAgents)
  const ensureRemoteDetectedAgents = useAppStore((s) => s.ensureRemoteDetectedAgents)
  const ensureRuntimeDetectedAgents = useAppStore((s) => s.ensureRuntimeDetectedAgents)
  const detectedAgentIds = useMemo<Set<TuiAgent> | null>(
    () => (detectedAgentList ? new Set(detectedAgentList) : null),
    [detectedAgentList]
  )

  const [yamlHooks, setYamlHooks] = useState<OrcaHooks | null>(null)
  const [checkedHooksRepoId, setCheckedHooksRepoId] = useState<string | null>(null)
  const [issueCommandTemplate, setIssueCommandTemplate] = useState('')
  const [hasLoadedIssueCommand, setHasLoadedIssueCommand] = useState(false)
  const [setupDecision, setSetupDecision] = useState<'run' | 'skip' | null>(null)
  const [setupAgentStartupPolicy, setSetupAgentStartupPolicy] = useState<SetupAgentStartupPolicy>(
    () => getRepoSetupAgentStartupPolicy(selectedRepo)
  )
  const setupAgentStartupPolicyRef = useRef(setupAgentStartupPolicy)
  setupAgentStartupPolicyRef.current = setupAgentStartupPolicy
  const setupAgentStartupPolicySaveRef = useRef<{
    repoId: string
    policy: SetupAgentStartupPolicy
    promise: Promise<boolean>
  } | null>(null)
  const setupAgentStartupPolicyDraftRef = useRef<{
    repoId: string
    policy: SetupAgentStartupPolicy
  } | null>(null)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<WorkspaceCreateErrorDisplay | null>(null)
  // Why: when checked, a successful create keeps the modal open and resets identity fields so the user can queue another worktree.
  const [createMultiple, setCreateMultiple] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(
    persistDraft ? Boolean((newWorkspaceDraft?.note ?? '').trim()) : false
  )
  const [sparseEnabled, setSparseEnabled] = useState(false)
  const [sparseDirectories, setSparseDirectories] = useState('')
  const [sparseSelectedPresetId, setSparseSelectedPresetId] = useState<string | null>(null)

  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false)
  const [linkQuery, setLinkQuery] = useState('')
  const [linkDebouncedQuery, setLinkDebouncedQuery] = useState('')
  const [linkItems, setLinkItems] = useState<GitHubWorkItem[]>([])
  const [linkItemsLoading, setLinkItemsLoading] = useState(false)
  const [linkDirectItem, setLinkDirectItem] = useState<GitHubWorkItem | null>(null)
  const [linkDirectLoading, setLinkDirectLoading] = useState(false)

  const lastAutoNameRef = useRef<string>(
    getInitialAutoManagedWorkspaceName({
      draftName: persistDraft ? newWorkspaceDraft?.name : null,
      draftLinkedWorkItem: persistDraft ? draftLinkedWorkItemSeed : null,
      initialName,
      initialLinkedWorkItem: initialLinkedWorkItemSeed
    })
  )
  const nameRef = useRef<string>(name)
  nameRef.current = name
  const branchAutoNameRef = useRef<string>('')
  // Why: the note we auto-prefilled from a Start-from PR pick, so a later PR change can replace it without clobbering user-typed text.
  const lastAutoNoteRef = useRef<string>('')
  // Why: let handleBaseBranchPrSelect read the latest note without adding it to deps (would rebuild the callback on every keystroke).
  const noteRef = useRef<string>(note)
  noteRef.current = note
  // Why: PR checkout refs resolve async, so submit can still see the linked PR as a checkout source if Create fires before the resolver settles.
  const smartGitHubPrStartPointSelectionRef = useRef<SmartGitHubPrStartPointSelection | null>(null)
  useEffect(() => {
    const clearAutoManagedName = (): void => {
      if (nameRef.current === lastAutoNameRef.current) {
        setName('')
        lastAutoNameRef.current = ''
        setCreateError(null)
      }
    }

    window.addEventListener(CONTEXTUAL_TOUR_ENABLE_AUTO_WORKSPACE_NAME_EVENT, clearAutoManagedName)
    return () => {
      window.removeEventListener(
        CONTEXTUAL_TOUR_ENABLE_AUTO_WORKSPACE_NAME_EVENT,
        clearAutoManagedName
      )
    }
  }, [])
  const composerRef = useRef<HTMLDivElement | null>(null)
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const promptCaretFrameRef = useRef<number | null>(null)
  const nameInputRef = useRef<HTMLInputElement | null>(null)
  // Keep prompt state fresh for the once-mounted attachment/drop listener.
  const agentPromptRef = useRef(agentPrompt)
  agentPromptRef.current = agentPrompt
  const connectionIdRef = useRef(connectionId)
  connectionIdRef.current = connectionId
  const selectedRepoConnectionIdRef = useRef(selectedRepoConnectionId)
  selectedRepoConnectionIdRef.current = selectedRepoConnectionId

  // Why: compare the full host-aware identity before linking a pasted PR URL to this repo.
  const [selectedRepoSlug, setSelectedRepoSlug] = useState<GitHubRepositoryIdentity | null>(null)
  const selectedRepoPath = selectedRepo?.path
  const selectedRepoPathRef = useRef<string | undefined>(selectedRepoPath)
  selectedRepoPathRef.current = selectedRepoPath
  const selectedRepoSettingsRef = useRef(selectedRepoSettings)
  selectedRepoSettingsRef.current = selectedRepoSettings

  // Why: depend on the persisted policy *value*, not the selectedRepo object. Background repo
  // refetches (git polling) hand back a new repo reference with the same hookSettings; keying on
  // the object would re-run this and briefly flip the toggle back to the stale value — the glitch.
  const persistedSetupAgentStartupPolicy = getRepoSetupAgentStartupPolicy(selectedRepo)
  useEffect(() => {
    const draft = setupAgentStartupPolicyDraftRef.current
    if (draft?.repoId === repoId && draft.policy !== persistedSetupAgentStartupPolicy) {
      return
    }
    setupAgentStartupPolicyRef.current = persistedSetupAgentStartupPolicy
    setSetupAgentStartupPolicy(persistedSetupAgentStartupPolicy)
  }, [repoId, persistedSetupAgentStartupPolicy])

  const persistSetupAgentStartupPolicy = useCallback(
    async (
      policy: SetupAgentStartupPolicy = setupAgentStartupPolicyRef.current
    ): Promise<boolean> => {
      while (true) {
        const currentRepo = useAppStore.getState().repos.find((repo) => repo.id === repoId)
        if (!currentRepo || !isGitRepoKind(currentRepo)) {
          return true
        }
        const pendingSave = setupAgentStartupPolicySaveRef.current
        if (pendingSave?.repoId === currentRepo.id) {
          if (pendingSave.policy === policy) {
            const saved = await pendingSave.promise
            if (
              saved &&
              setupAgentStartupPolicyDraftRef.current?.repoId === currentRepo.id &&
              setupAgentStartupPolicyDraftRef.current.policy === policy
            ) {
              setupAgentStartupPolicyDraftRef.current = null
            }
            return saved
          }
          await pendingSave.promise
          continue
        }
        if (getRepoSetupAgentStartupPolicy(currentRepo) === policy) {
          if (
            setupAgentStartupPolicyDraftRef.current?.repoId === currentRepo.id &&
            setupAgentStartupPolicyDraftRef.current.policy === policy
          ) {
            setupAgentStartupPolicyDraftRef.current = null
          }
          return true
        }
        const promise = updateRepo(currentRepo.id, {
          hookSettings: buildSetupAgentStartupHookSettings(currentRepo.hookSettings, policy)
        }).finally(() => {
          if (setupAgentStartupPolicySaveRef.current?.promise === promise) {
            setupAgentStartupPolicySaveRef.current = null
          }
        })
        setupAgentStartupPolicySaveRef.current = { repoId: currentRepo.id, policy, promise }
        const saved = await promise
        if (
          saved &&
          setupAgentStartupPolicyDraftRef.current?.repoId === currentRepo.id &&
          setupAgentStartupPolicyDraftRef.current.policy === policy
        ) {
          setupAgentStartupPolicyDraftRef.current = null
        }
        return saved
      }
    },
    [repoId, updateRepo]
  )

  const handleSetupAgentStartupPolicyChange = useCallback(
    (policy: SetupAgentStartupPolicy) => {
      setupAgentStartupPolicyRef.current = policy
      if (repoId) {
        setupAgentStartupPolicyDraftRef.current = { repoId, policy }
      }
      setSetupAgentStartupPolicy(policy)
      void persistSetupAgentStartupPolicy(policy).then((saved) => {
        if (!saved) {
          toast.error(
            translate(
              'auto.hooks.useComposerState.setupAgentStartupPolicySaveFailed',
              'Failed to save setup startup behavior.'
            )
          )
        }
      })
    },
    [persistSetupAgentStartupPolicy, repoId]
  )

  const cancelPromptCaretFrame = useCallback((): void => {
    if (promptCaretFrameRef.current === null) {
      return
    }
    cancelAnimationFrame(promptCaretFrameRef.current)
    promptCaretFrameRef.current = null
  }, [])

  const handleComposerNodeChange = useCallback(
    (node: HTMLDivElement | null): void => {
      // Why: cancel the queued caret restoration once the composer root (its target's ancestor) leaves the DOM.
      if (!node) {
        cancelPromptCaretFrame()
      }
    },
    [cancelPromptCaretFrame]
  )

  const hookCheckRef = useRef<{
    key: string
    promise: Promise<HookCheckResult>
  } | null>(null)
  const loadHookCheckForRepo = useCallback((targetRepoId: string): Promise<HookCheckResult> => {
    const key = `${selectedRepoSettingsRef.current?.activeRuntimeEnvironmentId ?? 'local'}:${targetRepoId}`
    const existing = hookCheckRef.current
    if (existing?.key === key) {
      return existing.promise
    }
    const promise = checkRuntimeHooks(selectedRepoSettingsRef.current, targetRepoId)
    hookCheckRef.current = { key, promise }
    return promise
  }, [])
  const commitHookCheckIfCurrent = useCallback(
    (targetRepoId: string, hooks: OrcaHooks | null): boolean => {
      if (repoIdRef.current !== targetRepoId) {
        return false
      }
      setYamlHooks(hooks)
      setCheckedHooksRepoId(targetRepoId)
      return true
    },
    []
  )
  useEffect(() => {
    if (!selectedRepo || !selectedRepoPath || !selectedRepoIsGit) {
      setSelectedRepoSlug(null)
      return
    }
    let cancelled = false
    const target = getActiveRuntimeTarget(selectedRepoSettings)
    const slugRequest =
      target.kind === 'environment'
        ? callRuntimeRpc<GitHubRepositoryIdentity | null>(
            target,
            'github.repoSlug',
            { repo: repoId },
            { timeoutMs: 30_000 }
          )
        : (window.api.gh.repoSlug({ repoPath: selectedRepoPath, repoId }) as Promise<{
            owner: string
            repo: string
          } | null>)
    void slugRequest
      .then((result) => {
        if (cancelled) {
          return
        }
        setSelectedRepoSlug(result)
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedRepoSlug(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [repoId, selectedRepo, selectedRepoIsGit, selectedRepoPath, selectedRepoSettings])
  const sparsePresetsForRepo = sparsePresetsByRepo[repoId]
  const sparsePresets = sparsePresetsForRepo ?? EMPTY_SPARSE_PRESETS
  const normalizedSparseDirectories = useMemo(
    () => normalizeSparseDirectoryLines(sparseDirectories),
    [sparseDirectories]
  )
  // Why: only attribute the preset if the directories still match it; an edited selection is "Custom", not falsely tagged as the original preset.
  const effectivePresetId = useMemo(() => {
    if (!sparseSelectedPresetId) {
      return null
    }
    const selected = sparsePresets.find((preset) => preset.id === sparseSelectedPresetId)
    if (!selected) {
      return null
    }
    return sparseDirectoriesMatch(selected.directories, normalizedSparseDirectories)
      ? selected.id
      : null
  }, [normalizedSparseDirectories, sparsePresets, sparseSelectedPresetId])

  const sparseError = useMemo(() => {
    if (!sparseEnabled) {
      return null
    }
    if (!selectedRepoIsGit) {
      return null
    }
    if (selectedRepo?.connectionId) {
      return 'Sparse checkout is only supported for local repos right now.'
    }
    if (normalizedSparseDirectories.length === 0) {
      return 'Enter at least one repo-relative directory.'
    }
    if (
      normalizedSparseDirectories.some((entry) => entry === '.' || entry.split('/').includes('..'))
    ) {
      return 'Use repo-relative directories, not root or parent paths.'
    }
    return null
  }, [normalizedSparseDirectories, selectedRepo?.connectionId, selectedRepoIsGit, sparseEnabled])
  const parsedLinkedIssueNumber = useMemo(
    () => (linkedIssue.trim() ? parseGitHubIssueOrPRNumber(linkedIssue) : null),
    [linkedIssue]
  )
  // Why: a PR URL pasted into the name field (not picked) leaves linkedPR null; recover the number so the worktree still links back to its PR.
  const effectiveLinkedPR = useMemo<number | null>(() => {
    if (linkedPR !== null) {
      return linkedPR
    }
    const fromName = parseGitHubIssueOrPRLink(name)
    if (fromName && fromName.type === 'pr') {
      // Why: adopt the number only when the URL slug matches the selected repo (and the slug has resolved), else a foreign PR URL mislinks to a same-numbered PR here.
      if (
        selectedRepoSlug &&
        githubRepoIdentityKey(fromName.slug) === githubRepoIdentityKey(selectedRepoSlug)
      ) {
        return fromName.number
      }
    }
    return null
  }, [linkedPR, name, selectedRepoSlug])
  const setupConfig = useMemo(
    () => (selectedRepoIsGit ? getSetupConfig(selectedRepo, yamlHooks) : null),
    [selectedRepo, selectedRepoIsGit, yamlHooks]
  )
  const setupPolicy: SetupRunPolicy = selectedRepo?.hookSettings?.setupRunPolicy ?? 'run-by-default'
  const linkedWorkItemProvider = linkedWorkItem ? getLinkedWorkItemProvider(linkedWorkItem) : null
  // Why: sentinel-based Jira/Linear items must bypass repository issue templates.
  const willApplyIssueCommandAsPrompt =
    enableIssueAutomation &&
    !agentPrompt.trim() &&
    Boolean(linkedWorkItem) &&
    canUseIssueCommandForLinkedItemProvider(linkedWorkItemProvider)
  const shouldWaitForIssueAutomationCheck =
    enableIssueAutomation &&
    (parsedLinkedIssueNumber !== null || willApplyIssueCommandAsPrompt) &&
    !hasLoadedIssueCommand
  const requiresExplicitSetupChoice = Boolean(setupConfig) && setupPolicy === 'ask'
  const resolvedSetupDecision =
    setupDecision ??
    (!setupConfig || setupPolicy === 'ask'
      ? null
      : setupPolicy === 'run-by-default'
        ? 'run'
        : 'skip')
  const isSetupCheckPending = Boolean(repoId) && checkedHooksRepoId !== repoId
  const shouldWaitForSetupCheck = Boolean(selectedRepo) && selectedRepoIsGit && isSetupCheckPending

  // Why: blank name with no other seed → globally-unique creature name so workspaces don't collide across repos or on a literal default.
  const fallbackCreatureName = useMemo(
    () => getSuggestedCreatureName(worktreesByRepo),
    [worktreesByRepo]
  )
  const workspaceSeedName = useMemo(
    () =>
      getWorkspaceSeedName({
        explicitName: name,
        prompt: agentPrompt,
        linkedIssueNumber: parsedLinkedIssueNumber,
        linkedPR,
        fallbackName: fallbackCreatureName
      }),
    [agentPrompt, fallbackCreatureName, linkedPR, name, parsedLinkedIssueNumber]
  )
  // Why: Jira/Linear use sentinel numbers that are invalid in legacy {{issue}} templates.
  const shouldApplyLinkedOnlyTemplate =
    enableIssueAutomation &&
    !agentPrompt.trim() &&
    Boolean(linkedWorkItem) &&
    hasLoadedIssueCommand &&
    canUseIssueCommandForLinkedItemProvider(linkedWorkItemProvider)
  const linkedOnlyTemplatePrompt = useMemo(() => {
    if (!shouldApplyLinkedOnlyTemplate || !linkedWorkItem) {
      return ''
    }
    const template = issueCommandTemplate.trim() || DEFAULT_ISSUE_COMMAND_TEMPLATE
    return renderIssueCommandTemplate(template, {
      issueNumber: linkedWorkItem.type === 'issue' ? linkedWorkItem.number : null,
      artifactUrl: linkedWorkItem.url
    })
  }, [issueCommandTemplate, linkedWorkItem, shouldApplyLinkedOnlyTemplate])
  const normalizedLinkQuery = useMemo(
    () => normalizeGitHubLinkQuery(linkDebouncedQuery),
    [linkDebouncedQuery]
  )

  const filteredLinkItems = useMemo(() => {
    if (normalizedLinkQuery.tooLarge) {
      return []
    }
    if (normalizedLinkQuery.directNumber !== null) {
      return linkDirectItem ? [linkDirectItem] : []
    }

    const query = normalizedLinkQuery.query.trim().toLowerCase()
    if (!query) {
      return linkItems
    }

    return linkItems.filter((item) => {
      const text = [
        item.type,
        item.number,
        item.title,
        item.author ?? '',
        item.labels.join(' '),
        item.branchName ?? '',
        item.baseRefName ?? ''
      ]
        .join(' ')
        .toLowerCase()
      return text.includes(query)
    })
  }, [
    linkDirectItem,
    linkItems,
    normalizedLinkQuery.directNumber,
    normalizedLinkQuery.query,
    normalizedLinkQuery.tooLarge
  ])

  // Persist draft whenever relevant fields change (full-page only).
  useEffect(() => {
    if (!persistDraft) {
      return
    }
    setNewWorkspaceDraft({
      repoId: repoId || null,
      projectId:
        selectedProjectGroup !== null
          ? null
          : selectedWorkspaceTarget.status === 'ready'
            ? selectedWorkspaceTarget.target.projectId
            : null,
      projectGroupId: selectedProjectGroup?.id ?? null,
      hostId:
        selectedProjectGroup !== null
          ? null
          : selectedWorkspaceTarget.status === 'ready'
            ? selectedWorkspaceTarget.target.hostId
            : null,
      projectHostSetupId:
        selectedProjectGroup !== null
          ? null
          : selectedWorkspaceTarget.status === 'ready'
            ? selectedWorkspaceTarget.target.projectHostSetupId
            : null,
      name,
      prompt: agentPrompt,
      note,
      attachments: attachmentPaths,
      linkedWorkItem,
      linkedTaskSourceContext: taskSourceContext,
      agent: tuiAgent,
      linkedIssue,
      linkedPR,
      linkedGitLabIssue,
      linkedGitLabMR,
      ...(baseBranch !== undefined ? { baseBranch } : {}),
      ...(compareBaseRef !== undefined ? { compareBaseRef } : {})
    })
  }, [
    persistDraft,
    agentPrompt,
    attachmentPaths,
    baseBranch,
    compareBaseRef,
    linkedIssue,
    linkedPR,
    linkedGitLabIssue,
    linkedGitLabMR,
    linkedWorkItem,
    note,
    name,
    repoId,
    selectedProjectGroup,
    selectedWorkspaceTarget,
    setNewWorkspaceDraft,
    taskSourceContext,
    tuiAgent
  ])

  // Auto-pick the first eligible repo if we somehow start with none selected.
  useEffect(() => {
    if (isProjectGroupTarget) {
      return
    }
    if (!repoId && eligibleRepos[0]?.id) {
      setRepoId(eligibleRepos[0].id)
    }
  }, [eligibleRepos, isProjectGroupTarget, repoId, setRepoId])

  useEffect(() => {
    if (!selectedProjectGroup) {
      return
    }
    if (repoId && folderSourceRepos.some((repo) => repo.id === repoId)) {
      return
    }
    setRepoId(folderSourceRepos[0]?.id ?? '')
  }, [folderSourceRepos, repoId, selectedProjectGroup, setRepoId])

  // Why: the sparse dropdown is always visible under Advanced, so presets must load before sparse mode is enabled.
  useEffect(() => {
    if (!repoId || !selectedRepoIsGit || selectedRepo?.connectionId) {
      return
    }
    if (sparsePresetsByRepo[repoId] !== undefined) {
      return
    }
    void fetchSparsePresets(repoId)
  }, [
    fetchSparsePresets,
    repoId,
    selectedRepo?.connectionId,
    selectedRepoIsGit,
    sparsePresetsByRepo
  ])

  // Why: re-detect agents when the selected repo changes so the list matches the correct host (local runs once, deduped by the store).
  useEffect(() => {
    if (isRemote && selectedRepoSshStatus !== 'connected') {
      return
    }
    let cancelled = false
    const detect = isRemote
      ? ensureRemoteDetectedAgents(connectionId)
      : runtimeEnvironmentId
        ? ensureRuntimeDetectedAgents(runtimeEnvironmentId)
        : ensureDetectedAgents()
    void detect.then((ids) => {
      if (cancelled) {
        return
      }
      const enabledIds = filterEnabledTuiAgents(ids, disabledTuiAgents)
      if (!newWorkspaceDraft?.agent && !settings?.defaultTuiAgent && enabledIds.length > 0) {
        const firstInCatalogOrder = getAgentCatalog().find((a) => enabledIds.includes(a.id))
        if (firstInCatalogOrder) {
          setTuiAgent(firstInCatalogOrder.id)
        }
      } else if (!isTuiAgentEnabled(tuiAgent, disabledTuiAgents)) {
        const firstEnabledDetected = getAgentCatalog().find((a) => enabledIds.includes(a.id))
        setTuiAgent(firstEnabledDetected?.id ?? fallbackDefaultAgent)
      }
    })
    return () => {
      cancelled = true
    }
    // Why: deps narrowed to host identity (connectionId/runtimeEnvironmentId); detection is a best-effort PATH snapshot, so draft/settings are excluded.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId, runtimeEnvironmentId, isRemote, selectedRepoSshStatus, disabledTuiAgents])

  // Per-repo: load yaml hooks + issue command template.
  useEffect(() => {
    if (!repoId) {
      return
    }

    let cancelled = false
    setHasLoadedIssueCommand(false)
    setIssueCommandTemplate('')
    setYamlHooks(null)
    setCheckedHooksRepoId(null)

    if (!selectedRepoIsGit) {
      setHasLoadedIssueCommand(true)
      setCheckedHooksRepoId(repoId)
      return () => {
        cancelled = true
      }
    }

    void loadHookCheckForRepo(repoId)
      .then((result) => {
        if (!cancelled) {
          commitHookCheckIfCurrent(repoId, result.hooks)
        }
      })
      .catch(() => {
        if (!cancelled) {
          commitHookCheckIfCurrent(repoId, null)
        }
      })

    if (!enableIssueAutomation) {
      setHasLoadedIssueCommand(true)
      return () => {
        cancelled = true
      }
    }

    void readRuntimeIssueCommand(selectedRepoSettingsRef.current, repoId)
      .then((result) => {
        if (!cancelled) {
          setIssueCommandTemplate(result.effectiveContent ?? '')
          setHasLoadedIssueCommand(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIssueCommandTemplate('')
          setHasLoadedIssueCommand(true)
        }
      })

    return () => {
      cancelled = true
    }
    // Why: key on the stable runtime-env id, not the selectedRepoSettings object. `updateRepo`
    // (e.g. saving the setup toggle from this very composer) replaces selectedRepo — and thus the
    // memoized selectedRepoSettings — by reference; depending on the object would re-run this
    // effect, blank yamlHooks to null, and make the whole setup section vanish for a frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    commitHookCheckIfCurrent,
    enableIssueAutomation,
    loadHookCheckForRepo,
    repoId,
    selectedRepoIsGit,
    runtimeEnvironmentId
  ])

  const onConnectSelectedRepo = useCallback(async (): Promise<void> => {
    const targetId = selectedRepoConnectionIdRef.current
    if (!targetId) {
      return
    }
    const liveState = useAppStore.getState()
    const liveRepo = liveState.repos.find((repo) => repo.id === repoIdRef.current)
    if (liveRepo?.connectionId !== targetId) {
      return
    }
    const liveStatus = liveState.sshConnectionStates.get(targetId)?.status ?? null
    if (liveStatus === 'connected' || isSshConnectInProgress(liveStatus)) {
      return
    }

    try {
      await window.api.ssh.connect({ targetId })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('auto.hooks.useComposerState.ba6cb77082', 'Failed to connect to project.')
      )
    }
  }, [])

  const onConnectSelectedProjectGroup = useCallback(async (): Promise<void> => {
    if (!folderTargetConnectionId) {
      return
    }
    const liveStatus = useAppStore
      .getState()
      .sshConnectionStates.get(folderTargetConnectionId)?.status
    if (liveStatus === 'connected' || isSshConnectInProgress(liveStatus ?? null)) {
      return
    }
    try {
      await window.api.ssh.connect({ targetId: folderTargetConnectionId })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('auto.hooks.useComposerState.ba6cb77082', 'Failed to connect to project.')
      )
    }
  }, [folderTargetConnectionId])

  // Why: warm the Start-from picker's PR cache so opening it paints instantly from cache.
  const canPrefetchSelectedRepoWorkItems = canUseRepoBackedComposerSources({
    connectionId: selectedRepoConnectionId,
    status: selectedRepoSshStatus
  })
  const prefetchSshConnectedGeneration =
    selectedRepoConnectionId && selectedRepoSshStatus === 'connected' ? sshConnectedGeneration : 0
  useEffect(() => {
    if (!repoId || !selectedRepoIsGit || !canPrefetchSelectedRepoWorkItems) {
      return
    }
    void prefetchWorktreeCreateBase(repoId, baseBranch)
  }, [
    baseBranch,
    canPrefetchSelectedRepoWorkItems,
    prefetchSshConnectedGeneration,
    prefetchWorktreeCreateBase,
    repoId,
    selectedRepoIsGit
  ])
  useEffect(() => {
    if (!selectedRepoIsGit || !selectedRepo?.path || !canPrefetchSelectedRepoWorkItems) {
      return
    }
    prefetchWorkItems(selectedRepo.id, selectedRepo.path, PER_REPO_FETCH_LIMIT, 'is:pr is:open')
  }, [
    canPrefetchSelectedRepoWorkItems,
    prefetchSshConnectedGeneration,
    prefetchWorkItems,
    selectedRepo?.id,
    selectedRepo?.path,
    selectedRepoIsGit
  ])

  // Reset setup decision when config / policy changes.
  useEffect(() => {
    if (shouldWaitForSetupCheck) {
      setSetupDecision(null)
      return
    }
    if (!setupConfig) {
      setSetupDecision(null)
      return
    }
    if (setupPolicy === 'ask') {
      setSetupDecision(null)
      return
    }
    setSetupDecision(setupPolicy === 'run-by-default' ? 'run' : 'skip')
  }, [setupConfig, setupPolicy, shouldWaitForSetupCheck])

  // Link popover: debounce + load recent items + resolve direct number.
  useEffect(() => {
    const timeout = window.setTimeout(() => setLinkDebouncedQuery(linkQuery), 250)
    return () => window.clearTimeout(timeout)
  }, [linkQuery])

  useEffect(() => {
    if (!linkPopoverOpen || !selectedRepo || !selectedRepoIsGit) {
      return
    }

    let cancelled = false
    setLinkItemsLoading(true)

    const lookupRepoId = selectedRepo.id
    void window.api.gh
      .listWorkItems({ repoPath: selectedRepo.path, repoId: selectedRepo.id, limit: 100 })
      .then((envelope) => {
        if (!cancelled) {
          // Why: IPC omits repoId — stamp it from the queried repo below; cast through unknown since spreading the discriminated union loses the discriminant.
          // Why: the @-mention popover deliberately shows no error banner (it would crowd the input and the user sees it on the Tasks page); log to devtools instead.
          if (envelope.errors?.issues) {
            console.warn(
              '[composer/link] issues-side partial failure in @-mention popover:',
              envelope.errors.issues
            )
          }
          setLinkItems(
            envelope.items.map((it) => ({
              ...it,
              repoId: lookupRepoId
            })) as unknown as GitHubWorkItem[]
          )
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinkItems([])
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLinkItemsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [linkPopoverOpen, selectedRepo, selectedRepoIsGit])

  useEffect(() => {
    if (
      !linkPopoverOpen ||
      !selectedRepo ||
      !selectedRepoIsGit ||
      normalizedLinkQuery.directNumber === null
    ) {
      setLinkDirectItem(null)
      setLinkDirectLoading(false)
      return
    }

    let cancelled = false
    setLinkDirectLoading(true)
    // Why: a full URL carries issue-vs-PR intent, so preserve the URL route instead of probing by number only.
    const lookupRepoId = selectedRepo.id
    const lookup =
      normalizedLinkQuery.directLink !== undefined
        ? lookupGitHubWorkItemByOwnerRepoForSource({
            repoPath: selectedRepo.path,
            repoId: selectedRepo.id,
            sourceContext: selectedRepoGitHubSourceContext,
            owner: normalizedLinkQuery.directLink.slug.owner,
            repo: normalizedLinkQuery.directLink.slug.repo,
            ...(normalizedLinkQuery.directLink.slug.host
              ? { host: normalizedLinkQuery.directLink.slug.host }
              : {}),
            number: normalizedLinkQuery.directLink.number,
            type: normalizedLinkQuery.directLink.type
          })
        : lookupGitHubWorkItemForSource({
            repoPath: selectedRepo.path,
            repoId: selectedRepo.id,
            sourceContext: selectedRepoGitHubSourceContext,
            number: normalizedLinkQuery.directNumber
          })
    void lookup
      .then((item) => {
        if (!cancelled) {
          setLinkDirectItem(
            item ? ({ ...item, repoId: lookupRepoId } as unknown as GitHubWorkItem) : null
          )
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLinkDirectItem(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLinkDirectLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [
    normalizedLinkQuery.directLink,
    linkPopoverOpen,
    normalizedLinkQuery.directNumber,
    selectedRepo,
    selectedRepoGitHubSourceContext,
    selectedRepoIsGit
  ])

  const applyLinkedWorkItem = useCallback(
    (item: GitHubWorkItem, options: { preserveBranchNameOverride?: boolean } = {}): void => {
      const identity = resolveGitHubWorkItemIdentity(item)
      const normalizedItem: GitHubWorkItem = {
        ...item,
        type: identity.type,
        number: identity.number
      }
      if (identity.type === 'issue') {
        setLinkedIssue(String(identity.number))
        setLinkedPR(null)
      } else {
        setLinkedIssue('')
        setLinkedPR(identity.number)
      }
      setLinkedGitLabIssue(null)
      setLinkedGitLabMR(null)
      setLinkedWorkItem({
        type: identity.type,
        provider: 'github',
        number: identity.number,
        title: item.title,
        url: item.url
      })
      setLinkedTaskSourceContext(selectedRepoGitHubSourceContext)
      const suggestedName =
        getLinkedWorkItemWorkspaceName(normalizedItem)?.seedName ??
        getLinkedWorkItemSuggestedName(normalizedItem)
      // Why: a pasted URL/#123 is the lookup query, not a chosen name — replace with the title-derived name or it becomes a slugified-URL workspace name.
      if (
        suggestedName &&
        shouldApplyWorkspaceSourceAutoName({
          currentName: name,
          lastAutoName: lastAutoNameRef.current
        })
      ) {
        setName(suggestedName)
        lastAutoNameRef.current = suggestedName
      }
      if (!options.preserveBranchNameOverride) {
        setBranchNameOverride(undefined)
        setBranchNameOverridePreservesNameEdits(false)
        branchAutoNameRef.current = ''
      }
    },
    [name, selectedRepoGitHubSourceContext]
  )

  const resolvePendingSmartGitHubSubmit = usePendingSmartGitHubSubmitResolver({
    folderSourceRepos,
    isProjectGroupTarget,
    linkedWorkItem,
    name,
    selectedRepo,
    selectedRepoGitHubSourceContext,
    selectedRepoIsGit,
    settings,
    smartGitHubPrStartPointSelectionRef,
    lastAutoNameRef,
    branchAutoNameRef,
    setBaseBranch,
    setCompareBaseRef,
    setPushTarget,
    setBranchNameOverride,
    setBranchNameOverridePreservesNameEdits,
    setForkPushWarning,
    setLinkedIssue,
    setLinkedPR,
    setLinkedGitLabIssue,
    setLinkedGitLabMR,
    setLinkedWorkItem,
    setLinkedTaskSourceContext,
    setName,
    setStartFromResetHint
  })

  const applyLinkedGitLabWorkItem = useCallback(
    (item: GitLabWorkItem): void => {
      smartGitHubPrStartPointSelectionRef.current = null
      if (item.type === 'issue') {
        setLinkedGitLabIssue(item.number)
        setLinkedGitLabMR(null)
      } else {
        setLinkedGitLabIssue(null)
        setLinkedGitLabMR(item.number)
      }
      setLinkedIssue('')
      setLinkedPR(null)
      setLinkedTaskSourceContext(null)
      setLinkedWorkItem({
        type: item.type,
        provider: 'gitlab',
        number: item.number,
        title: item.title,
        url: item.url
      })
      // Why: GitLabWorkItem.branchName lines up structurally with GitHubWorkItem's; cast to reuse the naming heuristic without forking it.
      const suggestedName = getLinkedWorkItemSuggestedName({
        type: item.type === 'mr' ? 'pr' : 'issue',
        number: item.number,
        title: item.title,
        branchName: item.branchName
      } as unknown as GitHubWorkItem)
      const titleName = getLinkedWorkItemWorkspaceName({
        type: item.type,
        provider: 'gitlab',
        number: item.number,
        title: item.title
      })
      const nextName = titleName?.seedName ?? suggestedName
      if (
        nextName &&
        shouldApplyWorkspaceSourceAutoName({
          currentName: name,
          lastAutoName: lastAutoNameRef.current
        })
      ) {
        setName(nextName)
        lastAutoNameRef.current = nextName
      }
      setBranchNameOverride(undefined)
      setBranchNameOverridePreservesNameEdits(false)
      branchAutoNameRef.current = ''
    },
    [name]
  )

  const handleSelectLinkedItem = useCallback(
    (item: GitHubWorkItem): void => {
      smartGitHubPrStartPointSelectionRef.current = null
      applyLinkedWorkItem(item)
      setLinkPopoverOpen(false)
      setLinkQuery('')
      setLinkDebouncedQuery('')
      setLinkDirectItem(null)
    },
    [applyLinkedWorkItem]
  )

  const handleLinkPopoverChange = useCallback((open: boolean): void => {
    setLinkPopoverOpen(open)
    if (!open) {
      setLinkQuery('')
      setLinkDebouncedQuery('')
      setLinkDirectItem(null)
    }
  }, [])

  const handleRemoveLinkedWorkItem = useCallback((): void => {
    smartGitHubPrStartPointSelectionRef.current = null
    const removedLinearItem = isLinearLinkedWorkItem(linkedWorkItem)
    setLinkedWorkItem(null)
    setLinkedTaskSourceContext(null)
    setLinkedIssue('')
    setLinkedPR(null)
    setForkPushWarning(null)
    if (name === lastAutoNameRef.current) {
      lastAutoNameRef.current = ''
    }
    if (removedLinearItem) {
      // Why: a Linear branch override belongs to its issue; unlinking must not leave it driving a later worktree create.
      setBranchNameOverride(undefined)
      setBranchNameOverridePreservesNameEdits(false)
      branchAutoNameRef.current = ''
    }
  }, [linkedWorkItem, name])

  const handleNameValueChange = useCallback(
    (nextName: string): void => {
      // Why: linked items keep refreshing the suggested name only while it's auto-managed; a manual edit stops later picks from clobbering it until cleared.
      if (!nextName.trim()) {
        lastAutoNameRef.current = ''
      } else if (name !== lastAutoNameRef.current) {
        lastAutoNameRef.current = ''
      }
      if (
        branchNameOverride &&
        !branchNameOverridePreservesNameEdits &&
        nextName !== branchAutoNameRef.current
      ) {
        setBranchNameOverride(undefined)
        branchAutoNameRef.current = ''
      }
      setName(nextName)
      setCreateError(null)
    },
    [branchNameOverride, branchNameOverridePreservesNameEdits, name]
  )
  const handleBranchNameOverrideChange = useCallback(
    (value: string | undefined): void => {
      const next = resolveComposerManualBranchNameChange({
        value,
        pushTarget,
        forkPushWarning
      })
      setBranchNameOverride(next.branchNameOverride)
      setBranchNameOverridePreservesNameEdits(Boolean(next.branchNameOverride))
      setPushTarget(next.pushTarget)
      setForkPushWarning(next.forkPushWarning)
      setReuseEligibleBranch(null)
      setReuseSelectedBranch(false)
      branchAutoNameRef.current = ''
    },
    [forkPushWarning, pushTarget]
  )

  const { handleAddAttachment } = useComposerAttachmentActions({
    setAttachmentPaths,
    setAgentPrompt,
    promptTextareaRef,
    promptCaretFrameRef,
    agentPromptRef,
    cancelPromptCaretFrame,
    selectedRepoSettings,
    connectionId,
    selectedRepoPath,
    selectedRepoSettingsRef,
    connectionIdRef,
    selectedRepoPathRef
  })

  const handleRepoChange = useCallback(
    (
      value: string,
      options: { preserveStartFrom?: boolean; forceResetStartFrom?: boolean } = {}
    ): void => {
      setProjectError(null)
      if (value === repoId && !options.forceResetStartFrom) {
        setRepoId(value)
        return
      }
      // Why: capture a descriptor of the prior Start-from selection so the field can show an inline reset (e.g. "was PR #8778") after it's wiped.
      let hint: string | null = null
      if (!options.preserveStartFrom) {
        if (linkedWorkItem?.type === 'pr' && baseBranch) {
          hint = `was PR #${linkedWorkItem.number}`
        } else if (linkedWorkItem?.type === 'mr' && baseBranch) {
          // Why: GitLab MR convention is `!N`, not `#N` — match the upstream UI so the hint is recognizable.
          hint = `was MR !${linkedWorkItem.number}`
        } else if (baseBranch) {
          hint = `was ${baseBranch}`
        }
      }
      const preserveLinearLinkedWorkItem = isLinearLinkedWorkItem(linkedWorkItem)
      const preservedLinearBranchName = preserveLinearLinkedWorkItem
        ? getLinearLinkedWorkItemBranchName(linkedWorkItem)
        : undefined
      setRepoId(value)
      if (!options.preserveStartFrom) {
        smartGitHubPrStartPointSelectionRef.current = null
        setLinkedIssue('')
        setLinkedPR(null)
        setLinkedGitLabIssue(null)
        setLinkedGitLabMR(null)
        // Why: a repo change invalidates repo-scoped sources, but Linear and
        // Jira issues are workspace-scoped and must survive choosing the
        // implementation project — not just Linear.
        if (linkedWorkItem && !shouldPreserveWorkspaceSourceOnRepoChange(linkedWorkItem)) {
          setLinkedWorkItem(null)
          setLinkedTaskSourceContext(null)
        }
      }
      setSparseEnabled(false)
      setSparseDirectories('')
      // Why: presets are repo-scoped, so a prior-repo selection is meaningless after a switch.
      setSparseSelectedPresetId(null)
      // Why: Start-from is repo-scoped; reset to undefined so the field falls back to the new repo's effective base ref.
      if (!options.preserveStartFrom) {
        setBaseBranch(undefined)
        setCompareBaseRef(undefined)
        setPushTarget(undefined)
        // Why: Linear sources are workspace-scoped, so their canonical branch survives choosing a different implementation repo.
        setBranchNameOverride(preservedLinearBranchName)
        setBranchNameOverridePreservesNameEdits(Boolean(preservedLinearBranchName))
        branchAutoNameRef.current = preservedLinearBranchName ?? ''
        // Why (#5181): reuse state is branch-scoped, so a repo switch clears it even when a workspace-scoped Linear override is restored.
        setReuseEligibleBranch(null)
        setReuseSelectedBranch(false)
        setForkPushWarning(null)
        setStartFromResetHint(hint)
      }
    },
    [baseBranch, linkedWorkItem, repoId, setRepoId]
  )
  const handleFolderSourceRepoChange = useCallback(
    (value: string): void => {
      if (!folderSourceRepos.some((repo) => repo.id === value)) {
        return
      }
      setRepoId(value)
      smartGitHubPrStartPointSelectionRef.current = null
      setLinkedWorkItem((current) =>
        current && !shouldPreserveWorkspaceSourceOnRepoChange(current) ? null : current
      )
      if (linkedWorkItem && !shouldPreserveWorkspaceSourceOnRepoChange(linkedWorkItem)) {
        setLinkedTaskSourceContext(null)
      }
      setLinkedIssue('')
      setLinkedPR(null)
      setLinkedGitLabIssue(null)
      setLinkedGitLabMR(null)
    },
    [folderSourceRepos, linkedWorkItem, setRepoId]
  )
  const handleProjectHostSetupChange = useCallback(
    (setupId: string): void => {
      const option = projectHostSetupOptions.find((candidate) => candidate.id === setupId)
      if (!option || option.kind !== 'ready') {
        return
      }
      // Why: switching run host for the same project must not erase the task/PR source the user is starting from.
      handleRepoChange(option.repoId, { preserveStartFrom: true })
    },
    [handleRepoChange, projectHostSetupOptions]
  )
  const handleProjectChange = useCallback(
    (projectId: string): void => {
      initialProjectGroupAppliedRef.current = true
      const projectGroupId = getProjectGroupIdFromNewWorkspaceOptionId(projectId)
      if (projectGroupId) {
        const nextProjectGroup = projectGroups.find(
          (group) => group.id === projectGroupId && Boolean(group.parentPath?.trim())
        )
        if (!nextProjectGroup) {
          setSelectedProjectGroupId(null)
          setProjectError(
            translate(
              'auto.hooks.useComposerState.chooseOrAddProjectBeforeWorkspace',
              'Choose or add a project before creating a workspace.'
            )
          )
          return
        }
        const nextSourceRepo = getFolderSourceRepos(repos, projectGroups, nextProjectGroup)[0]
        setSelectedProjectGroupId(nextProjectGroup.id)
        setProjectError(null)
        setRepoId(nextSourceRepo?.id ?? '')
        setLinkedIssue('')
        setLinkedPR(null)
        setLinkedGitLabIssue(null)
        setLinkedGitLabMR(null)
        if (linkedWorkItem && !shouldPreserveWorkspaceSourceOnRepoChange(linkedWorkItem)) {
          setLinkedWorkItem(null)
          setLinkedTaskSourceContext(null)
        }
        setSparseEnabled(false)
        setSparseDirectories('')
        setSparseSelectedPresetId(null)
        setBaseBranch(undefined)
        setPushTarget(undefined)
        setBranchNameOverride(undefined)
        // Why (#5181): clear branch-scoped reuse state on a project switch too.
        setBranchNameOverridePreservesNameEdits(false)
        setReuseEligibleBranch(null)
        setReuseSelectedBranch(false)
        setForkPushWarning(null)
        setStartFromResetHint(null)
        return
      }

      setSelectedProjectGroupId(null)
      const preferredHostId =
        selectedWorkspaceTarget.status === 'ready' ? selectedWorkspaceTarget.target.hostId : null
      // Why: pass the current host as a preference (focusedHostScope), not a hard hostId — pinning made selecting a project set up only on another host a silent no-op.
      const nextRepoId = resolveWorkspaceCreationRepoId({
        eligibleRepos,
        projects,
        projectHostSetups,
        projectId,
        focusedHostScope: preferredHostId ?? workspaceHostScope
      })
      if (!nextRepoId) {
        return
      }
      handleRepoChange(nextRepoId, { forceResetStartFrom: isProjectGroupTarget })
    },
    [
      eligibleRepos,
      handleRepoChange,
      isProjectGroupTarget,
      linkedWorkItem,
      projectGroups,
      projectHostSetups,
      projects,
      repos,
      setRepoId,
      selectedWorkspaceTarget,
      workspaceHostScope
    ]
  )
  const selectAddedProjectRepo = useCallback(
    (nextRepoId: string): void => {
      // Why: clear the folder-group target when selecting the Add-Project repo, since the group's onRepoChange only accepts repos inside the group.
      initialProjectGroupAppliedRef.current = true
      setSelectedProjectGroupId(null)
      setProjectError(null)
      handleRepoChange(nextRepoId)
    },
    [handleRepoChange]
  )

  const showProjectRequiredError = useCallback((): void => {
    setProjectError('Choose or add a project before creating a workspace.')
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(
          '[data-contextual-tour-target="workspace-creation-project"] [data-project-combobox-root="true"][role="combobox"]'
        )
        ?.focus()
    })
  }, [])

  const handleSparseSelectPreset = useCallback((preset: SparsePreset | null): void => {
    if (preset) {
      setSparseEnabled(true)
      setSparseDirectories(preset.directories.join('\n'))
      setSparseSelectedPresetId(preset.id)
    } else {
      setSparseEnabled(false)
      setSparseDirectories('')
      setSparseSelectedPresetId(null)
    }
  }, [])

  const handleBaseBranchChange = useCallback((next: string | undefined): void => {
    smartGitHubPrStartPointSelectionRef.current = null
    setBaseBranch(next)
    setCompareBaseRef(undefined)
    setPushTarget(undefined)
    setBranchNameOverride(undefined)
    // Why (#5181): Start-from means "new branch from this base", so it never reuses — clear reuse state from a prior smart-field branch pick.
    setBranchNameOverridePreservesNameEdits(false)
    setReuseEligibleBranch(null)
    setReuseSelectedBranch(false)
    setForkPushWarning(null)
    branchAutoNameRef.current = ''
    setStartFromResetHint(null)
  }, [])

  const handleBaseBranchPrSelect = useCallback(
    (
      nextBaseBranch: string,
      item: GitHubWorkItem,
      nextPushTarget?: GitPushTarget,
      nextBranchNameOverride?: string,
      nextCompareBaseRef?: string
    ): void => {
      setBaseBranch(nextBaseBranch)
      setCompareBaseRef(nextCompareBaseRef)
      setPushTarget(nextPushTarget)
      setBranchNameOverride(nextBranchNameOverride)
      setBranchNameOverridePreservesNameEdits(Boolean(nextBranchNameOverride))
      branchAutoNameRef.current = ''
      setStartFromResetHint(null)
      // Why: a Start-from PR pick is also a linkedWorkItem assignment; reuse applyLinkedWorkItem so auto-name and linkedPR stay one code path.
      applyLinkedWorkItem(item, { preserveBranchNameOverride: Boolean(nextBranchNameOverride) })
      // Why: prefill the note from the PR (only when empty or still an auto-fill) so the sidebar surfaces it without clobbering user text.
      const identity = resolveGitHubWorkItemIdentity(item)
      if (identity.type === 'pr') {
        const suggestedNote = `PR #${identity.number} — ${item.title}`
        const currentNote = noteRef.current
        if (!currentNote.trim() || currentNote === lastAutoNoteRef.current) {
          setNote(suggestedNote)
          lastAutoNoteRef.current = suggestedNote
        }
      }
    },
    [applyLinkedWorkItem]
  )

  // Why: GitLab parallel of handleBaseBranchPrSelect; note prefill uses GitLab's `!N` MR convention so the sidebar makes the provider obvious.
  const handleBaseBranchMrSelect = useCallback(
    (
      nextBaseBranch: string,
      item: GitLabWorkItem,
      nextPushTarget?: GitPushTarget,
      nextCompareBaseRef?: string
    ): void => {
      setBaseBranch(nextBaseBranch)
      setCompareBaseRef(nextCompareBaseRef)
      setPushTarget(nextPushTarget)
      setBranchNameOverride(undefined)
      branchAutoNameRef.current = ''
      setStartFromResetHint(null)
      applyLinkedGitLabWorkItem(item)
      if (item.type === 'mr') {
        const suggestedNote = `MR !${item.number} — ${item.title}`
        const currentNote = noteRef.current
        if (!currentNote.trim() || currentNote === lastAutoNoteRef.current) {
          setNote(suggestedNote)
          lastAutoNoteRef.current = suggestedNote
        }
      }
    },
    [applyLinkedGitLabWorkItem]
  )

  const handleSmartGitHubItemSelect = useCallback(
    (item: GitHubWorkItem): void => {
      const identity = resolveGitHubWorkItemIdentity(item)
      const normalizedItem: GitHubWorkItem = {
        ...item,
        type: identity.type,
        number: identity.number
      }
      if (isProjectGroupTarget) {
        const linkedItem = toGitHubLinkedWorkItem(normalizedItem)
        setLinkedIssue(identity.type === 'issue' ? String(identity.number) : '')
        setLinkedPR(identity.type === 'pr' ? identity.number : null)
        setLinkedGitLabIssue(null)
        setLinkedGitLabMR(null)
        setLinkedWorkItem(linkedItem)
        setLinkedTaskSourceContext(selectedRepoGitHubSourceContext)
        const nextName = getLinkedItemDisplayName(linkedItem)
        if (
          nextName &&
          shouldApplyWorkspaceSourceAutoName({
            currentName: name,
            lastAutoName: lastAutoNameRef.current
          })
        ) {
          setName(nextName)
          lastAutoNameRef.current = nextName
        }
        return
      }
      setStartFromResetHint(null)
      setBranchNameOverride(undefined)
      setBranchNameOverridePreservesNameEdits(false)
      setForkPushWarning(null)
      branchAutoNameRef.current = ''
      smartGitHubPrStartPointSelectionRef.current = null
      // Why: provider items can come from a different source host than the run host — resolve refs against the run repo, keep item metadata for provider identity.
      const runRepo = selectedRepo ?? eligibleRepos.find((repo) => repo.id === item.repoId)
      applyLinkedWorkItem(normalizedItem)
      if (identity.type !== 'pr' || !runRepo) {
        setBaseBranch(undefined)
        setCompareBaseRef(undefined)
        setPushTarget(undefined)
        return
      }
      setBaseBranch(undefined)
      setCompareBaseRef(undefined)
      setPushTarget(undefined)
      const startPointSelection: SmartGitHubPrStartPointSelection = {
        repoId: runRepo.id,
        item: normalizedItem
      }
      smartGitHubPrStartPointSelectionRef.current = startPointSelection
      const itemRepoSettings = getSettingsForRepoRuntimeOwner(
        { repos: [runRepo], settings },
        runRepo.id
      )
      const resolvePrBase = resolveGitHubPrStartPointForRepo({
        repoId: runRepo.id,
        prNumber: identity.number,
        settings: itemRepoSettings,
        ...(normalizedItem.branchName ? { headRefName: normalizedItem.branchName } : {}),
        ...(normalizedItem.baseRefName ? { baseRefName: normalizedItem.baseRefName } : {}),
        ...(normalizedItem.isCrossRepository !== undefined
          ? { isCrossRepository: normalizedItem.isCrossRepository }
          : {})
      })
      void resolvePrBase
        .then((result) => {
          if (smartGitHubPrStartPointSelectionRef.current !== startPointSelection) {
            return
          }
          startPointSelection.resolved = result
          handleBaseBranchPrSelect(
            result.baseBranch,
            normalizedItem,
            result.pushTarget,
            result.branchNameOverride,
            result.compareBaseRef
          )
          // Why: a fork PR push lands on the contributor's fork; without maintainer-edits allowed GitHub rejects it, so warn up front.
          setForkPushWarning(getForkPushWarning(result))
        })
        .catch((error: unknown) => {
          if (smartGitHubPrStartPointSelectionRef.current !== startPointSelection) {
            return
          }
          setBaseBranch(undefined)
          setCompareBaseRef(undefined)
          setPushTarget(undefined)
          toast.error(
            error instanceof Error
              ? error.message
              : translate('auto.hooks.useComposerState.b2ead86962', 'Failed to resolve PR base.')
          )
        })
    },
    [
      applyLinkedWorkItem,
      eligibleRepos,
      handleBaseBranchPrSelect,
      isProjectGroupTarget,
      name,
      selectedRepo,
      selectedRepoGitHubSourceContext,
      settings
    ]
  )

  // Why: GitLab parallel of handleSmartGitHubItemSelect — resolves MR base via worktrees:resolveMrBase (refs/merge-requests/<iid>/head); issues short-circuit.
  const handleSmartGitLabItemSelect = useCallback(
    (item: GitLabWorkItem): void => {
      if (isProjectGroupTarget) {
        const linkedItem = toGitLabLinkedWorkItem(item)
        setLinkedGitLabIssue(item.type === 'issue' ? item.number : null)
        setLinkedGitLabMR(item.type === 'mr' ? item.number : null)
        setLinkedIssue('')
        setLinkedPR(null)
        setLinkedTaskSourceContext(null)
        setLinkedWorkItem(linkedItem)
        const nextName = getLinkedItemDisplayName(linkedItem)
        if (
          nextName &&
          shouldApplyWorkspaceSourceAutoName({
            currentName: name,
            lastAutoName: lastAutoNameRef.current
          })
        ) {
          setName(nextName)
          lastAutoNameRef.current = nextName
        }
        return
      }
      applyLinkedGitLabWorkItem(item)
      setStartFromResetHint(null)
      setBranchNameOverride(undefined)
      setBranchNameOverridePreservesNameEdits(false)
      setForkPushWarning(null)
      branchAutoNameRef.current = ''
      // Why: MR metadata can be sourced from one host/account while the workspace is created on another for the same logical project.
      const runRepo = selectedRepo ?? eligibleRepos.find((repo) => repo.id === item.repoId)
      if (item.type !== 'mr' || !runRepo) {
        setCompareBaseRef(undefined)
        return
      }
      setCompareBaseRef(undefined)
      const itemRepoSettings = getSettingsForRepoRuntimeOwner(
        { repos: [runRepo], settings },
        runRepo.id
      )
      const target = getActiveRuntimeTarget(itemRepoSettings)
      const resolveMrBase =
        target.kind === 'local'
          ? window.api.worktrees.resolveMrBase({
              repoId: runRepo.id,
              mrIid: item.number,
              ...(item.branchName ? { sourceBranch: item.branchName } : {}),
              ...(item.baseRefName ? { targetBranch: item.baseRefName } : {}),
              ...(item.isCrossRepository !== undefined
                ? { isCrossRepository: item.isCrossRepository }
                : {})
            })
          : callRuntimeRpc<
              | { baseBranch: string; compareBaseRef?: string; pushTarget?: GitPushTarget }
              | { error: string }
            >(
              target,
              'worktree.resolveMrBase',
              {
                repo: runRepo.id,
                mrIid: item.number,
                ...(item.branchName ? { sourceBranch: item.branchName } : {}),
                ...(item.baseRefName ? { targetBranch: item.baseRefName } : {}),
                ...(item.isCrossRepository !== undefined
                  ? { isCrossRepository: item.isCrossRepository }
                  : {})
              },
              { timeoutMs: 30_000 }
            )
      void resolveMrBase
        .then((result) => {
          if ('error' in result) {
            // Why: an unsurfaced failure silently falls back to the repo default branch, so clear stale base state and toast — mirrors the GitHub PR path.
            setBaseBranch(undefined)
            setCompareBaseRef(undefined)
            setPushTarget(undefined)
            toast.error(result.error)
            return
          }
          handleBaseBranchMrSelect(
            result.baseBranch,
            item,
            result.pushTarget,
            result.compareBaseRef
          )
        })
        .catch((error: unknown) => {
          setBaseBranch(undefined)
          setCompareBaseRef(undefined)
          setPushTarget(undefined)
          toast.error(
            error instanceof Error
              ? error.message
              : translate('auto.hooks.useComposerState.5f3d2c8a1b', 'Failed to resolve MR base.')
          )
        })
    },
    [
      applyLinkedGitLabWorkItem,
      eligibleRepos,
      handleBaseBranchMrSelect,
      isProjectGroupTarget,
      name,
      selectedRepo,
      settings
    ]
  )

  const handleSmartBranchSelect = useCallback(
    (refName: string, localBranchName: string): void => {
      smartGitHubPrStartPointSelectionRef.current = null
      const selection = resolveComposerBranchPick({
        refName,
        localBranchName,
        currentName: name,
        lastAutoName: lastAutoNameRef.current,
        worktreeBranches: getComposerRepoWorktreeBranches(worktreesByRepo[repoId] ?? [], repoId)
      })
      setBaseBranch(selection.baseBranch)
      setCompareBaseRef(undefined)
      setPushTarget(undefined)
      setStartFromResetHint(null)
      setForkPushWarning(null)
      // Why (#5181): reuse (check out) an existing branch instead of branching off it; git allows a branch in only one worktree, so gate eligibility on that.
      // Note: worktreesByRepo covers only visible worktrees; a branch busy in a hidden external worktree falls through to the backend "already exists locally" check.
      const { reuseEligibleBranch: nextReuseEligibleBranch, defaultReuse } = selection
      setReuseEligibleBranch(nextReuseEligibleBranch)
      setReuseSelectedBranch(defaultReuse)
      setBranchNameOverridePreservesNameEdits(defaultReuse)
      if (selection.name !== undefined && selection.lastAutoName !== undefined) {
        setName(selection.name)
        lastAutoNameRef.current = selection.lastAutoName
        branchAutoNameRef.current = selection.branchNameOverride ? selection.branchAutoName : ''
        setBranchNameOverride(selection.branchNameOverride)
      } else {
        setBranchNameOverride(selection.branchNameOverride)
        branchAutoNameRef.current = selection.branchNameOverride ? selection.branchAutoName : ''
      }
    },
    [name, worktreesByRepo, repoId]
  )

  const handleReuseSelectedBranchChange = useCallback(
    (next: boolean): void => {
      if (!reuseEligibleBranch) {
        return
      }
      setReuseSelectedBranch(next)
      // Why (#5181): reuse pins the existing branch as override (preserved across name edits); opting out drops it so a fresh branch is created from the ref.
      setBranchNameOverridePreservesNameEdits(next)
      setBranchNameOverride(next ? reuseEligibleBranch : undefined)
      if (next) {
        branchAutoNameRef.current = reuseEligibleBranch
      }
    },
    [reuseEligibleBranch]
  )

  const handleSmartLinearIssueSelect = useCallback(
    (issue: LinearIssue): void => {
      if (isProjectGroupTarget) {
        const linkedItem = toLinearLinkedWorkItem(issue)
        setLinkedIssue('')
        setLinkedPR(null)
        setLinkedGitLabIssue(null)
        setLinkedGitLabMR(null)
        setLinkedTaskSourceContext(null)
        setLinkedWorkItem(linkedItem)
        const suggestedName =
          getLinkedItemDisplayName(linkedItem) ?? getLinearIssueWorkspaceName(issue)
        if (
          shouldApplyWorkspaceSourceAutoName({
            currentName: name,
            lastAutoName: lastAutoNameRef.current
          }) ||
          name.trim().toLowerCase() === issue.identifier.toLowerCase()
        ) {
          setName(suggestedName)
          lastAutoNameRef.current = suggestedName
        }
        return
      }
      setLinkedIssue('')
      setLinkedPR(null)
      setLinkedGitLabIssue(null)
      setLinkedGitLabMR(null)
      setLinkedTaskSourceContext(null)
      const linkedLinearIssue = buildLinearIssueLinkedWorkItem(issue)
      setLinkedWorkItem(linkedLinearIssue)
      const suggestedName = getLinearIssueWorkspaceName(issue)
      // Why: same lookup-text rule as applyLinkedWorkItem, plus the typed Linear identifier ("STA-123") that matched this issue.
      if (
        shouldApplyWorkspaceSourceAutoName({
          currentName: name,
          lastAutoName: lastAutoNameRef.current
        }) ||
        name.trim().toLowerCase() === issue.identifier.toLowerCase()
      ) {
        setName(suggestedName)
        lastAutoNameRef.current = suggestedName
      }
      const linearBranchName = getLinearLinkedWorkItemBranchName(linkedLinearIssue)
      setBranchNameOverride(linearBranchName)
      setBranchNameOverridePreservesNameEdits(Boolean(linearBranchName))
      setForkPushWarning(null)
      branchAutoNameRef.current = linearBranchName ?? ''
      // Why: don't prefill the note for a Linear pick — that would turn a source selection into user-authored instructions (matches the GitHub flow).
    },
    [isProjectGroupTarget, name]
  )

  const handleSmartJiraIssueSelect = useCallback(
    (issue: JiraIssue, sourceContext: TaskSourceContext): void => {
      const linkedItem: LinkedWorkItemSummary = buildJiraWorkspaceSource(issue)
      setLinkedIssue('')
      setLinkedPR(null)
      setLinkedGitLabIssue(null)
      setLinkedGitLabMR(null)
      setBaseBranch(undefined)
      setCompareBaseRef(undefined)
      setPushTarget(undefined)
      setBranchNameOverride(undefined)
      setBranchNameOverridePreservesNameEdits(false)
      setForkPushWarning(null)
      branchAutoNameRef.current = ''
      setLinkedWorkItem(linkedItem)
      setLinkedTaskSourceContext(sourceContext)
      const suggestedName =
        getLinkedWorkItemWorkspaceName(linkedItem)?.seedName ??
        getLinkedWorkItemSuggestedName(linkedItem)
      // Why: the Jira lookup is async, so a name the user typed while it resolved must survive.
      if (
        suggestedName &&
        shouldApplyWorkspaceSourceAutoName({
          currentName: name,
          lastAutoName: lastAutoNameRef.current
        })
      ) {
        setName(suggestedName)
        lastAutoNameRef.current = suggestedName
      }
    },
    [name]
  )

  const handleClearSmartNameSelection = useCallback((): void => {
    smartGitHubPrStartPointSelectionRef.current = null
    setLinkedIssue('')
    setLinkedPR(null)
    setLinkedGitLabIssue(null)
    setLinkedGitLabMR(null)
    setLinkedWorkItem(null)
    setLinkedTaskSourceContext(null)
    setBaseBranch(undefined)
    setCompareBaseRef(undefined)
    setPushTarget(undefined)
    setBranchNameOverride(undefined)
    setBranchNameOverridePreservesNameEdits(false)
    setReuseEligibleBranch(null)
    setReuseSelectedBranch(false)
    setForkPushWarning(null)
    branchAutoNameRef.current = ''
    setStartFromResetHint(null)
    if (name === lastAutoNameRef.current) {
      setName('')
      lastAutoNameRef.current = ''
    }
    if (noteRef.current === lastAutoNoteRef.current) {
      setNote('')
      lastAutoNoteRef.current = ''
    }
  }, [name])

  const smartNameSelection = useMemo<SmartWorkspaceNameSelection | null>(() => {
    if (isProjectGroupTarget) {
      return getFolderSmartNameSelection(linkedWorkItem)
    }
    return buildWorkspaceSourceSelection({
      linkedWorkItem,
      baseBranch
    }) as SmartWorkspaceNameSelection | null
  }, [baseBranch, isProjectGroupTarget, linkedWorkItem])

  const handleOpenAgentSettings = useCallback((): void => {
    openSettingsTarget({ pane: 'agents', repoId: null })
    openSettingsPage()
    closeModal()
  }, [closeModal, openSettingsPage, openSettingsTarget])

  const handleOpenJiraSettings = useCallback((): void => {
    const runtimeEnvironmentId = getTaskSourceRuntimeSettings(
      smartNameJiraSourceContext
    ).activeRuntimeEnvironmentId
    const targetRuntimeEnvironmentId = runtimeEnvironmentId ?? null
    void setActiveRuntimeEnvironmentPreference(targetRuntimeEnvironmentId).then((selected) => {
      if (!selected) {
        return
      }
      openSettingsTarget({ pane: 'integrations', repoId: null })
      openSettingsPage()
      closeModal()
    })
  }, [
    closeModal,
    openSettingsPage,
    openSettingsTarget,
    setActiveRuntimeEnvironmentPreference,
    smartNameJiraSourceContext
  ])

  const applyWorktreeMeta = useCallback(
    async (worktreeId: string, meta: Partial<WorktreeMeta>): Promise<void> => {
      if (Object.keys(meta).length === 0) {
        return
      }
      try {
        await updateWorktreeMeta(worktreeId, meta)
      } catch {
        console.error('Failed to update worktree meta after creation')
      }
    },
    [updateWorktreeMeta]
  )

  const folderCreateDisabled =
    creating ||
    sourceIntentBlocksCreate ||
    !selectedProjectGroup?.parentPath ||
    folderPathStatusBlocksCreate ||
    folderTargetRequiresConnection

  const submitFolderTarget = useCallback(
    async (requestedAgent: TuiAgent | null): Promise<void> => {
      if (!selectedProjectGroup?.parentPath || folderCreateDisabled) {
        return
      }
      setCreateError(null)
      setCreating(true)
      try {
        const shouldResolveSmartGitHubSubmit = canResolveFolderSmartGitHubSubmit({
          hasFolderSourceRepos: folderSourceRepos.length > 0
        })
        const smartGitHubResolution = shouldResolveSmartGitHubSubmit
          ? await resolvePendingSmartGitHubSubmit()
          : ({ kind: 'none' } as const)
        const smartGitHubMetadata =
          smartGitHubResolution.kind === 'none' ? null : smartGitHubResolution
        const agent =
          requestedAgent && isTuiAgentEnabled(requestedAgent, disabledTuiAgents)
            ? requestedAgent
            : null
        const folderWorkspaceCreated = await submitFolderWorkspaceCreate({
          projectGroup: selectedProjectGroup,
          name: smartGitHubMetadata?.workspaceName ?? name,
          lastAutoName: lastAutoNameRef.current,
          linkedWorkItem: smartGitHubMetadata?.linkedWorkItem ?? linkedWorkItem,
          linkedTaskSourceContext: taskSourceContext,
          note,
          quickAgent: agent,
          autoRenameBranchFromWork: settings?.autoRenameBranchFromWork,
          agentCmdOverrides: settings?.agentCmdOverrides,
          agentArgs: agent
            ? resolveTuiAgentLaunchArgs(agent, settings?.agentDefaultArgs)
            : undefined,
          agentEnv: agent ? resolveTuiAgentLaunchEnv(agent, settings?.agentDefaultEnv) : undefined,
          sessionOptions: agent
            ? resolveNativeChatSessionOptionDefaults(settings?.nativeChatSessionOptions, agent)
            : undefined,
          terminalWindowsShell: settings?.terminalWindowsShell,
          isRemote: folderTargetIsRemote,
          launchSource: telemetrySource === 'onboarding' ? 'onboarding' : 'new_workspace_composer',
          runtimeEnvironmentId: folderTargetRuntimeEnvironmentId,
          createFolderWorkspace: (input) =>
            createFolderWorkspace(input, {
              runtimeEnvironmentId: folderTargetRuntimeEnvironmentId
            }),
          onOpenChange: (open) => {
            if (!open) {
              if (persistDraft) {
                clearNewWorkspaceDraft()
              }
              onCreated?.()
            }
          }
        })
        if (!folderWorkspaceCreated) {
          setCreateError({
            title: translate(
              'auto.hooks.useComposerState.folderWorkspaceCreateFailedTitle',
              'Folder workspace creation failed'
            ),
            message: translate(
              'auto.hooks.useComposerState.folderWorkspaceCreateFailedMessage',
              'The folder workspace could not be created. Check the error details above, then try again.'
            )
          })
        }
      } catch (error) {
        const formattedError = formatWorkspaceCreateError(error)
        setCreateError(formattedError)
        toast.error(getWorkspaceCreateErrorToastMessage(formattedError))
      } finally {
        setCreating(false)
      }
    },
    [
      clearNewWorkspaceDraft,
      createFolderWorkspace,
      disabledTuiAgents,
      folderCreateDisabled,
      folderTargetIsRemote,
      folderTargetRuntimeEnvironmentId,
      folderSourceRepos.length,
      linkedWorkItem,
      name,
      note,
      onCreated,
      persistDraft,
      resolvePendingSmartGitHubSubmit,
      selectedProjectGroup,
      settings?.agentCmdOverrides,
      settings?.agentDefaultArgs,
      settings?.agentDefaultEnv,
      settings?.autoRenameBranchFromWork,
      settings?.nativeChatSessionOptions,
      settings?.terminalWindowsShell,
      taskSourceContext,
      telemetrySource
    ]
  )

  const submit = useCallback(async (): Promise<void> => {
    if (isProjectGroupTarget) {
      await submitFolderTarget(tuiAgent)
      return
    }
    if (!repoId || !selectedRepo) {
      showProjectRequiredError()
      return
    }
    if (
      !workspaceSeedName ||
      selectedRepoRequiresConnection ||
      shouldWaitForSetupCheck ||
      shouldWaitForIssueAutomationCheck ||
      sourceIntentBlocksCreate ||
      (requiresExplicitSetupChoice && !setupDecision) ||
      sparseError !== null
    ) {
      return
    }
    if (!isTuiAgentEnabled(tuiAgent, disabledTuiAgents)) {
      setTuiAgent(fallbackDefaultAgent)
      toast.error(
        translate(
          'auto.hooks.useComposerState.7eb3f44ff7',
          'Selected agent is disabled. Choose an enabled agent before creating.'
        )
      )
      return
    }

    setCreateError(null)
    setCreating(true)
    try {
      const smartGitHubResolution = await resolvePendingSmartGitHubSubmit()
      const submitLinkedWorkItem =
        smartGitHubResolution.kind === 'none'
          ? linkedWorkItem
          : smartGitHubResolution.linkedWorkItem
      const submitLinkedIssueNumber =
        smartGitHubResolution.kind === 'none'
          ? parsedLinkedIssueNumber
          : smartGitHubResolution.linkedIssueNumber
      const submitLinkedPR =
        smartGitHubResolution.kind === 'none' ? effectiveLinkedPR : smartGitHubResolution.linkedPR
      const submitTitleName = submitLinkedWorkItem
        ? getLinkedWorkItemWorkspaceName(submitLinkedWorkItem)
        : null
      const nameIsAutoManaged = !isExplicitWorkspaceNameInput({
        name,
        lastAutoName: lastAutoNameRef.current
      })
      const smartGitHubCreateNames =
        smartGitHubResolution.kind === 'none'
          ? { workspaceName: workspaceSeedName, displayName: undefined }
          : resolveSmartGitHubCreateNames({
              resolutionKind: smartGitHubResolution.kind,
              smartWorkspaceName: smartGitHubResolution.workspaceName,
              smartDisplayName: smartGitHubResolution.displayName,
              fallbackWorkspaceName: workspaceSeedName,
              nameIsAutoManaged
            })
      const workspaceName =
        smartGitHubResolution.kind === 'none'
          ? nameIsAutoManaged && submitTitleName
            ? submitTitleName.seedName
            : workspaceSeedName
          : smartGitHubCreateNames.workspaceName
      if (!workspaceName) {
        return
      }
      const submitBaseBranch =
        smartGitHubResolution.kind === 'pr-start-point'
          ? smartGitHubResolution.baseBranch
          : smartGitHubResolution.kind === 'metadata-only' &&
              (effectiveLinkedPR !== null || linkedGitLabMR !== null)
            ? undefined
            : baseBranch
      const submitCompareBaseRef =
        smartGitHubResolution.kind === 'pr-start-point'
          ? smartGitHubResolution.compareBaseRef
          : smartGitHubResolution.kind === 'none'
            ? compareBaseRef
            : undefined
      const submitPushTarget =
        smartGitHubResolution.kind === 'pr-start-point'
          ? smartGitHubResolution.pushTarget
          : smartGitHubResolution.kind === 'none'
            ? pushTarget
            : undefined
      const submitBranchNameOverride =
        smartGitHubResolution.kind === 'pr-start-point'
          ? smartGitHubResolution.branchNameOverride
          : smartGitHubResolution.kind === 'none'
            ? branchNameOverride
            : undefined
      const submitLinkedWorkItemProvider = submitLinkedWorkItem
        ? getLinkedWorkItemProvider(submitLinkedWorkItem)
        : null
      const submitShouldApplyLinkedOnlyTemplate =
        enableIssueAutomation &&
        !agentPrompt.trim() &&
        Boolean(submitLinkedWorkItem) &&
        hasLoadedIssueCommand &&
        canUseIssueCommandForLinkedItemProvider(submitLinkedWorkItemProvider)
      const submitLinkedOnlyTemplatePrompt =
        submitShouldApplyLinkedOnlyTemplate && submitLinkedWorkItem
          ? renderIssueCommandTemplate(
              issueCommandTemplate.trim() || DEFAULT_ISSUE_COMMAND_TEMPLATE,
              {
                issueNumber:
                  submitLinkedWorkItem.type === 'issue' ? submitLinkedWorkItem.number : null,
                artifactUrl: submitLinkedWorkItem.url
              }
            )
          : ''
      const linkedPromptContext = getLinkedWorkItemPromptContext(submitLinkedWorkItem)
      const submitStartupPrompt = submitShouldApplyLinkedOnlyTemplate
        ? buildAgentPromptWithContext(
            submitLinkedOnlyTemplatePrompt,
            attachmentPaths,
            [],
            linkedPromptContext.linkedContextBlocks
          )
        : buildAgentPromptWithContext(
            agentPrompt,
            attachmentPaths,
            linkedPromptContext.linkedUrls,
            linkedPromptContext.linkedContextBlocks
          )
      const submitShouldRunIssueAutomation =
        enableIssueAutomation &&
        canUseIssueCommandForLinkedItemProvider(submitLinkedWorkItemProvider) &&
        submitLinkedIssueNumber !== null &&
        issueCommandTemplate.length > 0 &&
        !submitShouldApplyLinkedOnlyTemplate

      const setupTrustDecision = selectedRepoIsGit
        ? await ensureHooksConfirmed(useAppStore.getState(), repoId, 'setup')
        : 'skip'
      const effectiveSetupDecision: SetupDecision =
        setupTrustDecision === 'skip'
          ? 'skip'
          : ((resolvedSetupDecision ?? 'inherit') as SetupDecision)

      let issueCommandTrustDecision: 'run' | 'skip' = 'run'
      if (selectedRepoIsGit && submitShouldRunIssueAutomation) {
        issueCommandTrustDecision =
          setupTrustDecision === 'skip'
            ? 'skip'
            : await ensureHooksConfirmed(useAppStore.getState(), repoId, 'issueCommand')
      }

      const linkedLinearIssue =
        submitLinkedWorkItem && submitLinkedWorkItemProvider === 'linear'
          ? submitLinkedWorkItem.linearIdentifier
          : undefined
      const linkedLinearIssueWorkspaceId =
        submitLinkedWorkItem && submitLinkedWorkItemProvider === 'linear'
          ? submitLinkedWorkItem.linearWorkspaceId
          : undefined
      const linkedLinearIssueOrganizationUrlKey =
        submitLinkedWorkItem && submitLinkedWorkItemProvider === 'linear'
          ? submitLinkedWorkItem.linearOrganizationUrlKey
          : undefined
      const effectiveBranchNameOverride = resolveComposerBranchNameOverrideForCreate({
        branchNameOverride: submitBranchNameOverride,
        branchAutoName: branchAutoNameRef.current,
        workspaceName,
        preserveWorkspaceNameEdits:
          smartGitHubResolution.kind === 'pr-start-point' || branchNameOverridePreservesNameEdits,
        createBranchFromWorkspaceName:
          smartGitHubResolution.kind === 'none' && smartNameMode === 'branches'
      })
      const createDisplayName =
        smartGitHubResolution.kind === 'none'
          ? nameIsAutoManaged
            ? submitTitleName?.displayName
            : undefined
          : smartGitHubCreateNames.displayName
      // Why: the first-work hook only renames blank, auto-generated git workspaces that launch an agent; persist that pending state for the card.
      const pendingFirstAgentMessageRename =
        selectedRepoIsGit &&
        settings?.autoRenameBranchFromWork === true &&
        !name.trim() &&
        Boolean(tuiAgent) &&
        !effectiveBranchNameOverride &&
        !createDisplayName
      const startupPlan = buildAgentStartupPlan({
        agent: tuiAgent,
        prompt: submitStartupPrompt,
        cmdOverrides: settings?.agentCmdOverrides ?? {},
        agentArgs: resolveTuiAgentLaunchArgs(tuiAgent, settings?.agentDefaultArgs),
        agentEnv: resolveTuiAgentLaunchEnv(tuiAgent, settings?.agentDefaultEnv),
        sessionOptions: resolveNativeChatSessionOptionDefaults(
          settings?.nativeChatSessionOptions,
          tuiAgent
        ),
        platform: selectedRepoAgentLaunchPlatform,
        shell: selectedRepoStartupShell,
        isRemote: selectedRepoIsRemote
      })
      const shouldSeedInitialAgentStatus =
        tuiAgent === 'command-code' && submitStartupPrompt.trim().length > 0

      // Why: backend startup is safe only for self-contained launch commands; agents needing post-ready paste stay on the renderer path.
      const composerTelemetry: AgentStartedTelemetry = {
        agent_kind: tuiAgentToAgentKind(tuiAgent),
        launch_source: telemetrySource === 'onboarding' ? 'onboarding' : 'new_workspace_composer',
        request_kind: 'new'
      }
      const backendStartup =
        startupPlan && !startupPlan.draftPrompt && !startupPlan.followupPrompt
          ? {
              command: startupPlan.launchCommand,
              ...(startupPlan.env ? { env: startupPlan.env } : {}),
              launchConfig: startupPlan.launchConfig,
              launchAgent: tuiAgent,
              ...(startupPlan.startupCommandDelivery
                ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
                : {}),
              telemetry: composerTelemetry
            }
          : undefined
      if (!(await persistSetupAgentStartupPolicy())) {
        throw new Error(
          translate(
            'auto.hooks.useComposerState.setupAgentStartupPolicySaveFailed',
            'Failed to save setup startup behavior.'
          )
        )
      }
      const result = await createWorktree(
        repoId,
        workspaceName,
        selectedRepoIsGit ? submitBaseBranch : undefined,
        effectiveSetupDecision,
        selectedRepoIsGit && sparseEnabled
          ? {
              directories: normalizedSparseDirectories,
              ...(effectivePresetId ? { presetId: effectivePresetId } : {})
            }
          : undefined,
        telemetrySource,
        createDisplayName,
        submitLinkedIssueNumber ?? undefined,
        submitLinkedPR ?? undefined,
        submitPushTarget,
        tuiAgent,
        linkedLinearIssue,
        effectiveBranchNameOverride,
        resolvedInitialWorkspaceStatus,
        smartGitHubResolution.kind === 'none' ? (linkedGitLabMR ?? undefined) : undefined,
        smartGitHubResolution.kind === 'none' ? (linkedGitLabIssue ?? undefined) : undefined,
        backendStartup,
        pendingFirstAgentMessageRename,
        undefined,
        linkedLinearIssueWorkspaceId,
        linkedLinearIssueOrganizationUrlKey,
        undefined,
        undefined,
        undefined,
        submitCompareBaseRef,
        {
          linkedWorkItem: toFolderWorkspaceLinkedTask(submitLinkedWorkItem),
          linkedTaskSourceContext: taskSourceContext
        }
      )
      const worktree = result.worktree

      const trimmedNote = note.trim()
      // Why: linked source metadata is already in createWorktree; re-saving it can trigger slow post-create PR push-target lookups.
      await applyWorktreeMeta(worktree.id, trimmedNote ? { comment: trimmedNote } : {})

      const issueCommand =
        submitShouldRunIssueAutomation && issueCommandTrustDecision === 'run'
          ? {
              command: renderIssueCommandTemplate(issueCommandTemplate, {
                issueNumber: submitLinkedIssueNumber,
                artifactUrl: submitLinkedWorkItem?.url ?? null
              })
            }
          : undefined
      const backendSpawnedStartup = result.startupTerminal?.spawned === true
      if (startupPlan && !backendSpawnedStartup && !startupPlan.launchToken) {
        // Why: delayed delivery must target the exact pane from this queued startup, so both halves share one renderer-session token.
        startupPlan.launchToken = createBrowserUuid()
      }
      const activation = activateAndRevealWorktree(worktree.id, {
        sidebarRevealBehavior: 'auto',
        setup: result.setup,
        defaultTabs: result.defaultTabs,
        issueCommand,
        ...(startupPlan && !backendSpawnedStartup
          ? {
              startup: {
                command: startupPlan.launchCommand,
                ...(startupPlan.env ? { env: startupPlan.env } : {}),
                launchConfig: startupPlan.launchConfig,
                ...(startupPlan.launchToken ? { launchToken: startupPlan.launchToken } : {}),
                launchAgent: tuiAgent,
                ...(startupPlan.draftPrompt ? { draftPrompt: startupPlan.draftPrompt } : {}),
                ...(startupPlan.startupCommandDelivery
                  ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
                  : {}),
                ...(shouldSeedInitialAgentStatus
                  ? {
                      initialAgentStatus: {
                        agent: tuiAgent,
                        prompt: submitStartupPrompt.trim()
                      }
                    }
                  : {}),
                telemetry: composerTelemetry
              }
            }
          : {})
      })
      if (startupPlan) {
        const optionScopeKey =
          (activation !== false ? activation.primaryTabId : null) ?? result.startupTerminal?.tabId
        if (optionScopeKey) {
          seedNativeChatAppliedSessionOptions(optionScopeKey, tuiAgent, startupPlan.sessionOptions)
        }
      }
      if (startupPlan && !backendSpawnedStartup) {
        void ensureAgentStartupInTerminal({
          worktreeId: worktree.id,
          primaryTabId: activation === false ? null : activation.primaryTabId,
          startup: startupPlan
        })
      }
      setSidebarOpen(true)
      if (persistDraft) {
        clearNewWorkspaceDraft()
      }
      onCreated?.()
      queueWorkspaceActivationTerminalFocus(worktree.id, activation)
    } catch (error) {
      const formattedError = formatWorkspaceCreateError(error)
      setCreateError(formattedError)
      toast.error(getWorkspaceCreateErrorToastMessage(formattedError))
    } finally {
      setCreating(false)
    }
  }, [
    agentPrompt,
    attachmentPaths,
    baseBranch,
    branchNameOverride,
    branchNameOverridePreservesNameEdits,
    clearNewWorkspaceDraft,
    compareBaseRef,
    createWorktree,
    applyWorktreeMeta,
    enableIssueAutomation,
    issueCommandTemplate,
    effectiveLinkedPR,
    hasLoadedIssueCommand,
    linkedGitLabIssue,
    linkedGitLabMR,
    linkedWorkItem,
    name,
    normalizedSparseDirectories,
    note,
    onCreated,
    parsedLinkedIssueNumber,
    persistSetupAgentStartupPolicy,
    persistDraft,
    pushTarget,
    repoId,
    requiresExplicitSetupChoice,
    resolvePendingSmartGitHubSubmit,
    resolvedSetupDecision,
    resolvedInitialWorkspaceStatus,
    selectedRepo,
    selectedRepoAgentLaunchPlatform,
    selectedRepoIsRemote,
    selectedRepoStartupShell,
    selectedRepoIsGit,
    selectedRepoRequiresConnection,
    showProjectRequiredError,
    settings?.agentCmdOverrides,
    settings?.agentDefaultArgs,
    settings?.agentDefaultEnv,
    settings?.autoRenameBranchFromWork,
    settings?.nativeChatSessionOptions,
    smartNameMode,
    setSidebarOpen,
    setupDecision,
    sparseEnabled,
    sparseError,
    effectivePresetId,
    telemetrySource,
    fallbackDefaultAgent,
    disabledTuiAgents,
    tuiAgent,
    shouldWaitForIssueAutomationCheck,
    shouldWaitForSetupCheck,
    sourceIntentBlocksCreate,
    taskSourceContext,
    workspaceSeedName,
    isProjectGroupTarget,
    submitFolderTarget
  ])

  const resetForNextCreate = useCallback(() => {
    // Why: clears identity fields incl PR-pick-derived refs (else a half-set Start-from state — e.g. a silent fork push target — leaks into the next create); retains context (repo, base, agent, group) for fast sequential creates.
    setName('')
    lastAutoNameRef.current = ''
    setAgentPrompt('')
    setNote('')
    setAttachmentPaths([])
    setLinkedWorkItem(null)
    setLinkedTaskSourceContext(null)
    setLinkedIssue('')
    setLinkedPR(null)
    setLinkedGitLabIssue(null)
    setLinkedGitLabMR(null)
    setBranchNameOverride(undefined)
    setBranchNameOverridePreservesNameEdits(false)
    setCompareBaseRef(undefined)
    setPushTarget(undefined)
    setReuseSelectedBranch(false)
    setStartFromResetHint(null)
    setForkPushWarning(null)
    setCreateError(null)
    // Refocus after the reset re-render (next frame) so the user can type the next worktree name immediately.
    requestAnimationFrame(() => nameInputRef.current?.focus())
  }, [])

  const submitQuick = useCallback(
    async (requestedAgent: TuiAgent | null): Promise<void> => {
      if (isProjectGroupTarget) {
        await submitFolderTarget(requestedAgent)
        return
      }
      const workspaceNameSeed = getWorkspaceSeedName({
        explicitName: name,
        prompt: '',
        linkedIssueNumber: parsedLinkedIssueNumber,
        linkedPR,
        fallbackName: fallbackCreatureName
      })
      if (!repoId || !selectedRepo) {
        showProjectRequiredError()
        return
      }
      if (
        !workspaceNameSeed ||
        sourceIntentBlocksCreate ||
        selectedRepoRequiresConnection ||
        (requiresExplicitSetupChoice && !setupDecision) ||
        sparseError !== null
      ) {
        return
      }

      setCreateError(null)
      setCreating(true)
      try {
        const smartGitHubResolution = await resolvePendingSmartGitHubSubmit()
        const submitLinkedWorkItem =
          smartGitHubResolution.kind === 'none'
            ? linkedWorkItem
            : smartGitHubResolution.linkedWorkItem
        const agent =
          requestedAgent && isTuiAgentEnabled(requestedAgent, disabledTuiAgents)
            ? requestedAgent
            : null
        const submitLinkedIssueNumber =
          smartGitHubResolution.kind === 'none'
            ? parsedLinkedIssueNumber
            : smartGitHubResolution.linkedIssueNumber
        const submitLinkedPR =
          smartGitHubResolution.kind === 'none' ? effectiveLinkedPR : smartGitHubResolution.linkedPR
        const submitTitleName = submitLinkedWorkItem
          ? getLinkedWorkItemWorkspaceName(submitLinkedWorkItem)
          : null
        const nameIsAutoManaged = !isExplicitWorkspaceNameInput({
          name,
          lastAutoName: lastAutoNameRef.current
        })
        const smartGitHubCreateNames =
          smartGitHubResolution.kind === 'none'
            ? { workspaceName: workspaceNameSeed, displayName: undefined }
            : resolveSmartGitHubCreateNames({
                resolutionKind: smartGitHubResolution.kind,
                smartWorkspaceName: smartGitHubResolution.workspaceName,
                smartDisplayName: smartGitHubResolution.displayName,
                fallbackWorkspaceName: workspaceNameSeed,
                nameIsAutoManaged
              })
        const workspaceName =
          smartGitHubResolution.kind === 'none'
            ? nameIsAutoManaged && submitTitleName
              ? submitTitleName.seedName
              : workspaceNameSeed
            : smartGitHubCreateNames.workspaceName
        if (!workspaceName) {
          return
        }
        const smartSubmitBaseBranch =
          smartGitHubResolution.kind === 'pr-start-point'
            ? smartGitHubResolution.baseBranch
            : smartGitHubResolution.kind === 'metadata-only' &&
                (effectiveLinkedPR !== null || linkedGitLabMR !== null)
              ? undefined
              : baseBranch
        const submitCompareBaseRef =
          smartGitHubResolution.kind === 'pr-start-point'
            ? smartGitHubResolution.compareBaseRef
            : smartGitHubResolution.kind === 'none'
              ? compareBaseRef
              : undefined
        const submitPushTarget =
          smartGitHubResolution.kind === 'pr-start-point'
            ? smartGitHubResolution.pushTarget
            : smartGitHubResolution.kind === 'none'
              ? pushTarget
              : undefined
        const submitBranchNameOverride =
          smartGitHubResolution.kind === 'pr-start-point'
            ? smartGitHubResolution.branchNameOverride
            : smartGitHubResolution.kind === 'none'
              ? branchNameOverride
              : undefined

        let submitSetupConfig = setupConfig
        let submitResolvedSetupDecision = resolvedSetupDecision
        if (selectedRepoIsGit && checkedHooksRepoId !== repoId) {
          let hookCheck: HookCheckResult
          try {
            hookCheck = await loadHookCheckForRepo(repoId)
          } catch {
            hookCheck = { hasHooks: false, hooks: null, mayNeedUpdate: false }
          }
          if (!commitHookCheckIfCurrent(repoId, hookCheck.hooks)) {
            return
          }
          submitSetupConfig = getSetupConfig(selectedRepo, hookCheck.hooks)
          submitResolvedSetupDecision =
            setupDecision ??
            (!submitSetupConfig || setupPolicy === 'ask'
              ? null
              : setupPolicy === 'run-by-default'
                ? 'run'
                : 'skip')
        }
        if (selectedRepoIsGit && submitSetupConfig && setupPolicy === 'ask' && !setupDecision) {
          setAdvancedOpen(true)
          return
        }

        const trustDecision = selectedRepoIsGit
          ? await ensureHooksConfirmed(useAppStore.getState(), repoId, 'setup')
          : 'skip'
        const effectiveSetupDecision: SetupDecision =
          trustDecision === 'skip'
            ? 'skip'
            : ((submitResolvedSetupDecision ?? 'inherit') as SetupDecision)

        const submitLinkedWorkItemProvider = submitLinkedWorkItem
          ? getLinkedWorkItemProvider(submitLinkedWorkItem)
          : null
        const linkedLinearIssue =
          submitLinkedWorkItem && submitLinkedWorkItemProvider === 'linear'
            ? submitLinkedWorkItem.linearIdentifier
            : undefined
        const linkedLinearIssueWorkspaceId =
          submitLinkedWorkItem && submitLinkedWorkItemProvider === 'linear'
            ? submitLinkedWorkItem.linearWorkspaceId
            : undefined
        const linkedLinearIssueOrganizationUrlKey =
          submitLinkedWorkItem && submitLinkedWorkItemProvider === 'linear'
            ? submitLinkedWorkItem.linearOrganizationUrlKey
            : undefined
        const effectiveBranchNameOverride = resolveComposerBranchNameOverrideForCreate({
          branchNameOverride: submitBranchNameOverride,
          branchAutoName: branchAutoNameRef.current,
          workspaceName,
          preserveWorkspaceNameEdits:
            smartGitHubResolution.kind === 'pr-start-point' || branchNameOverridePreservesNameEdits,
          createBranchFromWorkspaceName:
            smartGitHubResolution.kind === 'none' && smartNameMode === 'branches'
        })
        const submitBaseBranch = selectedRepoIsGit
          ? await resolveWorktreeCreateBaseBranch({
              explicitBaseBranch: smartSubmitBaseBranch
            })
          : undefined
        const createDisplayName =
          smartGitHubResolution.kind === 'none'
            ? nameIsAutoManaged
              ? submitTitleName?.displayName
              : undefined
            : smartGitHubCreateNames.displayName
        // Why: quick create shares the blank-name flow; the card needs an explicit marker, not a guess from the title.
        const pendingFirstAgentMessageRename =
          selectedRepoIsGit &&
          settings?.autoRenameBranchFromWork === true &&
          !name.trim() &&
          Boolean(agent) &&
          !effectiveBranchNameOverride &&
          !createDisplayName
        const trimmedNote = note.trim()
        // Why: agents needing post-ready paste/follow-up stay on the renderer path so prompt delivery isn't skipped.
        const promptLinkedWorkItem = agent === null ? null : submitLinkedWorkItem
        const { prompt: quickPrompt, draftPrompt: quickDraftPrompt } =
          resolveQuickCreateLinkedWorkItemPrompt(promptLinkedWorkItem, trimmedNote)
        const draftLaunchPlan =
          agent === null || !quickDraftPrompt
            ? null
            : buildAgentDraftLaunchPlan({
                agent,
                draft: quickDraftPrompt,
                cmdOverrides: settings?.agentCmdOverrides ?? {},
                agentArgs: resolveTuiAgentLaunchArgs(agent, settings?.agentDefaultArgs),
                agentEnv: resolveTuiAgentLaunchEnv(agent, settings?.agentDefaultEnv),
                sessionOptions: resolveNativeChatSessionOptionDefaults(
                  settings?.nativeChatSessionOptions,
                  agent
                ),
                platform: selectedRepoAgentLaunchPlatform,
                shell: selectedRepoStartupShell,
                isRemote: selectedRepoIsRemote
              })

        let startupPlan: ReturnType<typeof buildAgentStartupPlan> = null
        if (draftLaunchPlan) {
          startupPlan = {
            agent: draftLaunchPlan.agent,
            launchCommand: draftLaunchPlan.launchCommand,
            expectedProcess: draftLaunchPlan.expectedProcess,
            followupPrompt: null,
            launchConfig: draftLaunchPlan.launchConfig,
            ...(draftLaunchPlan.sessionOptions
              ? { sessionOptions: draftLaunchPlan.sessionOptions }
              : {}),
            ...(draftLaunchPlan.startupCommandDelivery
              ? { startupCommandDelivery: draftLaunchPlan.startupCommandDelivery }
              : {}),
            ...(draftLaunchPlan.env ? { env: draftLaunchPlan.env } : {})
          }
        } else if (agent !== null) {
          startupPlan = buildAgentStartupPlan({
            agent,
            prompt: quickPrompt,
            cmdOverrides: settings?.agentCmdOverrides ?? {},
            agentArgs: resolveTuiAgentLaunchArgs(agent, settings?.agentDefaultArgs),
            agentEnv: resolveTuiAgentLaunchEnv(agent, settings?.agentDefaultEnv),
            sessionOptions: resolveNativeChatSessionOptionDefaults(
              settings?.nativeChatSessionOptions,
              agent
            ),
            platform: selectedRepoAgentLaunchPlatform,
            shell: selectedRepoStartupShell,
            isRemote: selectedRepoIsRemote,
            allowEmptyPromptLaunch: true
          })
          if (startupPlan && quickDraftPrompt) {
            startupPlan.draftPrompt = quickDraftPrompt
          }
        }

        const quickTelemetry: AgentStartedTelemetry | null =
          agent === null
            ? null
            : {
                agent_kind: tuiAgentToAgentKind(agent),
                launch_source:
                  telemetrySource === 'onboarding' ? 'onboarding' : 'new_workspace_composer',
                request_kind: 'new'
              }
        const backendStartup =
          startupPlan && !startupPlan.draftPrompt && !startupPlan.followupPrompt
            ? {
                command: startupPlan.launchCommand,
                ...(startupPlan.env ? { env: startupPlan.env } : {}),
                launchConfig: startupPlan.launchConfig,
                ...(agent ? { launchAgent: agent } : {}),
                ...(startupPlan.startupCommandDelivery
                  ? { startupCommandDelivery: startupPlan.startupCommandDelivery }
                  : {}),
                ...(quickTelemetry ? { telemetry: quickTelemetry } : {})
              }
            : undefined
        if (!(await persistSetupAgentStartupPolicy())) {
          throw new Error(
            translate(
              'auto.hooks.useComposerState.setupAgentStartupPolicySaveFailed',
              'Failed to save setup startup behavior.'
            )
          )
        }
        let creationWorkspaceRunContext: WorktreeCreationRequest['workspaceRunContext'] =
          selectedWorkspaceTarget.status === 'ready'
            ? {
                kind: 'workspace-run',
                projectId: selectedWorkspaceTarget.target.projectId,
                hostId: selectedWorkspaceTarget.target.hostId,
                projectHostSetupId: selectedWorkspaceTarget.target.projectHostSetupId,
                repoId: selectedWorkspaceTarget.target.repoId,
                path: selectedWorkspaceTarget.target.repo.path
              }
            : null
        let ephemeralVmRecipe: WorktreeCreationRequest['ephemeralVmRecipe']
        const activeEphemeralVmRecipeId = ephemeralVmsEnabled ? selectedEphemeralVmRecipeId : null
        if (activeEphemeralVmRecipeId && selectedWorkspaceTarget.status === 'ready') {
          const vmRecipeTrustDecision = await ensureHooksConfirmed(
            useAppStore.getState(),
            repoId,
            'vmRecipe'
          )
          if (vmRecipeTrustDecision === 'skip') {
            return
          }
          ephemeralVmRecipe = {
            sourceRepoId: repoId,
            recipeId: activeEphemeralVmRecipeId,
            projectId: selectedWorkspaceTarget.target.projectId
          }
        }

        const request: WorktreeCreationRequest = {
          repoId,
          ...(ephemeralVmRecipe ? { ephemeralVmRecipe } : {}),
          worktreeCreateProgressMode:
            activeEphemeralVmRecipeId ||
            getActiveRuntimeTarget(selectedRepoSettings).kind !== 'local'
              ? 'indeterminate'
              : 'stepped',
          ...(taskSourceContext ? { taskSourceContext } : {}),
          linkedWorkItem: toFolderWorkspaceLinkedTask(submitLinkedWorkItem),
          linkedTaskSourceContext: taskSourceContext,
          ...(creationWorkspaceRunContext
            ? { workspaceRunContext: creationWorkspaceRunContext }
            : {}),
          name: workspaceName,
          ...(createDisplayName ? { displayName: createDisplayName } : {}),
          ...(selectedRepoIsGit && submitBaseBranch ? { baseBranch: submitBaseBranch } : {}),
          ...(selectedRepoIsGit && submitCompareBaseRef
            ? { compareBaseRef: submitCompareBaseRef }
            : {}),
          setupDecision: effectiveSetupDecision,
          ...(selectedRepoIsGit && sparseEnabled
            ? {
                sparseCheckout: {
                  directories: normalizedSparseDirectories,
                  ...(effectivePresetId ? { presetId: effectivePresetId } : {})
                }
              }
            : {}),
          ...(telemetrySource ? { telemetrySource } : {}),
          ...(submitLinkedIssueNumber != null ? { linkedIssue: submitLinkedIssueNumber } : {}),
          ...(submitLinkedPR != null ? { linkedPR: submitLinkedPR } : {}),
          ...(submitPushTarget ? { pushTarget: submitPushTarget } : {}),
          agent,
          ...(linkedLinearIssue ? { linkedLinearIssue } : {}),
          ...(linkedLinearIssueWorkspaceId !== undefined ? { linkedLinearIssueWorkspaceId } : {}),
          ...(linkedLinearIssueOrganizationUrlKey !== undefined
            ? { linkedLinearIssueOrganizationUrlKey }
            : {}),
          ...(effectiveBranchNameOverride
            ? { branchNameOverride: effectiveBranchNameOverride }
            : {}),
          ...(resolvedInitialWorkspaceStatus
            ? { workspaceStatus: resolvedInitialWorkspaceStatus }
            : {}),
          ...(smartGitHubResolution.kind === 'none' && linkedGitLabMR != null
            ? { linkedGitLabMR }
            : {}),
          ...(smartGitHubResolution.kind === 'none' && linkedGitLabIssue != null
            ? { linkedGitLabIssue }
            : {}),
          ...(backendStartup ? { startup: backendStartup } : {}),
          pendingFirstAgentMessageRename,
          note: trimmedNote,
          startupPlan,
          quickPrompt,
          ...(quickDraftPrompt ? { launchDraftPrompt: quickDraftPrompt } : {}),
          quickTelemetry,
          ...(createMultiple ? { suppressTerminalFocusOnCompletion: true } : {})
        }

        // Why: git fetch + `git worktree add` can take 10–15s; run in the background so the modal isn't frozen.
        if (persistDraft) {
          clearNewWorkspaceDraft()
        }
        runBackgroundWorktreeCreation(request)
        if (createMultiple) {
          // Why: creation runs in the background, so reset identity to queue another worktree right away.
          resetForNextCreate()
        } else {
          onCreated?.()
        }
      } catch (error) {
        const formattedError = formatWorkspaceCreateError(error)
        setCreateError(formattedError)
        toast.error(getWorkspaceCreateErrorToastMessage(formattedError))
      } finally {
        setCreating(false)
      }
    },
    [
      baseBranch,
      compareBaseRef,
      branchNameOverride,
      branchNameOverridePreservesNameEdits,
      clearNewWorkspaceDraft,
      fallbackCreatureName,
      effectiveLinkedPR,
      linkedGitLabIssue,
      linkedGitLabMR,
      linkedPR,
      linkedWorkItem,
      name,
      normalizedSparseDirectories,
      note,
      onCreated,
      parsedLinkedIssueNumber,
      persistSetupAgentStartupPolicy,
      persistDraft,
      pushTarget,
      repoId,
      requiresExplicitSetupChoice,
      resolvePendingSmartGitHubSubmit,
      resolvedSetupDecision,
      resolvedInitialWorkspaceStatus,
      selectedRepo,
      selectedRepoAgentLaunchPlatform,
      selectedRepoIsRemote,
      selectedRepoStartupShell,
      selectedRepoIsGit,
      selectedRepoSettings,
      selectedRepoRequiresConnection,
      selectedWorkspaceTarget,
      selectedEphemeralVmRecipeId,
      ephemeralVmsEnabled,
      showProjectRequiredError,
      settings?.agentCmdOverrides,
      settings?.agentDefaultArgs,
      settings?.agentDefaultEnv,
      settings?.autoRenameBranchFromWork,
      settings?.nativeChatSessionOptions,
      smartNameMode,
      sourceIntentBlocksCreate,
      disabledTuiAgents,
      setupDecision,
      sparseEnabled,
      sparseError,
      effectivePresetId,
      telemetrySource,
      taskSourceContext,
      checkedHooksRepoId,
      commitHookCheckIfCurrent,
      loadHookCheckForRepo,
      setupConfig,
      setupPolicy,
      isProjectGroupTarget,
      submitFolderTarget,
      createMultiple,
      resetForNextCreate
    ]
  )

  const createGateInput = {
    repoId,
    workspaceSeedName,
    creating,
    shouldWaitForSetupCheck,
    shouldWaitForIssueAutomationCheck,
    sourceIntentBlocksCreate,
    requiresExplicitSetupChoice,
    hasSetupDecision: Boolean(setupDecision),
    selectedRepoRequiresConnection,
    sparseError
  }
  const repoCreateDisabled =
    createGateMode === 'quick'
      ? getQuickComposerCreateDisabled(createGateInput)
      : getFullComposerCreateDisabled(createGateInput)
  const createDisabled = isProjectGroupTarget ? folderCreateDisabled : repoCreateDisabled
  const cardProps: ComposerCardProps = {
    eligibleRepos: isProjectGroupTarget ? folderSourceRepos : eligibleRepos,
    repoId,
    projectOptions,
    selectedProjectId,
    selectedRepoIsGit: isProjectGroupTarget ? true : selectedRepoIsGit,
    onRepoChange: isProjectGroupTarget ? handleFolderSourceRepoChange : handleRepoChange,
    onProjectChange: handleProjectChange,
    projectHostSetupOptions: isProjectGroupTarget ? [] : projectHostSetupOptions,
    selectedProjectHostSetupId: isProjectGroupTarget ? null : selectedProjectHostSetupId,
    onProjectHostSetupChange: handleProjectHostSetupChange,
    ephemeralVmRecipes: isProjectGroupTarget || !ephemeralVmsEnabled ? [] : ephemeralVmRecipes,
    selectedEphemeralVmRecipeId:
      isProjectGroupTarget || !ephemeralVmsEnabled ? null : selectedEphemeralVmRecipeId,
    onEphemeralVmRecipeChange: setSelectedEphemeralVmRecipeId,
    ephemeralVmRecipeError:
      isProjectGroupTarget || !ephemeralVmsEnabled ? null : ephemeralVmRecipeError,
    repoBackedSearchRepos: isProjectGroupTarget ? folderSourceRepos : undefined,
    repoBackedSourcesDisabled: isProjectGroupTarget ? folderSourceRepos.length === 0 : false,
    allowSmartNameAddProject: !isProjectGroupTarget,
    smartNameRepoSwitchTarget: isProjectGroupTarget ? 'task-source' : 'project',
    name,
    onNameValueChange: handleNameValueChange,
    branchNameOverride: isProjectGroupTarget ? undefined : branchNameOverride,
    onBranchNameOverrideChange: isProjectGroupTarget ? () => {} : handleBranchNameOverrideChange,
    onSmartGitHubItemSelect: handleSmartGitHubItemSelect,
    onSmartGitLabItemSelect: handleSmartGitLabItemSelect,
    onSmartBranchSelect: isProjectGroupTarget ? () => {} : handleSmartBranchSelect,
    onSmartNameModeChange: setSmartNameMode,
    onSmartLinearIssueSelect: handleSmartLinearIssueSelect,
    onSmartJiraIssueSelect: handleSmartJiraIssueSelect,
    onOpenJiraSettings: handleOpenJiraSettings,
    smartNameGitHubSourceContext: selectedRepoGitHubSourceContext,
    smartNameJiraSourceContext,
    smartNameSelection,
    onClearSmartNameSelection: handleClearSmartNameSelection,
    canReuseSelectedBranch:
      !isProjectGroupTarget &&
      reuseEligibleBranch !== null &&
      smartNameSelection?.kind === 'branch',
    reuseSelectedBranch,
    onReuseSelectedBranchChange: handleReuseSelectedBranchChange,
    // Why: "create multiple" applies only to worktree (git) targets; folder-workspace keeps create-and-close.
    showCreateMultiple: !isProjectGroupTarget,
    createMultiple,
    onCreateMultipleChange: setCreateMultiple,
    agentPrompt,
    onAgentPromptChange: setAgentPrompt,
    linkedOnlyTemplatePreview: shouldApplyLinkedOnlyTemplate ? linkedOnlyTemplatePrompt : null,
    attachmentPaths,
    getAttachmentLabel,
    onAddAttachment: () => void handleAddAttachment(),
    onRemoveAttachment: (pathValue) =>
      setAttachmentPaths((current) => current.filter((currentPath) => currentPath !== pathValue)),
    linkedWorkItem,
    onRemoveLinkedWorkItem: handleRemoveLinkedWorkItem,
    linkPopoverOpen,
    onLinkPopoverOpenChange: handleLinkPopoverChange,
    linkQuery,
    onLinkQueryChange: setLinkQuery,
    filteredLinkItems,
    linkItemsLoading,
    linkDirectLoading,
    normalizedLinkQuery,
    onSelectLinkedItem: handleSelectLinkedItem,
    tuiAgent,
    onTuiAgentChange: setTuiAgent,
    detectedAgentIds: isProjectGroupTarget ? folderDetectedAgentIds : detectedAgentIds,
    onOpenAgentSettings: handleOpenAgentSettings,
    advancedOpen,
    onToggleAdvanced: () => setAdvancedOpen((current) => !current),
    createDisabled,
    projectError: isProjectGroupTarget ? pathStatusProjectError : projectError,
    creating,
    onCreate: () => void submit(),
    baseBranch: isProjectGroupTarget ? undefined : baseBranch,
    onBaseBranchChange: isProjectGroupTarget ? () => {} : handleBaseBranchChange,
    onBaseBranchPrSelect: isProjectGroupTarget ? () => {} : handleBaseBranchPrSelect,
    onBaseBranchMrSelect: isProjectGroupTarget ? () => {} : handleBaseBranchMrSelect,
    baseBranchLinkedPrNumber:
      linkedWorkItem?.type === 'pr' && baseBranch ? linkedWorkItem.number : null,
    selectedRepoPath: isProjectGroupTarget ? null : (selectedRepo?.path ?? null),
    selectedRepoIsRemote: isProjectGroupTarget
      ? folderTargetIsRemote
      : Boolean(selectedRepo?.connectionId),
    selectedRepoConnectionId: isProjectGroupTarget
      ? folderTargetConnectionId
      : selectedRepoConnectionId,
    selectedRepoSshStatus: isProjectGroupTarget ? folderTargetSshStatus : selectedRepoSshStatus,
    selectedRepoRequiresConnection: isProjectGroupTarget
      ? folderTargetRequiresConnection
      : selectedRepoRequiresConnection,
    selectedRepoConnectInProgress: isProjectGroupTarget
      ? folderTargetConnectInProgress
      : selectedRepoConnectInProgress,
    onConnectSelectedRepo: isProjectGroupTarget
      ? onConnectSelectedProjectGroup
      : onConnectSelectedRepo,
    startFromResetHint: isProjectGroupTarget ? null : startFromResetHint,
    forkPushWarning: isProjectGroupTarget ? null : forkPushWarning,
    note,
    onNoteChange: setNote,
    setupConfig: isProjectGroupTarget ? null : setupConfig,
    requiresExplicitSetupChoice: isProjectGroupTarget ? false : requiresExplicitSetupChoice,
    setupDecision: isProjectGroupTarget ? null : setupDecision,
    onSetupDecisionChange: isProjectGroupTarget ? () => {} : setSetupDecision,
    setupAgentStartupPolicy: isProjectGroupTarget ? 'start-immediately' : setupAgentStartupPolicy,
    onSetupAgentStartupPolicyChange: isProjectGroupTarget
      ? () => {}
      : handleSetupAgentStartupPolicyChange,
    shouldWaitForSetupCheck: isProjectGroupTarget ? false : shouldWaitForSetupCheck,
    resolvedSetupDecision: isProjectGroupTarget ? null : resolvedSetupDecision,
    createError,
    canUseSparseCheckout: isProjectGroupTarget
      ? false
      : selectedRepoIsGit && !selectedRepo?.connectionId,
    sparsePresets: isProjectGroupTarget ? [] : sparsePresets,
    sparseSelectedPresetId: isProjectGroupTarget ? null : sparseSelectedPresetId,
    onSparseSelectPreset: isProjectGroupTarget ? () => {} : handleSparseSelectPreset,
    branchesEnabled: !isProjectGroupTarget,
    setupControlsEnabled: !isProjectGroupTarget,
    sparseControlsEnabled: !isProjectGroupTarget
  }

  return {
    cardProps,
    composerRef,
    onComposerNodeChange: handleComposerNodeChange,
    promptTextareaRef,
    nameInputRef,
    submit,
    submitQuick,
    createDisabled,
    selectAddedProjectRepo
  }
}

export default useComposerState
