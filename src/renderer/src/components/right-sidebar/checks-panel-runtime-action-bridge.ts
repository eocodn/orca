import { pickDefaultSourceControlAgent } from './SourceControl'
import type { ChecksPanelReview } from './checks-panel-review'
import {
  useChecksPanelRuntimeActions,
  type ChecksPanelRuntimeActions
} from './checks-panel-runtime-actions'
import type { useChecksPanelRuntimeFoundation } from './checks-panel-runtime-foundation'
import type { useChecksPanelRuntimeViewState } from './checks-panel-runtime-view-state'

type RuntimeActionsInput = Parameters<typeof useChecksPanelRuntimeActions>[0]

export type ChecksPanelRuntimeActionBridgeInput = RuntimeActionsInput & {
  activeConnectionId: string | null
  activeGitLabReview: ChecksPanelReview | null
  activeReview: ChecksPanelReview | null
  activeWorktreeId: string | null
  commentsLoading: boolean
  detectedAgentIds: string[] | null
  isCurrentAsyncResult: (requestKey: string) => boolean
  noEnabledAgentKnown?: boolean
  prNumber: number | null
  remoteDetectedAgentIds: string[] | null
  repo: RuntimeActionsInput['comments']['repo']
  resolveCommentsWithAIDisabledReason?: string
  settings: RuntimeActionsInput['comments']['settings']
}

export type ChecksPanelRuntimeActionBridge = ChecksPanelRuntimeActions & {
  detectedAgentsForAI: string[] | null
  noEnabledAgentKnown: boolean
  aiActionDisabledReason: string | undefined
  resolveCommentsWithAIDisabledReason: string | undefined
}

type Foundation = ReturnType<typeof useChecksPanelRuntimeFoundation>
type ViewState = ReturnType<typeof useChecksPanelRuntimeViewState>
type ActionSources = {
  foundation: Foundation
  viewState: ViewState
  generation: {
    activePullRequestGenerationKey: string | null
    createPrPushFirst: boolean
    createComposerOpen: boolean
    prCreationDefaults: unknown
    sourceControlAiActionsVisible: boolean
  }
  effects: {
    fetchComments: RuntimeActionsInput['ai']['fetchComments']
    fetchGitLabDetails: RuntimeActionsInput['ai']['fetchGitLabDetails']
  }
  refreshHostedReviewAfterMutation: RuntimeActionsInput['comments']['refreshHostedReviewAfterMutation']
  clearTitleInputFocusTimer: RuntimeActionsInput['comments']['clearTitleInputFocusTimer']
  stateRequestKey: string
  isCurrentAsyncResult: RuntimeActionsInput['ai']['isCurrentAsyncResult']
}

export function useChecksPanelRuntimeActionBridge(
  args: ChecksPanelRuntimeActionBridgeInput
): ChecksPanelRuntimeActionBridge {
  const detectedAgentsForAI =
    typeof args.activeConnectionId === 'string'
      ? args.remoteDetectedAgentIds
      : args.detectedAgentIds
  const noEnabledAgentKnown =
    args.noEnabledAgentKnown ??
    (detectedAgentsForAI != null &&
      pickDefaultSourceControlAgent(
        args.settings?.defaultTuiAgent,
        detectedAgentsForAI,
        args.settings?.disabledTuiAgents
      ) == null)
  const aiActionDisabledReason = !args.activeWorktreeId
    ? 'Select a workspace before launching an AI action.'
    : noEnabledAgentKnown
      ? 'No enabled AI agents. Configure agents in Settings.'
      : undefined
  const resolveCommentsWithAIDisabledReason =
    args.resolveCommentsWithAIDisabledReason ??
    (args.commentsLoading
      ? 'Comments are still loading.'
      : aiActionDisabledReason
        ? aiActionDisabledReason
        : !args.activeReview
          ? 'Open a PR or MR before launching an AI action.'
          : !args.repo
            ? 'Select a repository before launching an AI action.'
            : args.activeReview.provider === 'github' && !args.prNumber
              ? 'Open a GitHub PR before resolving comments.'
              : args.activeReview.provider === 'gitlab' && !args.activeGitLabReview
                ? 'Open a GitLab MR before resolving comments.'
                : undefined)
  const runtimeActions = useChecksPanelRuntimeActions(args)
  return {
    ...runtimeActions,
    detectedAgentsForAI,
    noEnabledAgentKnown,
    aiActionDisabledReason,
    resolveCommentsWithAIDisabledReason
  }
}

export function useChecksPanelRuntimeActionBridgeFromSources(
  sources: ActionSources
): ChecksPanelRuntimeActionBridge {
  const { foundation: f, viewState: v, generation: g, effects: e } = sources
  return useChecksPanelRuntimeActionBridge({
    activeConnectionId: f.activeConnectionId,
    activeGitLabReview: v.activeGitLabReview,
    activeReview: v.activeReview,
    activeWorktreeId: f.activeWorktreeId,
    commentsLoading: f.commentsLoading,
    detectedAgentIds: f.detectedAgentIds,
    isCurrentAsyncResult: sources.isCurrentAsyncResult,
    prNumber: v.prNumber,
    remoteDetectedAgentIds: f.remoteDetectedAgentIds,
    repo: f.repo,
    settings: f.settings,
    comments: {
      activeConnectionId: f.activeConnectionId,
      activeGitLabReview: v.activeGitLabReview,
      activeReview: v.activeReview,
      activeWorktreeId: f.activeWorktreeId,
      addPRConversationComment: f.addPRConversationComment,
      addPRReviewCommentReply: f.addPRReviewCommentReply,
      branch: f.branch,
      clearTitleInputFocusTimer: sources.clearTitleInputFocusTimer,
      confirm: f.confirm,
      detectedAgentIds: f.detectedAgentIds,
      isCurrentAsyncResult: sources.isCurrentAsyncResult,
      mountedRef: f.mountedRef,
      pr: v.pr,
      prCacheKey: v.prCacheKey,
      prNumber: v.prNumber,
      refreshHostedReviewAfterMutation: sources.refreshHostedReviewAfterMutation,
      remoteDetectedAgentIds: f.remoteDetectedAgentIds,
      repo: f.repo,
      resolveReviewThread: f.resolveReviewThread,
      setAgentComposerState: f.setAgentComposerState,
      setComments: f.setComments,
      setEditingTitle: f.setEditingTitle,
      setTitleDraft: f.setTitleDraft,
      setTitleSaving: f.setTitleSaving,
      settings: f.settings,
      sourceControlAiActionsVisible: g.sourceControlAiActionsVisible,
      titleInputFocusTimerRef: f.titleInputFocusTimerRef,
      titleInputRef: f.titleInputRef
    },
    ai: {
      activeConflictReview: v.activeConflictReview,
      activeReview: v.activeReview,
      activeWorktreeId: f.activeWorktreeId,
      activeWorktreePath: f.activeWorktreePath,
      asyncResultKeyRef: f.asyncResultKeyRef,
      branch: f.branch,
      commentsRef: f.commentsRef,
      commentsSelectionClearTokenRef: f.commentsSelectionClearTokenRef,
      fetchComments: e.fetchComments,
      fetchGitLabDetails: e.fetchGitLabDetails,
      fetchHostedReviewForBranch: f.fetchHostedReviewForBranch,
      fetchPRCheckDetails: f.fetchPRCheckDetails,
      fetchPRChecks: f.fetchPRChecks,
      fetchPRComments: f.fetchPRComments,
      fetchPRForBranch: f.fetchPRForBranch,
      isCurrentAsyncResult: sources.isCurrentAsyncResult,
      linkedAzureDevOpsPR: v.linkedAzureDevOpsPR,
      linkedBitbucketPR: v.linkedBitbucketPR,
      linkedGitLabMR: v.linkedGitLabMR,
      linkedGiteaPR: v.linkedGiteaPR,
      panelContextKey: f.panelContextKey,
      panelContextKeyRef: f.panelContextKeyRef,
      pr: v.pr,
      prCacheKey: v.prCacheKey,
      repo: f.repo,
      resolveCommentsWithAIDisabledReason: undefined,
      setAgentComposerState: f.setAgentComposerState,
      setChecks: f.setChecks,
      setChecksLoading: f.setChecksLoading,
      setComments: f.setComments,
      setCommentsLoading: f.setCommentsLoading,
      setCommentsSelectionClearRequest: f.setCommentsSelectionClearRequest,
      sourceControlAiActionsVisible: g.sourceControlAiActionsVisible,
      stateRequestKey: sources.stateRequestKey
    },
    fixChecks: {
      activeReview: v.activeReview,
      activeWorktreeId: f.activeWorktreeId,
      checks: f.checks,
      fetchPRCheckDetails: f.fetchPRCheckDetails,
      isCurrentAsyncResult: sources.isCurrentAsyncResult,
      isFixingChecksWithAI: f.isFixingChecksWithAI,
      pr: v.pr,
      repo: f.repo,
      sourceControlAiActionsVisible: g.sourceControlAiActionsVisible,
      stateRequestKey: sources.stateRequestKey,
      setIsFixingChecksWithAI: f.setIsFixingChecksWithAI
    },
    links: {
      activeConnectionId: f.activeConnectionId,
      activeReview: v.activeReview,
      activeWorktreeId: f.activeWorktreeId,
      branch: f.branch,
      fallbackGitHubPRNumber: v.fallbackGitHubPRNumber,
      fetchHostedReviewForBranch: f.fetchHostedReviewForBranch,
      fetchUpstreamStatus: f.fetchUpstreamStatus,
      isRemoteOperationActive: f.isRemoteOperationActive,
      linkedAzureDevOpsPR: v.linkedAzureDevOpsPR,
      linkedBitbucketPR: v.linkedBitbucketPR,
      linkedGitLabMR: v.linkedGitLabMR,
      linkedGiteaPR: v.linkedGiteaPR,
      linkedPR: v.linkedPR,
      openModal: f.openModal,
      ownerSettings: f.ownerSettings,
      pr: v.pr,
      pushBranch: f.pushBranch,
      repo: f.repo,
      setGitStatusRefreshNonce: f.setGitStatusRefreshNonce,
      setIsPublishingBranch: f.setIsPublishingBranch,
      setIsSyncingBranch: f.setIsSyncingBranch,
      setRightSidebarOpen: f.setRightSidebarOpen,
      setRightSidebarTab: f.setRightSidebarTab,
      syncBranch: f.syncBranch,
      updateWorktreeMeta: f.updateWorktreeMeta
    },
    create: {
      activePullRequestGenerationKey: g.activePullRequestGenerationKey,
      activeWorktreeId: f.activeWorktreeId,
      activeWorktreePath: f.activeWorktreePath,
      branch: f.branch,
      createComposerOpen: g.createComposerOpen,
      createHostedReview: f.createHostedReview,
      createPrInFlightRef: f.createPrInFlightRef,
      createPrPushFirst: g.createPrPushFirst,
      hostedReviewCreateCopy: v.hostedReviewCreateCopy,
      hostedReviewCreateProvider: v.hostedReviewCreateProvider,
      hostedReviewCreation: v.hostedReviewCreation,
      panelContextKey: f.panelContextKey,
      panelContextKeyRef: f.panelContextKeyRef,
      prCreationDefaults: g.prCreationDefaults,
      repo: f.repo,
      setCreatePrError: f.setCreatePrError,
      setGitStatusRefreshNonce: f.setGitStatusRefreshNonce,
      setIsCreatingPr: f.setIsCreatingPr,
      updatePullRequestGenerationRecord: f.updatePullRequestGenerationRecord
    }
  })
}
