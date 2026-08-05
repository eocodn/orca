import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { activateAndRevealWorktree, type AgentStartedTelemetry } from '@/lib/worktree-activation'
import {
  buildAgentPromptWithContext,
  canUseIssueCommandForLinkedItemProvider,
  DEFAULT_ISSUE_COMMAND_TEMPLATE,
  getLinkedWorkItemProvider,
  getLinkedWorkItemWorkspaceName,
  renderIssueCommandTemplate
} from '@/lib/new-workspace'
import { getLinkedWorkItemPromptContext } from '@/lib/linked-work-item-context'
import { buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import {
  resolveTuiAgentLaunchArgs,
  resolveTuiAgentLaunchEnv
} from '../../../shared/tui-agent-launch-defaults'
import { tuiAgentToAgentKind } from '@/lib/agent-kind'
import { ensureAgentStartupInTerminal } from '@/lib/new-workspace'
import { ensureHooksConfirmed } from '@/lib/ensure-hooks-confirmed'
import { resolveWorktreeCreateBaseBranch } from '@/runtime/worktree-create-base'
import { toFolderWorkspaceLinkedTask } from '@/components/sidebar/folder-workspace-composer-helpers'
import { getSmartGitHubSubmitResolution } from '@/lib/smart-github-submit'
import { isTuiAgentEnabled } from '../../../shared/tui-agent-selection'
import {
  formatWorkspaceCreateError,
  getWorkspaceCreateErrorToastMessage
} from '@/lib/workspace-create-error-format'
import { queueWorkspaceActivationTerminalFocus } from '@/lib/workspace-activation-terminal-focus'
import { runBackgroundWorktreeCreation } from '@/lib/worktree-creation-flow'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { resolveComposerBranchNameOverrideForCreate } from './composer-branch-selection'
import {
  resolveSmartGitHubCreateNames,
  isExplicitWorkspaceNameInput,
  type PendingSmartGitHubSubmitResolution
} from './composer-state-contracts'
import { translate } from '@/i18n/i18n'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import type { SetupDecision, TuiAgent } from '../../../shared/types'

export function useComposerWorktreeSubmission(context: any) {
  const {
    isProjectGroupTarget,
    submitFolderTarget,
    repoId,
    selectedRepo,
    workspaceSeedName,
    selectedRepoRequiresConnection,
    shouldWaitForSetupCheck,
    shouldWaitForIssueAutomationCheck,
    sourceIntentBlocksCreate,
    requiresExplicitSetupChoice,
    setupDecision,
    sparseError,
    tuiAgent,
    disabledTuiAgents,
    fallbackDefaultAgent,
    setTuiAgent,
    setCreateError,
    setCreating,
    resolvePendingSmartGitHubSubmit,
    linkedWorkItem,
    parsedLinkedIssueNumber,
    effectiveLinkedPR,
    linkedGitLabIssue,
    linkedGitLabMR,
    name,
    lastAutoNameRef,
    selectedRepoIsGit,
    enableIssueAutomation,
    agentPrompt,
    hasLoadedIssueCommand,
    issueCommandTemplate,
    attachmentPaths,
    note,
    setupConfig,
    resolvedSetupDecision,
    selectedRepoSettings,
    compareBaseRef,
    baseBranch,
    pushTarget,
    branchNameOverride,
    branchNameOverridePreservesNameEdits,
    smartNameMode,
    selectedRepoAgentLaunchPlatform,
    selectedRepoStartupShell,
    selectedRepoIsRemote,
    settings,
    telemetrySource,
    persistSetupAgentStartupPolicy,
    createWorktree,
    normalizedSparseDirectories,
    effectivePresetId,
    resolvedInitialWorkspaceStatus,
    updateWorktreeMeta,
    persistDraft,
    clearNewWorkspaceDraft,
    onCreated,
    setSidebarOpen,
    taskSourceContext,
    createMultiple,
    resetForNextCreate,
    selectedWorkspaceTarget,
    selectedEphemeralVmRecipeId,
    ephemeralVmsEnabled,
    loadHookCheckForRepo,
    commitHookCheckIfCurrent,
    checkedHooksRepoId,
    setupPolicy,
    showProjectRequiredError,
    sparseEnabled,
    setAdvancedOpen
  } = context
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

  return { submit }
}
