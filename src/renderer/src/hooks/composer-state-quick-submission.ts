import { useCallback } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { activateAndRevealWorktree, type AgentStartedTelemetry } from '@/lib/worktree-activation'
import { buildAgentPromptWithContext, canUseIssueCommandForLinkedItemProvider, DEFAULT_ISSUE_COMMAND_TEMPLATE, getLinkedWorkItemProvider, getLinkedWorkItemWorkspaceName, renderIssueCommandTemplate } from '@/lib/new-workspace'
import { getLinkedWorkItemPromptContext, resolveQuickCreateLinkedWorkItemPrompt } from '@/lib/linked-work-item-context'
import { buildAgentDraftLaunchPlan, buildAgentStartupPlan } from '@/lib/tui-agent-startup'
import { resolveTuiAgentLaunchArgs, resolveTuiAgentLaunchEnv } from '../../../shared/tui-agent-launch-defaults'
import { tuiAgentToAgentKind } from '@/lib/telemetry'
import { ensureAgentStartupInTerminal } from '@/lib/new-workspace'
import { ensureHooksConfirmed } from '@/lib/ensure-hooks-confirmed'
import { resolveWorktreeCreateBaseBranch } from '@/runtime/worktree-create-base'
import { toFolderWorkspaceLinkedTask } from '@/components/sidebar/folder-workspace-composer-helpers'
import { getSmartGitHubSubmitResolution } from '@/lib/smart-github-submit'
import { isTuiAgentEnabled } from '../../../shared/tui-agent-selection'
import { formatWorkspaceCreateError, getWorkspaceCreateErrorToastMessage } from '@/lib/workspace-create-error-format'
import { queueWorkspaceActivationTerminalFocus } from '@/lib/workspace-activation-terminal-focus'
import { runBackgroundWorktreeCreation } from '@/lib/worktree-creation-flow'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { resolveComposerBranchNameOverrideForCreate } from './composer-branch-selection'
import { getWorkspaceSeedName, type LinkedWorkItemSummary } from '@/lib/new-workspace'
import { resolveSmartGitHubCreateNames, isExplicitWorkspaceNameInput, type PendingSmartGitHubSubmitResolution } from './composer-state-contracts'
import { translate } from '@/i18n/i18n'
import type { WorktreeCreationRequest } from '@/lib/pending-worktree-creation'
import type { SetupDecision, TuiAgent } from '../../../shared/types'

export function useComposerQuickSubmission(context: any) {
  const {
    isProjectGroupTarget,
    submitFolderTarget,
    name,
    parsedLinkedIssueNumber,
    linkedPR,
    fallbackCreatureName,
    sourceIntentBlocksCreate,
    selectedRepoRequiresConnection,
    requiresExplicitSetupChoice,
    setupDecision,
    sparseError,
    repoId,
    selectedRepo,
    setCreateError,
    setCreating,
    resolvePendingSmartGitHubSubmit,
    linkedWorkItem,
    effectiveLinkedPR,
    linkedGitLabIssue,
    linkedGitLabMR,
    lastAutoNameRef,
    selectedRepoIsGit,
    checkedHooksRepoId,
    loadHookCheckForRepo,
    commitHookCheckIfCurrent,
    setupConfig,
    setupPolicy,
    setAdvancedOpen,
    enableIssueAutomation,
    agentPrompt,
    hasLoadedIssueCommand,
    issueCommandTemplate,
    attachmentPaths,
    note,
    resolvedSetupDecision,
    baseBranch,
    compareBaseRef,
    pushTarget,
    branchNameOverride,
    branchNameOverridePreservesNameEdits,
    smartNameMode,
    selectedRepoAgentLaunchPlatform,
    selectedRepoStartupShell,
    selectedRepoIsRemote,
    selectedRepoSettings,
    settings,
    telemetrySource,
    persistSetupAgentStartupPolicy,
    normalizedSparseDirectories,
    effectivePresetId,
    sparseEnabled,
    selectedWorkspaceTarget,
    selectedEphemeralVmRecipeId,
    ephemeralVmsEnabled,
    disabledTuiAgents,
    tuiAgent,
    showProjectRequiredError,
    createWorktree,
    resolvedInitialWorkspaceStatus,
    persistDraft,
    clearNewWorkspaceDraft,
    createMultiple,
    onCreated,
    resetForNextCreate
  } = context
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

  return { submitQuick }
}
