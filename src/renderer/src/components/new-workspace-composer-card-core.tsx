import { getClientRuntime } from '@/runtime/client-runtime'
import React from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  CornerDownLeft,
  FolderPlus,
  LoaderCircle,
  PlugZap,
  Settings2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SettingsSwitch } from '@/components/settings/SettingsFormControls'
import type RepoCombobox from '@/components/repo/RepoCombobox'
import AgentCombobox from '@/components/agent/AgentCombobox'
import { getAgentCatalog } from '@/lib/agent-catalog'
import {
  DEFAULT_DISABLED_TUI_AGENTS,
  filterEnabledTuiAgents
} from '../../../shared/tui-agent-selection'
import { useAppStore } from '@/store'
import { cn } from '@/lib/utils'
import NewWorkspaceComposerCardSurface from './new-workspace-composer-card-surface'
import {
  TEXT_CONTROL_PASTE_DIRECT_MAX_BYTES,
  measureTextControlPasteByteLength,
  pasteTextIntoTextControl,
  shouldHandleTextControlPaste
} from '@/lib/text-control-paste'
import { getScreenSubmitModifierLabel } from '@/lib/screen-submit-shortcut'
import { useContextualTour } from '@/components/contextual-tours/use-contextual-tour'
import type {
  GitHubWorkItem,
  GitLabWorkItem,
  JiraIssue,
  LinearIssue,
  SetupAgentStartupPolicy,
  OrcaHooks,
  SparsePreset,
  TuiAgent
} from '../../../shared/types'
import SparseCheckoutPresetSelect from '@/components/sparse/SparseCheckoutPresetSelect'
import SmartWorkspaceNameField, {
  type SmartWorkspaceNameSelection
} from '@/components/new-workspace/SmartWorkspaceNameField'
import type { SmartNameMode } from '@/components/new-workspace/smart-workspace-source-results'
import ProjectCombobox from '@/components/new-workspace/ProjectCombobox'
import RunTargetCombobox from '@/components/new-workspace/RunTargetCombobox'
import {
  AddRemoteHostDialog,
  type AddRemoteHostMode
} from '@/components/sidebar/AddRemoteHostDialog'
import type { SetupConfig } from '@/lib/new-workspace'
import type { NewWorkspaceProjectOption } from '@/lib/new-workspace-project-options'
import type {
  NeedsSetupProjectHostOption,
  ProjectHostSetupOption
} from '@/lib/project-host-setup-options'
import type { WorkspaceCreateErrorDisplay } from '@/lib/workspace-create-error-format'
import type { SshConnectionStatus } from '../../../shared/ssh-types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { RuntimeStatus } from '../../../shared/runtime-types'
import { unwrapRuntimeRpcResult } from '@/runtime/runtime-rpc-client'
import { translate } from '@/i18n/i18n'

import {
  EMPTY_EPHEMERAL_VM_RECIPES,
  EMPTY_PROJECT_HOST_SETUP_OPTIONS,
  EMPTY_PROJECT_OPTIONS,
  type NewWorkspaceComposerCardProps
} from './new-workspace-composer-card-contracts'
import {
  getSshStatusLabel,
  useComposerFileDragOver,
  withUiConnectTimeout
} from './new-workspace-composer-card-interactions'
export default function NewWorkspaceComposerCard({
  contextualTourSource,
  containerClassName,
  composerRef,
  onComposerNodeChange,
  nameInputRef,
  quickAgent,
  onQuickAgentChange,
  eligibleRepos,
  repoId,
  projectOptions = EMPTY_PROJECT_OPTIONS,
  selectedProjectId = null,
  selectedRepoIsGit,
  onRepoChange,
  onProjectChange,
  projectHostSetupOptions = EMPTY_PROJECT_HOST_SETUP_OPTIONS,
  selectedProjectHostSetupId = null,
  onProjectHostSetupChange,
  ephemeralVmRecipes = EMPTY_EPHEMERAL_VM_RECIPES,
  selectedEphemeralVmRecipeId = null,
  onEphemeralVmRecipeChange,
  ephemeralVmRecipeError = null,
  repoBackedSearchRepos,
  repoBackedSourcesDisabled = false,
  allowSmartNameAddProject = true,
  smartNameRepoSwitchTarget = 'project',
  primaryActionLabel,
  projectLabel,
  projectPlaceholder,
  emptyProjectMessage,
  showAddProjectButton = true,
  name,
  onNameValueChange,
  branchNameOverride,
  onBranchNameOverrideChange,
  onSmartGitHubItemSelect,
  onSmartGitLabItemSelect,
  onSmartBranchSelect,
  onSmartNameModeChange,
  onSmartLinearIssueSelect,
  onSmartJiraIssueSelect,
  onOpenJiraSettings,
  smartNameSelection,
  onClearSmartNameSelection,
  canReuseSelectedBranch,
  reuseSelectedBranch,
  onReuseSelectedBranchChange,
  showCreateMultiple = false,
  createMultiple = false,
  onCreateMultipleChange,
  smartNameGitHubSourceContext,
  smartNameJiraSourceContext,
  forkPushWarning,
  detectedAgentIds,
  onOpenAgentSettings,
  advancedOpen,
  onToggleAdvanced,
  createDisabled,
  projectError,
  creating,
  onCreate,
  note,
  onNoteChange,
  setupConfig,
  requiresExplicitSetupChoice,
  setupDecision,
  onSetupDecisionChange,
  setupAgentStartupPolicy,
  onSetupAgentStartupPolicyChange,
  shouldWaitForSetupCheck,
  resolvedSetupDecision,
  createError,
  selectedRepoConnectionId,
  selectedRepoSshStatus,
  selectedRepoRequiresConnection,
  selectedRepoConnectInProgress,
  onConnectSelectedRepo,
  branchesEnabled = true,
  setupControlsEnabled = true,
  canUseSparseCheckout,
  sparsePresets,
  sparseSelectedPresetId,
  onSparseSelectPreset,
  sparseControlsEnabled = true,
  onAddProjectOverride
}: NewWorkspaceComposerCardProps): React.JSX.Element {
  // Why: subscribe (form uses translate() directly) so an open create dialog repaints when the UI language changes.
  useTranslation()
  const { isFileDragOver, dragHandlers } = useComposerFileDragOver()
  const openModal = useAppStore((s) => s.openModal)
  const activeModal = useAppStore((s) => s.activeModal)
  const defaultTuiAgent = useAppStore((s) => s.settings?.defaultTuiAgent ?? null)
  const disabledTuiAgents = useAppStore(
    (s) => s.settings?.disabledTuiAgents ?? DEFAULT_DISABLED_TUI_AGENTS
  )
  const updateSettings = useAppStore((s) => s.updateSettings)
  const nameInputFocusFrameRef = React.useRef<number | null>(null)
  const branchNameInputId = React.useId()
  const submitShortcutModifierLabel = getScreenSubmitModifierLabel()
  const selectedRepoName = React.useMemo(() => {
    const repo = eligibleRepos.find((candidate) => candidate.id === repoId)
    return repo?.displayName ?? repo?.path ?? 'This project'
  }, [eligibleRepos, repoId])
  const selectedProjectName = React.useMemo(() => {
    const option = projectOptions.find((candidate) => candidate.id === selectedProjectId)
    return option?.displayName ?? selectedRepoName
  }, [projectOptions, selectedProjectId, selectedRepoName])
  const sshStatusLabel = selectedRepoSshStatus
    ? getSshStatusLabel(selectedRepoSshStatus)
    : translate('auto.components.NewWorkspaceComposerCard.notConnected', 'Not connected')
  const connectButtonLabel =
    selectedRepoSshStatus === 'disconnected' || selectedRepoSshStatus === null
      ? 'Connect'
      : 'Reconnect'
  const setupConfigLabel =
    setupConfig?.kind === 'default-tabs'
      ? 'Default tab commands'
      : setupConfig?.kind === 'setup-and-default-tabs'
        ? 'Setup and default tab commands'
        : 'Setup script'
  const setupRunLabel =
    setupConfig?.kind === 'default-tabs'
      ? 'Run default tab commands'
      : setupConfig?.kind === 'setup-and-default-tabs'
        ? 'Run setup and default tab commands'
        : 'Run setup command'
  const setupAskLabel =
    setupConfig?.kind === 'default-tabs'
      ? 'Run default tab commands now?'
      : setupConfig?.kind === 'setup-and-default-tabs'
        ? 'Run setup and default tab commands now?'
        : 'Run setup now?'
  const setupRunButtonLabel =
    setupConfig?.kind === 'default-tabs'
      ? 'Run commands now'
      : setupConfig?.kind === 'setup-and-default-tabs'
        ? 'Run commands now'
        : 'Run setup now'
  const setupSkipButtonLabel = setupConfig?.kind === 'setup' ? 'Skip for now' : 'Skip commands'
  // Why: defaultTabs launch commands can run long too, but aren't the setup command this setting gates agent startup on.
  const showSetupAgentStartupPolicy =
    setupControlsEnabled && setupConfig !== null && setupConfig.kind !== 'default-tabs'

  const handleSetDefaultAgent = React.useCallback(
    (next: TuiAgent | 'blank' | null) => {
      updateSettings({ defaultTuiAgent: next })
    },
    [updateSettings]
  )

  const cancelNameInputFocusFrame = React.useCallback((): void => {
    if (nameInputFocusFrameRef.current === null) {
      return
    }
    cancelAnimationFrame(nameInputFocusFrameRef.current)
    nameInputFocusFrameRef.current = null
  }, [])

  const setComposerNode = React.useCallback(
    (node: HTMLDivElement | null): void => {
      // Why: the queued repo-picker focus is only valid while this composer exists.
      if (!node) {
        cancelNameInputFocusFrame()
      }
      if (composerRef) {
        composerRef.current = node
      }
      onComposerNodeChange?.(node)
    },
    [cancelNameInputFocusFrame, composerRef, onComposerNodeChange]
  )

  const focusNameInput = React.useCallback(() => {
    // Why: move focus to the name field after the repo pick so keyboard flow continues instead of trapping in the repo popover.
    cancelNameInputFocusFrame()
    nameInputFocusFrameRef.current = requestAnimationFrame(() => {
      nameInputFocusFrameRef.current = null
      nameInputRef?.current?.focus()
    })
  }, [cancelNameInputFocusFrame, nameInputRef])

  const visibleQuickAgents = React.useMemo(() => {
    const enabledIds = new Set(
      filterEnabledTuiAgents(
        getAgentCatalog().map((agent) => agent.id),
        disabledTuiAgents
      )
    )
    return getAgentCatalog().filter(
      (agent) =>
        enabledIds.has(agent.id) && (detectedAgentIds === null || detectedAgentIds.has(agent.id))
    )
  }, [detectedAgentIds, disabledTuiAgents])

  const handleAddRepo = React.useCallback((): void => {
    // Why: swapping activeModal would unmount the composer, so the override layers Add Project on top instead.
    if (onAddProjectOverride) {
      onAddProjectOverride()
      return
    }
    openModal('add-repo')
  }, [onAddProjectOverride, openModal])
  // Why: open the host-add form inline over the composer (not via Settings) so the user's
  // in-progress workspace form survives; the new host lands in the store and flows straight
  // back into the run-target picker without a navigation round-trip.
  const [addRemoteHostMode, setAddRemoteHostMode] = React.useState<AddRemoteHostMode | null>(null)
  const handleAddSshHost = React.useCallback((): void => {
    setAddRemoteHostMode('ssh')
  }, [])
  const handleAddRemoteServer = React.useCallback((): void => {
    setAddRemoteHostMode('server')
  }, [])
  const handleConnectRunTargetHost = React.useCallback(
    async (option: NeedsSetupProjectHostOption): Promise<void> => {
      const action = option.connectAction
      if (!action) {
        return
      }
      try {
        if (action.kind === 'ssh') {
          // Why: ssh.connect has no built-in timeout; a stalled connect would otherwise leave the
          // row's spinner/disabled state stuck forever. Bound the UI wait — the backend keeps
          // connecting and the picker updates from store SSH state if it later succeeds.
          await withUiConnectTimeout(window.api.ssh.connect({ targetId: action.targetId }))
          return
        }

        const response = await getClientRuntime().remoteHost.getStatus({
          selector: action.environmentId,
          timeoutMs: 15_000
        })
        const runtimeStatus = unwrapRuntimeRpcResult<RuntimeStatus>(response)
        // Why: the composer button is only a reachability retry; the separate
        // project setup flow remains a follow-up once the host is online.
        useAppStore.getState().setRuntimeEnvironmentStatus(action.environmentId, {
          status: runtimeStatus,
          checkedAt: Date.now()
        })
      } catch (error) {
        if (action.kind === 'runtime') {
          useAppStore.getState().setRuntimeEnvironmentStatus(action.environmentId, {
            status: null,
            checkedAt: Date.now()
          })
        }
        toast.error(
          error instanceof Error
            ? error.message
            : translate(
                'auto.components.NewWorkspaceComposerCard.hostConnectionFailed',
                'Connection failed'
              )
        )
      }
    },
    []
  )
  const handleNotePaste = React.useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = event.clipboardData.getData('text/plain')
    const byteLengthMeasurement = measureTextControlPasteByteLength(text, {
      stopAfterBytes: TEXT_CONTROL_PASTE_DIRECT_MAX_BYTES
    })
    if (
      !byteLengthMeasurement.exceededLimit &&
      !shouldHandleTextControlPaste(text, { measuredByteLength: byteLengthMeasurement.byteLength })
    ) {
      return
    }

    event.preventDefault()
    event.stopPropagation()
    const textarea = event.currentTarget
    // Why: large note pastes need one controlled owner so React gets a single final input event after chunked DOM insertion.
    void pasteTextIntoTextControl(textarea, text, {
      source: 'clipboard',
      canContinue: (target) => target.ownerDocument.activeElement === target
    })
      .then((result) => {
        if (result.status === 'rejected' && result.reason === 'too-large') {
          toast.error(
            translate(
              'auto.components.NewWorkspaceComposerCard.notePasteTooLarge',
              'Paste is too large for the note field.'
            )
          )
        }
      })
      .catch(() => {})
  }, [])
  const projectDescriptionId = React.useId()
  const readyProjectHostSetupOptions = React.useMemo(
    () => projectHostSetupOptions.filter((option) => option.kind === 'ready'),
    [projectHostSetupOptions]
  )
  const needsSetupProjectHostSetupOptions = React.useMemo(
    () => projectHostSetupOptions.filter((option) => option.kind === 'needs-setup'),
    [projectHostSetupOptions]
  )
  // Why: the picker now also hosts the Add host handoff; even a single ready
  // host needs this affordance for users who have not registered the target yet.
  const shouldShowRunTargetPicker =
    readyProjectHostSetupOptions.length > 0 ||
    ephemeralVmRecipes.length > 0 ||
    needsSetupProjectHostSetupOptions.length > 0
  const handleProjectHostSetupChange = React.useCallback(
    (setupId: string): void => {
      onProjectHostSetupChange?.(setupId)
    },
    [onProjectHostSetupChange]
  )
  useContextualTour(
    'workspace-creation',
    projectOptions.length > 0 && Boolean(selectedProjectId),
    contextualTourSource ??
      (activeModal === 'new-workspace-composer'
        ? 'workspace_creation_modal'
        : 'workspace_creation_visible')
  )

  const surfaceContext = {
    activeModal,
    addRemoteHostMode,
    advancedOpen,
    allowSmartNameAddProject,
    branchNameInputId,
    branchNameOverride,
    branchesEnabled,
    canReuseSelectedBranch,
    canUseSparseCheckout,
    cancelNameInputFocusFrame,
    composerRef,
    connectButtonLabel,
    containerClassName,
    contextualTourSource,
    createDisabled,
    createError,
    createMultiple,
    creating,
    defaultTuiAgent,
    detectedAgentIds,
    disabledTuiAgents,
    dragHandlers,
    eligibleRepos,
    emptyProjectMessage,
    ephemeralVmRecipeError,
    ephemeralVmRecipes,
    focusNameInput,
    forkPushWarning,
    handleAddRemoteServer,
    handleAddRepo,
    handleAddSshHost,
    handleConnectRunTargetHost,
    handleNotePaste,
    handleProjectHostSetupChange,
    handleSetDefaultAgent,
    isFileDragOver,
    name,
    nameInputFocusFrameRef,
    nameInputRef,
    needsSetupProjectHostSetupOptions,
    note,
    onAddProjectOverride,
    onBranchNameOverrideChange,
    onClearSmartNameSelection,
    onComposerNodeChange,
    onConnectSelectedRepo,
    onCreate,
    onCreateMultipleChange,
    onEphemeralVmRecipeChange,
    onNameValueChange,
    onNoteChange,
    onOpenAgentSettings,
    onOpenJiraSettings,
    onProjectChange,
    onProjectHostSetupChange,
    onQuickAgentChange,
    onRepoChange,
    onReuseSelectedBranchChange,
    onSetupAgentStartupPolicyChange,
    onSetupDecisionChange,
    onSmartBranchSelect,
    onSmartGitHubItemSelect,
    onSmartGitLabItemSelect,
    onSmartJiraIssueSelect,
    onSmartLinearIssueSelect,
    onSmartNameModeChange,
    onSparseSelectPreset,
    onToggleAdvanced,
    openModal,
    primaryActionLabel,
    projectDescriptionId,
    projectError,
    projectHostSetupOptions,
    projectLabel,
    projectOptions,
    projectPlaceholder,
    quickAgent,
    readyProjectHostSetupOptions,
    repoBackedSearchRepos,
    repoBackedSourcesDisabled,
    repoId,
    requiresExplicitSetupChoice,
    resolvedSetupDecision,
    reuseSelectedBranch,
    selectedEphemeralVmRecipeId,
    selectedProjectHostSetupId,
    selectedProjectId,
    selectedProjectName,
    selectedRepoConnectInProgress,
    selectedRepoConnectionId,
    selectedRepoIsGit,
    selectedRepoName,
    selectedRepoRequiresConnection,
    selectedRepoSshStatus,
    setComposerNode,
    setupAgentStartupPolicy,
    setupAskLabel,
    setupConfig,
    setupConfigLabel,
    setupControlsEnabled,
    setupDecision,
    setupRunButtonLabel,
    setupRunLabel,
    setupSkipButtonLabel,
    shouldShowRunTargetPicker,
    shouldWaitForSetupCheck,
    showAddProjectButton,
    showCreateMultiple,
    showSetupAgentStartupPolicy,
    smartNameGitHubSourceContext,
    smartNameJiraSourceContext,
    smartNameRepoSwitchTarget,
    smartNameSelection,
    sparseControlsEnabled,
    sparsePresets,
    sparseSelectedPresetId,
    sshStatusLabel,
    submitShortcutModifierLabel,
    updateSettings,
    visibleQuickAgents
  }
  return <NewWorkspaceComposerCardSurface context={surfaceContext} />
}
