import { useCallback, useMemo, useRef } from 'react'
import { useAppStore, type AppState } from '@/store'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { getConnectionId } from '@/lib/connection-context'
import { useChecksPanelTerminalWorktree } from './use-checks-panel-terminal-worktree'
import { normalizeGlobalWindowsRuntimeDefault } from '../../../../shared/project-execution-runtime'
import { getWorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'
import { resolveSourceControlLaunchPlatform } from '@/lib/source-control-launch-platform'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { buildChecksPanelGitStatusContextKey } from './checks-panel-git-status-snapshot'
import { useChecksPanelRuntimeState } from './checks-panel-runtime-state'
import type {
  SourceControlActionRecipe,
  SourceControlLaunchActionId
} from '../../../../shared/source-control-ai-actions'
import {
  saveSourceControlActionRecipe,
  type SourceControlAiWriteTarget
} from '../../../../shared/source-control-ai-recipe-save'

export function useChecksPanelRuntimeFoundation() {
  const rightSidebarOpen = useAppStore((s) => s.rightSidebarOpen)
  const rightSidebarTab = useAppStore((s) => s.rightSidebarTab)
  const isPanelVisible = rightSidebarOpen && rightSidebarTab === 'checks'

  // Follow the active terminal's cwd so linked-PR/checks track the worktree it's operating in (e.g. across a stack), else the sidebar selection.
  const defaultActiveWorktree = useActiveWorktree()
  const { worktree: activeWorktree } = useChecksPanelTerminalWorktree({
    defaultActiveWorktree,
    isPanelVisible
  })
  const activeWorktreeId = activeWorktree?.id ?? null
  const repo = useRepoById(activeWorktree?.repoId ?? null)
  const activeConnectionId = activeWorktreeId
    ? (getConnectionId(activeWorktreeId) ?? repo?.connectionId ?? null)
    : null
  const settings = useAppStore((s) => s.settings)
  const updateSettings = useAppStore((s) => s.updateSettings)
  const updateRepo = useAppStore((s) => s.updateRepo)
  const fetchPRForBranch = useAppStore((s) => s.fetchPRForBranch)
  const fetchHostedReviewForBranch = useAppStore((s) => s.fetchHostedReviewForBranch)
  const expireGitHubPRRefreshState = useAppStore((s) => s.expireGitHubPRRefreshState)
  const getHostedReviewCreationEligibility = useAppStore(
    (s) => s.getHostedReviewCreationEligibility
  )
  const createHostedReview = useAppStore((s) => s.createHostedReview)
  const enqueueGitHubPRRefresh = useAppStore((s) => s.enqueueGitHubPRRefresh)
  const conflictOperation = useAppStore((s) =>
    activeWorktreeId ? (s.gitConflictOperationByWorktree[activeWorktreeId] ?? 'unknown') : 'unknown'
  )
  const gitStatusInvalidation = useAppStore((s) =>
    activeWorktreeId ? s.gitStatusByWorktree[activeWorktreeId] : undefined
  )
  const remoteStatusInvalidation = useAppStore((s) =>
    activeWorktreeId ? s.remoteStatusesByWorktree[activeWorktreeId] : undefined
  )
  const isRemoteOperationActive = useAppStore((s) => s.isRemoteOperationActive)
  const pushBranch = useAppStore((s) => s.pushBranch)
  const syncBranch = useAppStore((s) => s.syncBranch)
  const fetchUpstreamStatus = useAppStore((s) => s.fetchUpstreamStatus)
  const setRightSidebarOpen = useAppStore((s) => s.setRightSidebarOpen)
  const setRightSidebarTab = useAppStore((s) => s.setRightSidebarTab)
  const updateWorktreeMeta = useAppStore((s) => s.updateWorktreeMeta)
  const updateWorktreeGitIdentity = useAppStore((s) => s.updateWorktreeGitIdentity)
  const openModal = useAppStore((s) => s.openModal)

  const fetchPRChecks = useAppStore((s) => s.fetchPRChecks)
  const fetchPRCheckDetails = useAppStore((s) => s.fetchPRCheckDetails)
  const fetchPRComments = useAppStore((s) => s.fetchPRComments)
  const addPRConversationComment = useAppStore((s) => s.addPRConversationComment)
  const addPRReviewCommentReply = useAppStore((s) => s.addPRReviewCommentReply)
  const resolveReviewThread = useAppStore((s) => s.resolveReviewThread)
  const detectedAgentIds = useAppStore((s) => s.detectedAgentIds)
  const remoteDetectedAgentIds = useAppStore((s) => {
    return typeof activeConnectionId === 'string'
      ? (s.remoteDetectedAgentIds[activeConnectionId] ?? null)
      : null
  })

  const runtimeState = useChecksPanelRuntimeState()
  const { commentsRef, comments } = runtimeState
  const isResolvingConflictsWithAI = false
  commentsRef.current = comments
  const prGenerationRecords = useAppStore((s) => s.pullRequestGenerationRecords)
  const allocatePullRequestGenerationRequestId = useAppStore(
    (s) => s.allocatePullRequestGenerationRequestId
  )
  const setPullRequestGenerationRecord = useAppStore((s) => s.setPullRequestGenerationRecord)
  const updatePullRequestGenerationRecord = useAppStore((s) => s.updatePullRequestGenerationRecord)

  const saveLaunchActionDefault = useCallback(
    async (
      target: SourceControlAiWriteTarget,
      actionId: SourceControlLaunchActionId,
      recipe: SourceControlActionRecipe
    ): Promise<void> => {
      const state = useAppStore.getState()
      const latestSettings = state.settings
      if (!latestSettings) {
        throw new Error('Settings are not loaded.')
      }
      const latestRepo =
        target.type === 'repo'
          ? (state.repos.find((candidate) => candidate.id === target.repoId) ?? null)
          : null
      const result = saveSourceControlActionRecipe({
        target,
        settings: latestSettings,
        repo: latestRepo,
        actionId,
        recipe
      })
      if ('sourceControlAi' in result) {
        await updateSettings({ sourceControlAi: result.sourceControlAi })
        return
      }
      await updateRepo(result.target.repoId, result.update)
    },
    [updateRepo, updateSettings]
  )
  const asyncResultKeyRef = useRef<string>('')
  const refreshRequestKeyRef = useRef<string | null>(null)
  const refreshContextKeyRef = useRef<string | null>(null)
  const gitStatusSnapshotInFlightContextRef = useRef<string | null>(null)
  const gitStatusSnapshotRerunContextRef = useRef<string | null>(null)
  const gitStatusSnapshotRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gitIdentityDisplay = activeWorktree ? getWorktreeGitIdentityDisplay(activeWorktree) : null
  const detachedHeadDisplay = gitIdentityDisplay?.kind === 'detached' ? gitIdentityDisplay : null
  const branch = gitIdentityDisplay?.kind === 'branch' ? gitIdentityDisplay.branchName : ''
  const activeWorktreePath = activeWorktree?.path ?? null
  const activeWorktreePushTarget = activeWorktree?.pushTarget ?? null
  const activeSourceControlLaunchPlatform = resolveSourceControlLaunchPlatform({
    connectionId: activeConnectionId,
    worktreePath: activeWorktreePath,
    projectRuntime: activeConnectionId
      ? undefined
      : getLocalProjectExecutionRuntimeContext(useAppStore.getState(), activeWorktreeId)
  })
  const runtimeEnvironmentId = useAppStore((s) =>
    getRuntimeEnvironmentIdForWorktree(s, activeWorktreeId)
  )
  const ownerSettings = useMemo<AppState['settings']>(
    () =>
      !settings
        ? settings
        : runtimeEnvironmentId
          ? { ...settings, activeRuntimeEnvironmentId: runtimeEnvironmentId }
          : { ...settings, activeRuntimeEnvironmentId: null },
    [runtimeEnvironmentId, settings]
  )
  const repoConnectionId = repo?.connectionId?.trim() || null
  // Local execution host variant (wsl:{distro} vs host); applies only when local — remote contexts are scoped by runtimeEnvironmentId/connectionId.
  const localExecutionScope = useMemo<string | null>(() => {
    if (runtimeEnvironmentId != null || repoConnectionId != null) {
      return null
    }
    const localRuntime = normalizeGlobalWindowsRuntimeDefault(settings?.localWindowsRuntimeDefault)
    return localRuntime.kind === 'wsl' ? `wsl:${localRuntime.distro ?? ''}` : 'host'
  }, [runtimeEnvironmentId, repoConnectionId, settings?.localWindowsRuntimeDefault])
  const sshConnectionStatus = useAppStore((s) =>
    repoConnectionId ? s.sshConnectionStates.get(repoConnectionId)?.status : undefined
  )
  const panelContextKey = buildChecksPanelGitStatusContextKey({
    repoId: repo?.id,
    worktreeId: activeWorktreeId,
    worktreePath: activeWorktreePath,
    branch,
    linkedGitHubPR: activeWorktree?.linkedPR ?? null,
    linkedGitLabMR: activeWorktree?.linkedGitLabMR ?? null,
    linkedBitbucketPR: activeWorktree?.linkedBitbucketPR ?? null,
    linkedAzureDevOpsPR: activeWorktree?.linkedAzureDevOpsPR ?? null,
    linkedGiteaPR: activeWorktree?.linkedGiteaPR ?? null,
    runtimeEnvironmentId,
    repoConnectionId,
    localExecutionScope,
    pushTarget: activeWorktreePushTarget
  })
  const panelContextKeyRef = useRef(panelContextKey)
  panelContextKeyRef.current = panelContextKey
  return {
    rightSidebarOpen,
    rightSidebarTab,
    isPanelVisible,
    defaultActiveWorktree,
    activeWorktree,
    activeWorktreeId,
    repo,
    activeConnectionId,
    settings,
    updateSettings,
    updateRepo,
    fetchPRForBranch,
    fetchHostedReviewForBranch,
    expireGitHubPRRefreshState,
    getHostedReviewCreationEligibility,
    createHostedReview,
    enqueueGitHubPRRefresh,
    conflictOperation,
    gitStatusInvalidation,
    remoteStatusInvalidation,
    isRemoteOperationActive,
    pushBranch,
    syncBranch,
    fetchUpstreamStatus,
    setRightSidebarOpen,
    setRightSidebarTab,
    updateWorktreeMeta,
    updateWorktreeGitIdentity,
    openModal,
    fetchPRChecks,
    fetchPRCheckDetails,
    fetchPRComments,
    addPRConversationComment,
    addPRReviewCommentReply,
    resolveReviewThread,
    detectedAgentIds,
    remoteDetectedAgentIds,
    runtimeState,
    isResolvingConflictsWithAI,
    prGenerationRecords,
    allocatePullRequestGenerationRequestId,
    setPullRequestGenerationRecord,
    updatePullRequestGenerationRecord,
    saveLaunchActionDefault,
    asyncResultKeyRef,
    refreshRequestKeyRef,
    refreshContextKeyRef,
    gitStatusSnapshotInFlightContextRef,
    gitStatusSnapshotRerunContextRef,
    gitStatusSnapshotRetryTimerRef,
    gitIdentityDisplay,
    detachedHeadDisplay,
    branch,
    activeWorktreePath,
    activeWorktreePushTarget,
    activeSourceControlLaunchPlatform,
    runtimeEnvironmentId,
    ownerSettings,
    repoConnectionId,
    localExecutionScope,
    sshConnectionStatus,
    panelContextKey,
    panelContextKeyRef,
    ...runtimeState
  }
}
