import { useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import {
  buildTaskSourceContextFromRepo,
  normalizeTaskSourceContext,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import { filterEnabledTuiAgents, isTuiAgentEnabled } from '../../../shared/tui-agent-selection'
import type {
  GitHubRepositoryIdentity,
  GitHubWorkItem,
  GitPushTarget,
  OrcaHooks,
  SetupAgentStartupPolicy,
  TuiAgent,
  WorkspaceCreateErrorDisplay
} from '../../../shared/types'
import {
  CONTEXTUAL_TOUR_ENABLE_AUTO_WORKSPACE_NAME_EVENT
} from '@/components/contextual-tours/contextual-tour-composer-events'
import {
  getAgentCatalog
} from '@/lib/agent-catalog'
import {
  getLinkedWorkItemProvider,
  isGitLabIssueUrl,
  type LinkedWorkItemSummary
} from '@/lib/new-workspace'
import {
  getLinearLinkedWorkItemBranchName,
  isLinearLinkedWorkItem
} from '@/lib/linear-linked-work-item'
import { resolveJiraSourceHostId } from '@/lib/jira-source-host'
import { isBlockingJiraUrlIntent, type SmartNameMode } from '@/components/new-workspace/smart-workspace-source-results'
import {
  getInitialAutoManagedWorkspaceName,
  getMatchingLinkedTaskSourceContext,
  getGitHubLinkedWorkItemIdentity,
  normalizeGitHubLinkedWorkItem,
  getRepoSetupAgentStartupPolicy,
  type SmartGitHubPrStartPointSelection
} from './composer-state-contracts'

export function useComposerFormState(context: any) {
  const {
    initialName = '',
    initialPrompt = '',
    initialLinkedWorkItem = null,
    initialTaskSourceContext = null,
    initialBaseBranch,
    persistDraft,
    newWorkspaceDraft,
    settings,
    projects,
    repoId,
    selectedProjectGroup,
    selectedProjectId,
    selectedProjectHostSetupId,
    selectedRepo,
    selectedRepoIsGit,
    selectedRepoConnectionId,
    selectedRepoSettings,
    selectedWorkspaceTarget,
    isProjectGroupTarget,
    folderSourceRepos,
  } = context

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

  return {
    name,
    setName,
    agentPrompt,
    setAgentPrompt,
    note,
    setNote,
    attachmentPaths,
    setAttachmentPaths,
    linkedWorkItem,
    setLinkedWorkItem,
    linkedTaskSourceContext,
    setLinkedTaskSourceContext,
    taskSourceContext,
    selectedRepoGitHubSourceContext,
    smartNameJiraSourceContext,
    linkedIssue,
    setLinkedIssue,
    linkedPR,
    setLinkedPR,
    linkedGitLabIssue,
    setLinkedGitLabIssue,
    linkedGitLabMR,
    setLinkedGitLabMR,
    baseBranch,
    setBaseBranch,
    compareBaseRef,
    setCompareBaseRef,
    branchNameOverride,
    setBranchNameOverride,
    branchNameOverridePreservesNameEdits,
    setBranchNameOverridePreservesNameEdits,
    smartNameMode,
    setSmartNameMode,
    sourceIntentBlocksCreate,
    reuseEligibleBranch,
    setReuseEligibleBranch,
    reuseSelectedBranch,
    setReuseSelectedBranch,
    pushTarget,
    setPushTarget,
    startFromResetHint,
    setStartFromResetHint,
    forkPushWarning,
    setForkPushWarning,
    disabledTuiAgents,
    fallbackDefaultAgent,
    tuiAgent,
    setTuiAgent,
    connectionId,
    isRemote,
    runtimeEnvironmentId,
    detectedAgentList,
    ensureDetectedAgents,
    ensureRemoteDetectedAgents,
    ensureRuntimeDetectedAgents,
    detectedAgentIds,
    yamlHooks,
    setYamlHooks,
    checkedHooksRepoId,
    setCheckedHooksRepoId,
    issueCommandTemplate,
    setIssueCommandTemplate,
    hasLoadedIssueCommand,
    setHasLoadedIssueCommand,
    setupDecision,
    setSetupDecision,
    setupAgentStartupPolicy,
    setSetupAgentStartupPolicy,
    setupAgentStartupPolicyRef,
    setupAgentStartupPolicySaveRef,
    setupAgentStartupPolicyDraftRef,
    creating,
    setCreating,
    createError,
    setCreateError,
    createMultiple,
    setCreateMultiple,
    advancedOpen,
    setAdvancedOpen,
    sparseEnabled,
    setSparseEnabled,
    sparseDirectories,
    setSparseDirectories,
    sparseSelectedPresetId,
    setSparseSelectedPresetId,
    linkPopoverOpen,
    setLinkPopoverOpen,
    linkQuery,
    setLinkQuery,
    linkDebouncedQuery,
    setLinkDebouncedQuery,
    linkItems,
    setLinkItems,
    linkItemsLoading,
    setLinkItemsLoading,
    linkDirectItem,
    setLinkDirectItem,
    linkDirectLoading,
    setLinkDirectLoading,
    lastAutoNameRef,
    nameRef,
    branchAutoNameRef,
    lastAutoNoteRef,
    noteRef,
    smartGitHubPrStartPointSelectionRef,
    composerRef,
    promptTextareaRef,
    promptCaretFrameRef,
    nameInputRef,
    agentPromptRef,
    connectionIdRef,
    selectedRepoConnectionIdRef,
    selectedRepoSlug,
    setSelectedRepoSlug,
    selectedRepoPath,
    selectedRepoPathRef,
    selectedRepoSettingsRef
  }
}
