/* Coordinates hosted-review data with focused checks, comments, and actions sections. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore, type AppState } from '@/store'
import { prChecksCacheSuffix, prCommentsCacheSuffix } from '@/store/slices/github'
import { getGitHubPRCacheKey, getGitHubRepoCacheKey } from '@/store/slices/github-cache-key'
import { useActiveWorktree, useRepoById } from '@/store/selectors'
import { useChecksPanelTerminalWorktree } from './use-checks-panel-terminal-worktree'
import { isFolderRepo } from '../../../../shared/repo-kind'
import type { PRCommentsListSelectionClearRequest } from './pr-comments-list-selection'
import { ENTRY_REFRESH_GRACE_MS, shouldEntryRefresh } from './checks-entry-refresh'
import type {
  PRInfo,
  PRCheckDetail,
  PRComment,
  PRRefreshErrorType
} from '../../../../shared/types'
import { getConnectionId } from '@/lib/connection-context'
import { pickDefaultSourceControlAgent } from './SourceControl'
import type {
  HostedReviewCreationEligibility,
  HostedReviewProvider
} from '../../../../shared/hosted-review'
import { resolveHostedReviewCreationProvider } from '../../../../shared/hosted-review-creation-providers'
import { normalizeGlobalWindowsRuntimeDefault } from '../../../../shared/project-execution-runtime'
import { getHostedReviewCacheKey, refreshHostedReviewCard } from '@/store/slices/hosted-review'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import { type ChecksPanelReview, selectChecksPanelReview } from './checks-panel-review'
import { selectReviewCacheEntry } from './review-cache-entry-selection'
import {
  checksPanelAsyncResultKey,
  checksPanelHostedReviewAsyncResultKey,
  shouldCommitChecksPanelAsyncResult
} from './checks-panel-async-result-key'
import { installWindowVisibilityTimeoutPoller } from '@/lib/window-visibility-timeout-poller'
import { resolveChecksPanelReviewLookup } from './checks-panel-review-lookup-authority'
import { computeChecksPanelConfirmedReadiness, isChecksPanelHardErrorCleared, type ChecksPanelConfirmedReadinessInput } from './checks-panel-review-creation'
import {
  buildChecksPanelGitStatusContextKey,
  readChecksPanelPublishActionGitStatus,
  readChecksPanelGitStatusSnapshot,
  shouldCoalesceChecksPanelGitStatusSnapshotRefresh,
  shouldPollChecksPanelRuntimeSshStatus,
  type ChecksPanelGitStatusSnapshot
} from './checks-panel-git-status-snapshot'
import {
  getChecksPanelForegroundReviewEvidenceKey,
  resolveChecksPanelPRRefreshRequest,
  resolveChecksPanelReviewEvidenceProvider
} from './checks-panel-pr-refresh-request'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { useMountedRef } from '@/hooks/useMountedRef'
import { getWorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'
import type {
  SourceControlActionRecipe,
  SourceControlLaunchActionId
} from '../../../../shared/source-control-ai-actions'
import {
  saveSourceControlActionRecipe,
  type SourceControlAiWriteTarget
} from '../../../../shared/source-control-ai-recipe-save'
import { resolveSourceControlLaunchPlatform } from '@/lib/source-control-launch-platform'
import { getLocalProjectExecutionRuntimeContext } from '@/lib/local-preflight-context'
import { getRuntimeEnvironmentIdForWorktree } from '@/lib/worktree-runtime-owner'
import { getPullRequestGenerationRecordKey, getPullRequestGenerationSeedRestoreKey } from '@/store/slices/pull-request-generation'
import { localizedHostedReviewCopy } from '@/i18n/hosted-review-localized-copy'
import type { PRCommentGroup } from '@/lib/pr-comment-groups'
import { renderChecksPanel } from './checks-panel-runtime-render'
import { useChecksPanelRefresh } from './checks-panel-refresh-controller'
import { useChecksPanelCommentActions } from './checks-panel-comment-actions-controller'
import { useChecksPanelAiActions } from './checks-panel-ai-actions-controller'
import { useChecksPanelFixChecks } from './checks-panel-ai-fix-controller'
import { useChecksPanelReviewEffects } from './checks-panel-review-effects'
import { useChecksPanelGitEffects } from './checks-panel-git-effects'
import { useChecksPanelFetch } from './checks-panel-fetch-controller'
import { useChecksPanelLinkActions } from './checks-panel-link-actions'
import { useChecksPanelCreateAction } from './checks-panel-create-action'
import { useChecksPanelGeneration } from './checks-panel-generation-controller'
import { useChecksPanelCommentFetch } from './checks-panel-comment-fetch'

const RUNTIME_SSH_STATUS_REFRESH_MS = 3000

type HostedReviewCreationSnapshot = {
  requestKey: string
  /** Panel context key (repo/worktree/branch/host) at request time. */
  contextKey: string
  repoId: string
  worktreeId: string | null
  branch: string
  /** Wall-clock time the eligibility request started (hard-error clear ordering). */
  requestStartedAt: number
  /** Wall-clock time the eligibility result settled (confirmed freshness window). */
  completedAt: number
  /** Git snapshot fingerprint used for this eligibility (confirmed freshness). */
  gitFingerprint: string
  data: HostedReviewCreationEligibility
}

// Fingerprint HEAD/dirty/upstream/base/execution-host so a stale snapshot can't keep an enabled Create open when any of them move.
function buildChecksPanelEligibilityGitFingerprint(input: {
  headOid: string | null
  hasUncommittedChanges: boolean | undefined
  hasUpstream: boolean | undefined
  ahead: number | undefined
  behind: number | undefined
  base: string | null
  runtimeEnvironmentId: string | null
  repoConnectionId: string | null
  localExecutionScope: string | null
}): string {
  return JSON.stringify({
    headOid: input.headOid ?? null,
    hasUncommittedChanges: input.hasUncommittedChanges ?? null,
    hasUpstream: input.hasUpstream ?? null,
    ahead: input.ahead ?? null,
    behind: input.behind ?? null,
    base: input.base ?? null,
    runtimeEnvironmentId: input.runtimeEnvironmentId ?? null,
    repoConnectionId: input.repoConnectionId ?? null,
    localExecutionScope: input.localExecutionScope ?? null
  })
}

type ChecksAgentComposerState = {
  actionId: SourceControlLaunchActionId
  title: string
  description: string
  prompt: string
  launchSource: 'conflict_resolution' | 'task_page'
  commentResolution?: {
    reviewContextKey: string
    provider: ChecksPanelReview['provider']
    selectedThreadIds: string[]
    selectedGroups: PRCommentGroup[]
  }
}
function isGitLabChecksPanelReview(
  review: ChecksPanelReview | null
): review is ChecksPanelReview & { provider: 'gitlab' } {
  return review?.provider === 'gitlab'
}

export default function ChecksPanel(): React.JSX.Element {
  // Why: the sidebar stays mounted when closed (perf); gate polling on visibility so we don't fetch checks/comments or poll cwd while hidden.
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

  const [checks, setChecks] = useState<PRCheckDetail[]>([])
  const [checksLoading, setChecksLoading] = useState(false)
  const [comments, setComments] = useState<PRComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const commentsRef = useRef<PRComment[]>([])
  const [commentsSelectionClearRequest, setCommentsSelectionClearRequest] =
    useState<PRCommentsListSelectionClearRequest | null>(null)
  const commentsSelectionClearTokenRef = useRef(0)
  const [emptyRefreshing, setEmptyRefreshing] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const refreshInFlightRef = useRef(false)
  const [conflictDetailsRefreshing, setConflictDetailsRefreshing] = useState(false)
  const createPrInFlightRef = useRef<string | null>(null)
  const [isCreatingPr, setIsCreatingPr] = useState(false)
  const [createPrError, setCreatePrError] = useState<string | null>(null)
  const [isPublishingBranch, setIsPublishingBranch] = useState(false)
  const [isSyncingBranch, setIsSyncingBranch] = useState(false)
  const isResolvingConflictsWithAI = false
  const [isFixingChecksWithAI, setIsFixingChecksWithAI] = useState(false)
  const [agentComposerState, setAgentComposerState] = useState<ChecksAgentComposerState | null>(
    null
  )
  const [hostedReviewCreationSnapshot, setHostedReviewCreationSnapshot] =
    useState<HostedReviewCreationSnapshot | null>(null)
  // Sticky record of the latest hard refresh error so Create can't flap back until a qualifying eligibility request clears it.
  const [hardRefreshError, setHardRefreshError] = useState<{
    observedAt: number
    errorType: PRRefreshErrorType
    contextKey: string
  } | null>(null)
  const [gitStatusSnapshot, setGitStatusSnapshot] = useState<ChecksPanelGitStatusSnapshot | null>(
    null
  )
  // Context key whose git-status probe failed with no snapshot, so the empty state can distinguish "checking branch status" from "could not check".
  const [gitStatusProbeErrorContextKey, setGitStatusProbeErrorContextKey] = useState<string | null>(
    null
  )
  const [gitStatusRefreshNonce, setGitStatusRefreshNonce] = useState(0)
  // Bumped by manual Retry/Refresh so eligibility re-runs even when Git state is unchanged (e.g. an auth fix must still clear the hard error).
  const [eligibilityRefreshNonce, setEligibilityRefreshNonce] = useState(0)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [titleSaving, setTitleSaving] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const titleInputFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollIntervalRef = useRef(30_000) // start at 30s, backs off to 120s
  const mountedRef = useMountedRef()
  const confirm = useConfirmationDialog()
  const prevChecksRef = useRef<string>('')
  const conflictSummaryRefreshKeyRef = useRef<string | null>(null)
  const panelVisibleSinceRef = useRef<number | null>(null)
  const foregroundedUnrenderedReviewKeyRef = useRef<string | null>(null)
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

  const clearTitleInputFocusTimer = useCallback((): void => {
    if (titleInputFocusTimerRef.current !== null) {
      clearTimeout(titleInputFocusTimerRef.current)
      titleInputFocusTimerRef.current = null
    }
  }, [])

  const setChecksPanelContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node === null) {
        clearTitleInputFocusTimer()
      }
    },
    [clearTitleInputFocusTimer]
  )

  // Why: no key={worktreeId} remount (caused an IPC storm on Windows); reset branch-specific state during render (not useEffect) so it lands on the same paint.
  const [prevPanelContextKey, setPrevPanelContextKey] = useState(panelContextKey)
  const [prRefreshStateNow, setPrRefreshStateNow] = useState(() => Date.now())
  if (panelContextKey !== prevPanelContextKey) {
    setPrevPanelContextKey(panelContextKey)
    setEditingTitle(false)
    setTitleDraft('')
    setTitleSaving(false)
    clearTitleInputFocusTimer()
    setChecks([])
    setChecksLoading(false)
    setComments([])
    setCommentsLoading(false)
    setIsRefreshing(false)
    setEmptyRefreshing(false)
    setConflictDetailsRefreshing(false)
    setPrRefreshStateNow(Date.now())
    createPrInFlightRef.current = null
    setIsCreatingPr(false)
    setCreatePrError(null)
    setIsPublishingBranch(false)
    setAgentComposerState(null)
    setHostedReviewCreationSnapshot(null)
    setHardRefreshError(null)
    setGitStatusSnapshot(null)
    setGitStatusProbeErrorContextKey(null)
    setGitStatusRefreshNonce((value) => value + 1)
    pollIntervalRef.current = 30_000
    prevChecksRef.current = ''
    conflictSummaryRefreshKeyRef.current = null
    refreshInFlightRef.current = false
    refreshRequestKeyRef.current = null
    if (gitStatusSnapshotRetryTimerRef.current) {
      clearTimeout(gitStatusSnapshotRetryTimerRef.current)
      gitStatusSnapshotRetryTimerRef.current = null
    }
  }

  const isFolder = repo ? isFolderRepo(repo) : false
  const prCacheKey =
    repo && branch
      ? getGitHubPRCacheKey(
          repo.path,
          repo.id,
          branch,
          settings,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      : ''
  const hostedReviewCacheKey =
    repo && branch
      ? getHostedReviewCacheKey(
          repo.path,
          branch,
          settings,
          repo.id,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      : ''
  const refreshContextKey = `${activeWorktreeId ?? ''}::${prCacheKey}::${branch}`
  if (refreshContextKey !== refreshContextKeyRef.current) {
    refreshContextKeyRef.current = refreshContextKey
    refreshRequestKeyRef.current = null
  }
  // Why: background PR refreshes replace the cache map; Checks only renders the entry for the active repo and branch.
  const prCacheEntry = useAppStore((s) => selectReviewCacheEntry(s.prCache, prCacheKey || null))
  const pr: PRInfo | null = prCacheEntry?.data ?? null
  const prCachedHasPR = prCacheEntry ? prCacheEntry.data !== null : null
  const hostedReview = useAppStore((s) =>
    hostedReviewCacheKey ? (s.hostedReviewCache[hostedReviewCacheKey]?.data ?? null) : null
  )
  const linkedReviewNumber =
    activeWorktree?.linkedPR ??
    activeWorktree?.linkedGitLabMR ??
    activeWorktree?.linkedBitbucketPR ??
    activeWorktree?.linkedAzureDevOpsPR ??
    activeWorktree?.linkedGiteaPR ??
    null
  // Why: branch lookup is lossy for fork/deleted-head PRs; reuse a known PR number from metadata or cache whenever we have one.
  const linkedPR = activeWorktree?.linkedPR ?? null
  const fallbackGitHubPRNumber = linkedPR == null ? (pr?.number ?? null) : null
  const linkedGitLabMR = activeWorktree?.linkedGitLabMR ?? null
  const linkedBitbucketPR = activeWorktree?.linkedBitbucketPR ?? null
  const linkedAzureDevOpsPR = activeWorktree?.linkedAzureDevOpsPR ?? null
  const linkedGiteaPR = activeWorktree?.linkedGiteaPR ?? null
  const activeReview: ChecksPanelReview | null = selectChecksPanelReview({
    hostedReview,
    pr,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR
  })
  const activeGitLabReview = isGitLabChecksPanelReview(activeReview) ? activeReview : null
  const isGitLabReviewContext = Boolean(activeGitLabReview || linkedGitLabMR !== null)
  const activeConflictReview = activeReview?.mergeable === 'CONFLICTING' ? activeReview : null
  const prRefreshState = useAppStore((s) =>
    prCacheKey ? s.getEffectiveGitHubPRRefreshState(prCacheKey, prRefreshStateNow) : undefined
  )
  const rawPRRefreshState = useAppStore((s) =>
    prCacheKey ? s.prRefreshStates[prCacheKey] : undefined
  )
  const prNumber = pr?.number ?? null

  useChecksPanelReviewEffects({
    activeWorktreeId,
    branch,
    expireGitHubPRRefreshState,
    isPanelVisible,
    panelContextKey,
    panelContextKeyRef,
    panelVisibleSinceRef,
    pr,
    prCacheKey,
    prNumber,
    prRefreshState,
    rawPRRefreshState,
    repo,
    setHardRefreshError,
    setPrRefreshStateNow,
  })
  // Why: select only timestamps, not whole cache records, so the entry-refresh effect doesn't re-run on every cache mutation. See docs/refresh-on-checks-tab.md.
  const prFetchedAt = useAppStore((s) =>
    prCacheKey ? s.prCache[prCacheKey]?.fetchedAt : undefined
  )
  const checksCacheKey =
    repo && prNumber
      ? getGitHubRepoCacheKey(
          repo.path,
          repo.id,
          prChecksCacheSuffix(prNumber, pr?.prRepo),
          settings,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      : ''
  const commentsCacheKey =
    repo && prNumber
      ? getGitHubRepoCacheKey(
          repo.path,
          repo.id,
          prCommentsCacheSuffix(prNumber, pr?.prRepo),
          settings,
          repo.connectionId,
          repo.executionHostId,
          true
        )
      : ''
  const checksFetchedAt = useAppStore((s) =>
    checksCacheKey ? s.checksCache[checksCacheKey]?.fetchedAt : undefined
  )
  const commentsFetchedAt = useAppStore((s) =>
    commentsCacheKey ? s.commentsCache[commentsCacheKey]?.fetchedAt : undefined
  )

  const hostedReviewCreationRequestKey =
    repo && branch
      ? JSON.stringify({
          repoId: repo.id,
          repoPath: repo.path,
          worktreeId: activeWorktreeId ?? null,
          worktreePath: activeWorktreePath,
          runtimeEnvironmentId,
          connectionId: repoConnectionId,
          branch,
          base: repo.worktreeBaseRef ?? null,
          hasUncommittedChanges:
            gitStatusSnapshot?.contextKey === panelContextKey
              ? gitStatusSnapshot.hasUncommittedChanges
              : null,
          hasUpstream:
            gitStatusSnapshot?.contextKey === panelContextKey
              ? (gitStatusSnapshot.remoteStatus?.hasUpstream ?? null)
              : null,
          ahead:
            gitStatusSnapshot?.contextKey === panelContextKey
              ? (gitStatusSnapshot.remoteStatus?.ahead ?? null)
              : null,
          behind:
            gitStatusSnapshot?.contextKey === panelContextKey
              ? (gitStatusSnapshot.remoteStatus?.behind ?? null)
              : null,
          linkedGitHubPR: linkedPR,
          fallbackGitHubPR: fallbackGitHubPRNumber,
          linkedGitLabMR,
          linkedBitbucketPR,
          linkedAzureDevOpsPR,
          linkedGiteaPR
        })
      : ''
  const gitStatusInputs = readChecksPanelGitStatusSnapshot(gitStatusSnapshot, panelContextKey)
  const gitStatusReadyForPanelContext = gitStatusInputs.hasUncommittedChanges !== undefined
  const hasUncommittedChanges = gitStatusInputs.hasUncommittedChanges
  const remoteStatus = gitStatusInputs.remoteStatus
  const eligibilityHeadOid =
    gitStatusSnapshot?.contextKey === panelContextKey
      ? (gitStatusSnapshot.gitIdentity?.head ?? null)
      : null
  // Read via a ref so a HEAD move drops confirmed (fingerprint mismatch) without re-triggering the eligibility network call.
  const eligibilityHeadOidRef = useRef(eligibilityHeadOid)
  eligibilityHeadOidRef.current = eligibilityHeadOid
  const eligibilityGitFingerprint = gitStatusReadyForPanelContext
    ? buildChecksPanelEligibilityGitFingerprint({
        headOid: eligibilityHeadOid,
        hasUncommittedChanges,
        hasUpstream: remoteStatus?.hasUpstream,
        ahead: remoteStatus?.ahead,
        behind: remoteStatus?.behind,
        base: repo?.worktreeBaseRef ?? null,
        runtimeEnvironmentId,
        repoConnectionId,
        localExecutionScope
      })
    : null
  // Why: Publish can use the worktree poller when the stricter panel snapshot is delayed; still blocked for dirty fallback status.
  const publishActionGitStatusInputs = readChecksPanelPublishActionGitStatus({
    snapshot: gitStatusSnapshot,
    contextKey: panelContextKey,
    fallbackEntries: gitStatusInvalidation,
    fallbackRemoteStatus: remoteStatusInvalidation
  })
  const publishActionHasUncommittedChanges =
    publishActionGitStatusInputs.hasUncommittedChanges ?? true
  const publishActionRemoteStatus = publishActionGitStatusInputs.remoteStatus
  const hostedReviewCreation =
    hostedReviewCreationSnapshot?.requestKey === hostedReviewCreationRequestKey
      ? hostedReviewCreationSnapshot.data
      : null
  const hostedReviewCreateProvider = resolveHostedReviewCreationProvider(
    hostedReviewCreation?.provider
  )
  // Only GitHub runs the gh refresh coordinator; re-derive GitHub-ness from linked reviews because resolveHostedReviewCreationProvider defaults null→'github' (can't tell unknown from GitHub), staying GitHub-optimistic pre-eligibility.
  const hasNonGitHubLinkedReview =
    activeWorktree?.linkedGitLabMR != null ||
    activeWorktree?.linkedBitbucketPR != null ||
    activeWorktree?.linkedAzureDevOpsPR != null ||
    activeWorktree?.linkedGiteaPR != null
  const isGitHubReviewContext = hostedReviewCreation
    ? hostedReviewCreation.provider === 'github'
    : !hasNonGitHubLinkedReview
  const hostedReviewCreateCopy = localizedHostedReviewCopy(hostedReviewCreateProvider)
  // The PR cache isn't push-target scoped, so demote a branch-scoped no-PR to unknown when the eligibility snapshot is for a different context.
  const prCachedHasPRForContext =
    hostedReviewCreationSnapshot && hostedReviewCreationSnapshot.contextKey !== panelContextKey
      ? null
      : prCachedHasPR
  // Four-state review evidence so the empty state can never claim "No review found" without accepted evidence.
  const checksPanelReviewLookupResult = resolveChecksPanelReviewLookup({
    pr,
    prCachedHasPR: prCachedHasPRForContext,
    hostedReview,
    linkedReviewNumber,
    eligibilityReviewLookupOutcome: hostedReviewCreation?.reviewLookupOutcome ?? null,
    eligibilityReview: hostedReviewCreation?.review ?? null
  })
  const checksPanelReviewLookup = checksPanelReviewLookupResult.state
  const hasUnrenderedReviewEvidence =
    checksPanelReviewLookup === 'positive_unresolved' ||
    (checksPanelReviewLookup !== 'found' &&
      hostedReviewCreation?.blockedReason === 'existing_review')
  const unrenderedReviewEvidenceIdentity =
    linkedReviewNumber ??
    hostedReview?.number ??
    hostedReviewCreation?.review?.number ??
    checksPanelReviewLookupResult.openReviewUrl ??
    'unknown'
  const unrenderedReviewEvidenceProvider = resolveChecksPanelReviewEvidenceProvider({
    linkedGitHubPR: linkedPR,
    linkedGitLabMR,
    linkedBitbucketPR,
    linkedAzureDevOpsPR,
    linkedGiteaPR,
    eligibilityProvider: hostedReviewCreation?.provider,
    cachedProvider: hostedReview?.provider
  })
  const foregroundReviewEvidenceKey = getChecksPanelForegroundReviewEvidenceKey({
    refreshContextKey,
    reviewEvidenceIdentity: unrenderedReviewEvidenceIdentity,
    reviewEvidenceProvider: unrenderedReviewEvidenceProvider,
    hasUnrenderedReviewEvidence,
    isGitHubReviewContext
  })
  // Confirmed readiness from the last eligibility snapshot, not live canCreate (which would be circular and flap during transient failures).
  const hardErrorObservedAt =
    isGitHubReviewContext && hardRefreshError && hardRefreshError.contextKey === panelContextKey
      ? hardRefreshError.observedAt
      : undefined
  const confirmedReadinessInput: ChecksPanelConfirmedReadinessInput = {
    contextKeyMatches: hostedReviewCreationSnapshot?.contextKey === panelContextKey,
    eligibility: hostedReviewCreationSnapshot?.data ?? null,
    eligibilityCompletedAt: hostedReviewCreationSnapshot?.completedAt,
    eligibilityRequestStartedAt: hostedReviewCreationSnapshot?.requestStartedAt,
    reviewLookup: checksPanelReviewLookup,
    hardErrorObservedAt,
    gitSnapshotMatches:
      eligibilityGitFingerprint !== null &&
      hostedReviewCreationSnapshot?.gitFingerprint === eligibilityGitFingerprint,
    now: Date.now()
  }
  const confirmedReadiness = computeChecksPanelConfirmedReadiness(confirmedReadinessInput)
  // A hard error persists until a qualifying eligibility request clears it; queued/in-flight status no longer un-hides Create.
  const checksPanelHasHardRefreshError =
    hardErrorObservedAt !== undefined && !isChecksPanelHardErrorCleared(confirmedReadinessInput)
  const activePullRequestGenerationKey = getPullRequestGenerationRecordKey({
    worktreeId: activeWorktreeId,
    worktreePath: activeWorktreePath,
    repoId: repo?.id,
    branch
  })
  const activePullRequestGenerationRecordCandidate = activePullRequestGenerationKey
    ? (prGenerationRecords[activePullRequestGenerationKey] ?? null)
    : null
  const activePullRequestGenerationRecord =
    activePullRequestGenerationRecordCandidate &&
    activePullRequestGenerationRecordCandidate.context.repoId === repo?.id &&
    activePullRequestGenerationRecordCandidate.context.branch === branch
      ? activePullRequestGenerationRecordCandidate
      : null
  const activePullRequestGenerationSeedRestoreKey = getPullRequestGenerationSeedRestoreKey({
    recordKey: activePullRequestGenerationKey,
    record: activePullRequestGenerationRecord
  })
  const createPrPushFirst = activePullRequestGenerationRecord?.requiresPushBeforeCreate === true
  const generation = useChecksPanelGeneration({
    activePullRequestGenerationKey,
    activePullRequestGenerationRecord,
    activePullRequestGenerationSeedRestoreKey,
    activeReview,
    activeWorktreeId,
    activeWorktreePath,
    allocatePullRequestGenerationRequestId,
    branch,
    confirmedReadiness,
    fetchUpstreamStatus,
    hostedReviewCreateProvider,
    hostedReviewCreation,
    isFolder,
    ownerSettings,
    pr,
    prGenerationRecords,
    repo,
    setCreatePrError,
    setPullRequestGenerationRecord,
    settings,
    updatePullRequestGenerationRecord,
  }) as { handleGeneratePullRequestFields: () => Promise<void>; handleGeneratePullRequestFieldsForActive: (...args: never[]) => void; handleCancelGeneratePullRequestFields: () => void; handlePullRequestGenerationSeedRestored: () => void; handlePrBaseChange: (value: string) => void; handlePrTitleChange: (value: string) => void; prAiGenerationEnabled: boolean; prBase: string; setPrBase: (value: string) => void; prTitle: string; setPrTitle: (value: string) => void; prBody: string; setPrBody: (value: string) => void; prDraft: boolean; setPrDraft: (value: boolean) => void; prBaseQuery: string; setPrBaseQuery: (value: string) => void; prBaseResults: unknown[]; setPrBaseResults: (value: unknown[]) => void; prBaseSearchError: string | null; prGenerating: boolean; prGenerateError: string | null; prGenerateDisabled: boolean; prGenerateDisabledReason: string | null; applyGeneratedPullRequestFields: (...args: never[]) => void; pullRequestFieldsInitialized: boolean }
  const { handleGeneratePullRequestFields, handleGeneratePullRequestFieldsForActive, handleCancelGeneratePullRequestFields, handlePullRequestGenerationSeedRestored, handlePrBaseChange, handlePrTitleChange, prAiGenerationEnabled, prBase, setPrBase, prTitle, setPrTitle, prBody, setPrBody, prDraft, setPrDraft, prBaseQuery, setPrBaseQuery, prBaseResults, setPrBaseResults, prBaseSearchError, prGenerating, prGenerateError, prGenerateDisabled, prGenerateDisabledReason, applyGeneratedPullRequestFields, pullRequestFieldsInitialized } = generation
  const stateRequestKey =
    repo && branch
      ? activeGitLabReview
        ? checksPanelHostedReviewAsyncResultKey(
            hostedReviewCacheKey,
            branch,
            activeGitLabReview.provider,
            activeGitLabReview.number,
            activeGitLabReview.headSha
          )
        : checksPanelAsyncResultKey(prCacheKey, branch, prNumber, pr?.prRepo, pr?.headSha)
      : ''
  asyncResultKeyRef.current = stateRequestKey

  const isCurrentAsyncResult = useCallback(
    (requestKey: string) =>
      shouldCommitChecksPanelAsyncResult(asyncResultKeyRef.current, requestKey),
    []
  )
  useEffect(() => {
    if (
      agentComposerState?.commentResolution &&
      agentComposerState.commentResolution.reviewContextKey !== stateRequestKey
    ) {
      setAgentComposerState(null)
    }
  }, [agentComposerState?.commentResolution, stateRequestKey])

  useEffect(() => {
    if (foregroundReviewEvidenceKey === null || !isPanelVisible) {
      foregroundedUnrenderedReviewKeyRef.current = null
    }
    if (isPanelVisible && repo && !isFolder && branch) {
      void fetchHostedReviewForBranch(repo.path, branch, {
        repoId: repo.id,
        linkedGitHubPR: linkedPR,
        fallbackGitHubPR: fallbackGitHubPRNumber,
        currentHeadOid: activeWorktree?.head ?? null,
        linkedGitLabMR,
        linkedBitbucketPR,
        linkedAzureDevOpsPR,
        linkedGiteaPR,
        staleWhileRevalidate: true
      })
      // Why: the gh-based refresh coordinator is GitHub-only; running it elsewhere gave a spurious gh_unavailable error hiding a valid composer.
      if (activeWorktreeId && isGitHubReviewContext) {
        const refreshRequest = resolveChecksPanelPRRefreshRequest({
          cachedHasPR: prCachedHasPR,
          cachedFetchedAt: prFetchedAt ?? null,
          panelVisibleSince: panelVisibleSinceRef.current,
          hasUnrenderedReviewEvidence: foregroundReviewEvidenceKey !== null,
          hasRequestedForegroundRefresh:
            foregroundReviewEvidenceKey !== null &&
            foregroundedUnrenderedReviewKeyRef.current === foregroundReviewEvidenceKey
        })
        if (refreshRequest.reason === 'active' && foregroundReviewEvidenceKey !== null) {
          foregroundedUnrenderedReviewKeyRef.current = foregroundReviewEvidenceKey
        }
        enqueueGitHubPRRefresh(activeWorktreeId, refreshRequest.reason, refreshRequest.priority)
      }
    }
  }, [
    activeWorktreeId,
    branch,
    enqueueGitHubPRRefresh,
    fallbackGitHubPRNumber,
    fetchHostedReviewForBranch,
    foregroundReviewEvidenceKey,
    isFolder,
    isGitHubReviewContext,
    isPanelVisible,
    activeWorktree?.head,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGiteaPR,
    linkedGitLabMR,
    linkedPR,
    prCachedHasPR,
    prFetchedAt,
    repo
  ])

  useEffect(() => {
    if (
      !shouldPollChecksPanelRuntimeSshStatus({
        isPanelVisible,
        runtimeEnvironmentId,
        repoConnectionId
      })
    ) {
      return undefined
    }
    let skippedInitialRun = false
    return installWindowVisibilityInterval({
      run: () => {
        if (!skippedInitialRun) {
          skippedInitialRun = true
          return
        }
        const currentContextKey = panelContextKeyRef.current
        if (
          shouldCoalesceChecksPanelGitStatusSnapshotRefresh(
            gitStatusSnapshotInFlightContextRef.current,
            currentContextKey
          )
        ) {
          gitStatusSnapshotRerunContextRef.current = currentContextKey
          return
        }
        setGitStatusRefreshNonce((value) => value + 1)
      },
      intervalMs: RUNTIME_SSH_STATUS_REFRESH_MS
    })
  }, [isPanelVisible, repoConnectionId, runtimeEnvironmentId])

  useChecksPanelGitEffects({
    activeConnectionId,
    activeWorktreeId,
    activeWorktreePath,
    activeWorktreePushTarget,
    branch,
    conflictSummaryRefreshKeyRef,
    eligibilityHeadOidRef,
    fallbackGitHubPRNumber,
    fetchPRForBranch,
    getHostedReviewCreationEligibility,
    gitStatusInvalidation,
    gitStatusReadyForPanelContext,
    gitStatusSnapshotInFlightContextRef,
    gitStatusSnapshotRerunContextRef,
    gitStatusSnapshotRetryTimerRef,
    hasUncommittedChanges,
    hostedReviewCreationRequestKey,
    isFolder,
    isPanelVisible,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGitLabMR,
    linkedGiteaPR,
    linkedPR,
    localExecutionScope,
    ownerSettings,
    panelContextKey,
    panelContextKeyRef,
    pr,
    prCacheKey,
    remoteStatus,
    remoteStatusInvalidation,
    repo,
    repoConnectionId,
    runtimeEnvironmentId,
    setConflictDetailsRefreshing,
    setGitStatusProbeErrorContextKey,
    setGitStatusRefreshNonce,
    setGitStatusSnapshot,
    setHostedReviewCreationSnapshot,
    settings,
    sshConnectionStatus,
    updateWorktreeGitIdentity,
  })
  const { fetchChecks, fetchGitLabDetails } = useChecksPanelFetch({
    activeGitLabReview,
    asyncResultKeyRef,
    branch,
    fetchPRChecks,
    hostedReviewCacheKey,
    isCurrentAsyncResult,
    pollIntervalRef,
    pr,
    prCacheKey,
    prNumber,
    prevChecksRef,
    repo,
    setChecks,
    setChecksLoading,
    setComments,
    setCommentsLoading,
    settings,
  }) as { fetchChecks: (options?: { force?: boolean; prNumberOverride?: number | null }) => Promise<void>; fetchGitLabDetails: (options?: { mrNumberOverride?: number | null; headShaOverride?: string | null; commitAsCurrent?: boolean }) => Promise<void> }
  useEffect(() => {
    if (activeGitLabReview) {
      return
    }
    if (!prNumber || !isPanelVisible) {
      setChecks([])
      return
    }

    // Reset backoff state on PR change
    pollIntervalRef.current = 30_000
    prevChecksRef.current = ''
    // Why: check status is user-visible; keep visible unfocused windows fresh but stop timers/API work while hidden.
    return installWindowVisibilityTimeoutPoller({
      run: () => fetchChecks(),
      getDelayMs: () => pollIntervalRef.current
    })
  }, [activeGitLabReview, fetchChecks, isPanelVisible, prNumber])

  useEffect(() => {
    if (!activeGitLabReview || !isPanelVisible) {
      return
    }

    pollIntervalRef.current = 30_000
    prevChecksRef.current = ''
    return installWindowVisibilityTimeoutPoller({
      run: () => fetchGitLabDetails(),
      getDelayMs: () => pollIntervalRef.current
    })
  }, [activeGitLabReview, fetchGitLabDetails, isPanelVisible])

  const { fetchComments, handleLoadCheckDetails } = useChecksPanelCommentFetch({
    activeGitLabReview,
    branch,
    checksPanelAsyncResultKey,
    fetchPRCheckDetails,
    fetchPRComments,
    isCurrentAsyncResult,
    isPanelVisible,
    pr,
    prCacheKey,
    prNumber,
    repo,
    setComments,
    setCommentsLoading
  }) as {
    fetchComments: (options?: {
      force?: boolean
      prNumberOverride?: number | null
      prRepoOverride?: PRInfo['prRepo'] | null
    }) => Promise<void>
    handleLoadCheckDetails: (check: PRCheckDetail) => Promise<unknown>
  }

  const handleRefresh = useChecksPanelRefresh({
    activeConnectionId,
    activeGitLabReview,
    activeWorktreeId,
    activeWorktreePath,
    activeWorktreePushTarget,
    asyncResultKeyRef,
    branch,
    expireGitHubPRRefreshState,
    fallbackGitHubPRNumber,
    fetchChecks,
    fetchGitLabDetails,
    fetchHostedReviewForBranch,
    fetchPRChecks,
    fetchPRComments,
    fetchPRForBranch,
    hasUncommittedChanges,
    isCurrentAsyncResult,
    isFolder,
    isGitLabReviewContext,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGitLabMR,
    linkedGiteaPR,
    linkedPR,
    ownerSettings,
    panelContextKey,
    panelContextKeyRef,
    pollIntervalRef,
    pr,
    prCacheKey,
    prNumber,
    prevChecksRef,
    rawPRRefreshState,
    refreshInFlightRef,
    refreshRequestKeyRef,
    remoteStatus,
    repo,
    settings,
    updateWorktreeGitIdentity,
    setChecks,
    setChecksLoading,
    setComments,
    setCommentsLoading,
    setEligibilityRefreshNonce,
    setGitStatusSnapshot,
    setIsRefreshing,
  }) as () => Promise<void>
  const handleEntryRefresh = useCallback(
    (options: { refreshChecks: boolean; refreshComments: boolean }) => {
      if (!repo || !branch || !activeWorktreeId) {
        return
      }
      // Why: tab entry is automatic UI, not a user refresh; keep coordinator rate-limit guards and only force panes already proven stale.
      if (isGitLabReviewContext) {
        void fetchHostedReviewForBranch(repo.path, branch, {
          force: true,
          repoId: repo.id,
          linkedGitHubPR: linkedPR,
          fallbackGitHubPR: fallbackGitHubPRNumber,
          currentHeadOid: activeWorktree?.head ?? null,
          linkedGitLabMR,
          linkedBitbucketPR,
          linkedAzureDevOpsPR,
          linkedGiteaPR
        })
        if (activeGitLabReview) {
          void fetchGitLabDetails()
        }
        return
      }
      enqueueGitHubPRRefresh(activeWorktreeId, 'active', 80)
      if (options.refreshChecks) {
        void fetchChecks({ force: true })
      }
      if (options.refreshComments) {
        void fetchComments({ force: true })
      }
    },
    [
      activeGitLabReview,
      activeWorktree?.head,
      activeWorktreeId,
      branch,
      enqueueGitHubPRRefresh,
      fallbackGitHubPRNumber,
      fetchChecks,
      fetchComments,
      fetchGitLabDetails,
      fetchHostedReviewForBranch,
      isGitLabReviewContext,
      linkedAzureDevOpsPR,
      linkedBitbucketPR,
      linkedGiteaPR,
      linkedGitLabMR,
      linkedPR,
      repo
    ]
  )

  // Why: force a freshness check on each Checks-tab entry so externally-changed PRs appear without waiting for the cache TTL. See docs/refresh-on-checks-tab.md.
  const entryKey =
    isPanelVisible && repo && !isFolder && branch
      ? `${activeWorktreeId ?? ''}::${activeGitLabReview ? hostedReviewCacheKey : prCacheKey}`
      : ''
  const lastEntryKeyRef = useRef<string>('')
  useEffect(() => {
    if (!entryKey) {
      // Reset on hide so reopening the same PR re-evaluates freshness; a prevKey !== currentKey check alone would miss close-and-reopen.
      lastEntryKeyRef.current = ''
      return
    }
    if (lastEntryKeyRef.current === entryKey) {
      return
    }
    lastEntryKeyRef.current = entryKey

    const now = Date.now()
    const stale = shouldEntryRefresh({
      prFetchedAt,
      checksFetchedAt,
      commentsFetchedAt,
      prNumber,
      now,
      graceMs: ENTRY_REFRESH_GRACE_MS
    })
    if (!stale) {
      return
    }
    const cutoff = now - ENTRY_REFRESH_GRACE_MS
    const refreshChecks =
      prNumber !== null && (checksFetchedAt === undefined || checksFetchedAt < cutoff)
    const refreshComments =
      prNumber !== null && (commentsFetchedAt === undefined || commentsFetchedAt < cutoff)

    // Reset polling attention state so the forced fetch establishes a fresh baseline instead of colliding with the previous PR's backoff.
    pollIntervalRef.current = 30_000
    prevChecksRef.current = ''
    handleEntryRefresh({ refreshChecks, refreshComments })
  }, [entryKey, prFetchedAt, checksFetchedAt, commentsFetchedAt, prNumber, handleEntryRefresh])

  const refreshHostedReviewAfterMutation = useCallback(async () => {
    if (!repo || !branch) {
      return
    }
    if (activeReview?.provider === 'gitlab') {
      const refreshedReview = await refreshHostedReviewCard(fetchHostedReviewForBranch, {
        repoPath: repo.path,
        repoId: repo.id,
        branch,
        linkedGitHubPR: linkedPR,
        fallbackGitHubPR: fallbackGitHubPRNumber,
        linkedGitLabMR,
        linkedBitbucketPR,
        linkedAzureDevOpsPR,
        linkedGiteaPR
      })
      const refreshedGitLabReview =
        refreshedReview?.provider === 'gitlab' ? refreshedReview : activeGitLabReview
      if (refreshedGitLabReview) {
        await fetchGitLabDetails({
          mrNumberOverride: refreshedGitLabReview.number,
          headShaOverride: refreshedGitLabReview.headSha,
          commitAsCurrent: true
        })
      }
      return
    }
    const refreshedPR = await fetchPRForBranch(repo.path, branch, {
      force: true,
      repoId: repo.id,
      worktreeId: activeWorktreeId ?? undefined,
      linkedPRNumber: linkedPR,
      fallbackPRNumber: fallbackGitHubPRNumber
    })
    await refreshHostedReviewCard(fetchHostedReviewForBranch, {
      repoPath: repo.path,
      repoId: repo.id,
      branch,
      linkedGitHubPR: linkedPR,
      fallbackGitHubPR: refreshedPR?.number ?? fallbackGitHubPRNumber,
      linkedGitLabMR,
      linkedBitbucketPR,
      linkedAzureDevOpsPR,
      linkedGiteaPR
    })
  }, [
    activeGitLabReview,
    activeReview?.provider,
    activeWorktreeId,
    branch,
    fallbackGitHubPRNumber,
    fetchGitLabDetails,
    fetchHostedReviewForBranch,
    fetchPRForBranch,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGiteaPR,
    linkedGitLabMR,
    linkedPR,
    repo
  ])

  const detectedAgentsForAI =
    typeof activeConnectionId === 'string' ? remoteDetectedAgentIds : detectedAgentIds
  const noEnabledAgentKnown =
    detectedAgentsForAI != null &&
    pickDefaultSourceControlAgent(
      settings?.defaultTuiAgent,
      detectedAgentsForAI,
      settings?.disabledTuiAgents
    ) == null
  const aiActionDisabledReason = !activeWorktreeId
    ? 'Select a workspace before launching an AI action.'
    : noEnabledAgentKnown
      ? 'No enabled AI agents. Configure agents in Settings.'
      : undefined
  const resolveCommentsWithAIDisabledReason = commentsLoading
    ? 'Comments are still loading.'
    : aiActionDisabledReason
      ? aiActionDisabledReason
      : !activeReview
        ? 'Open a PR or MR before launching an AI action.'
        : !repo
          ? 'Select a repository before launching an AI action.'
          : activeReview.provider === 'github' && !prNumber
            ? 'Open a GitHub PR before resolving comments.'
            : activeReview.provider === 'gitlab' && !activeGitLabReview
              ? 'Open a GitLab MR before resolving comments.'
              : undefined

  const { handleStartEdit, handleCancelEdit, handleSaveTitle, handleTitleKeyDown, handleResolve, handleAddPRComment, handleEditComment, handleDeleteComment, handleReplyToComment } = useChecksPanelCommentActions({
    activeConnectionId,
    activeGitLabReview,
    activeReview,
    activeWorktreeId,
    addPRConversationComment,
    addPRReviewCommentReply,
    branch,
    clearTitleInputFocusTimer,
    confirm,
    detectedAgentIds,
    isCurrentAsyncResult,
    mountedRef,
    pr,
    prCacheKey,
    prNumber,
    refreshHostedReviewAfterMutation,
    remoteDetectedAgentIds,
    repo,
    resolveReviewThread,
    setAgentComposerState,
    setComments,
    setEditingTitle,
    setTitleDraft,
    setTitleSaving,
    settings,
    sourceControlAiActionsVisible,
    titleInputFocusTimerRef,
    titleInputRef,
  }) as { handleStartEdit: () => void; handleCancelEdit: () => void; handleSaveTitle: () => Promise<void>; handleTitleKeyDown: (event: React.KeyboardEvent) => void; handleResolve: (threadId: string, resolve: boolean, options?: { notifyOnFailure?: boolean }) => Promise<boolean>; handleAddPRComment: (body: string) => Promise<{ ok: boolean; error?: string }>; handleEditComment: (comment: PRComment, body: string) => Promise<boolean>; handleDeleteComment: (comment: PRComment) => Promise<void>; handleReplyToComment: (comment: PRComment, body: string) => Promise<{ ok: boolean; error?: string }> }
  const { handleResolveConflictsWithAI, handleResolveCommentsWithAI } = useChecksPanelAiActions({
    activeConflictReview,
    activeReview,
    activeWorktreeId,
    activeWorktreePath,
    asyncResultKeyRef,
    branch,
    commentsRef,
    commentsSelectionClearTokenRef,
    fetchComments,
    fetchGitLabDetails,
    handleResolve,
    fetchHostedReviewForBranch,
    fetchPRCheckDetails,
    fetchPRChecks,
    fetchPRComments,
    fetchPRForBranch,
    isCurrentAsyncResult,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGitLabMR,
    linkedGiteaPR,
    panelContextKey,
    panelContextKeyRef,
    pr,
    prCacheKey,
    repo,
    resolveCommentsWithAIDisabledReason,
    setAgentComposerState,
    setChecks,
    setChecksLoading,
    setComments,
    setCommentsLoading,
    setCommentsSelectionClearRequest,
    sourceControlAiActionsVisible,
    stateRequestKey,
  }) as { handleResolveConflictsWithAI: () => Promise<void>; handleResolveCommentsWithAI: (groups: PRCommentGroup[]) => void }
  const handleFixChecksWithAI = useChecksPanelFixChecks({
    activeReview,
    activeWorktreeId,
    checks,
    fetchPRCheckDetails,
    isCurrentAsyncResult,
    isFixingChecksWithAI,
    pr,
    repo,
    sourceControlAiActionsVisible,
    stateRequestKey,
    setIsFixingChecksWithAI
  })
  const { handleOpenPR, handleUnlinkPullRequest, handleLinkAnotherPullRequest, pushBeforeCreatePullRequest, handlePublishBranch, handleSyncBranch, handlePullRequestCreated } = useChecksPanelLinkActions({
    activeConnectionId,
    activeReview,
    activeWorktreeId,
    branch,
    fallbackGitHubPRNumber,
    fetchHostedReviewForBranch,
    fetchUpstreamStatus,
    isRemoteOperationActive,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGitLabMR,
    linkedGiteaPR,
    linkedPR,
    openModal,
    ownerSettings,
    pr,
    pushBranch,
    repo,
    setGitStatusRefreshNonce,
    setIsPublishingBranch,
    setIsSyncingBranch,
    setRightSidebarOpen,
    setRightSidebarTab,
    syncBranch,
    updateWorktreeMeta,
  }) as { handleOpenPR: (event: React.MouseEvent<HTMLButtonElement>) => void; handleUnlinkPullRequest: () => void; handleLinkAnotherPullRequest: () => void; pushBeforeCreatePullRequest: () => Promise<boolean>; handlePublishBranch: () => Promise<void>; handleSyncBranch: () => Promise<void>; handlePullRequestCreated: (result: { provider: HostedReviewProvider; number: number; url: string }) => Promise<void> }
  const handleCreatePullRequest = useChecksPanelCreateAction({
    activePullRequestGenerationKey,
    activeWorktreeId,
    activeWorktreePath,
    branch,
    createComposerOpen,
    createHostedReview,
    createPrInFlightRef,
    createPrPushFirst,
    hostedReviewCreateCopy,
    hostedReviewCreateProvider,
    hostedReviewCreation,
    panelContextKey,
    panelContextKeyRef,
    prCreationDefaults,
    repo,
    setCreatePrError,
    setGitStatusRefreshNonce,
    setIsCreatingPr,
    updatePullRequestGenerationRecord,
  }) as () => Promise<void>
  return renderChecksPanel({
    activeConflictReview,
    activeConnectionId,
    activeGitLabReview,
    activePullRequestGenerationKey,
    activePullRequestGenerationRecord,
    activePullRequestGenerationRecordCandidate,
    activePullRequestGenerationSeedRestoreKey,
    activeReview,
    activeSourceControlLaunchPlatform,
    activeWorktreeId,
    activeWorktreePath,
    activeWorktreePushTarget,
    addPRConversationComment,
    addPRReviewCommentReply,
    aiActionDisabledReason,
    allocatePullRequestGenerationRequestId,
    asyncResultKeyRef,
    branch,
    canTargetPRComments,
    checksCacheKey,
    checksFetchedAt,
    checksPanelHasHardRefreshError,
    checksPanelReviewLookup,
    checksPanelReviewLookupResult,
    clearSentCommentSelection,
    clearTitleInputFocusTimer,
    commentsCacheKey,
    commentsDisabledReason,
    commentsFetchedAt,
    commentsRef,
    commentsSelectionClearTokenRef,
    confirm,
    confirmedReadiness,
    confirmedReadinessInput,
    conflictOperation,
    conflictSummaryRefreshKeyRef,
    createComposerOpen,
    createHostedReview,
    createPrInFlightRef,
    createPrPushFirst,
    defaultActiveWorktree,
    detachedHeadDisplay,
    detectedAgentIds,
    detectedAgentsForAI,
    eligibilityGitFingerprint,
    eligibilityHeadOid,
    eligibilityHeadOidRef,
    enqueueGitHubPRRefresh,
    entryKey,
    expireGitHubPRRefreshState,
    fallbackGitHubPRNumber,
    fetchChecks,
    fetchComments,
    fetchGitLabDetails,
    fetchHostedReviewForBranch,
    fetchPRCheckDetails,
    fetchPRChecks,
    fetchPRComments,
    fetchPRForBranch,
    fetchUpstreamStatus,
    foregroundReviewEvidenceKey,
    foregroundedUnrenderedReviewKeyRef,
    getHostedReviewCreationEligibility,
    gitIdentityDisplay,
    gitStatusInputs,
    gitStatusInvalidation,
    gitStatusReadyForPanelContext,
    gitStatusSnapshotInFlightContextRef,
    gitStatusSnapshotRerunContextRef,
    gitStatusSnapshotRetryTimerRef,
    handleAddPRComment,
    handleBranchChangedByPullRequestGeneration,
    handleCancelEdit,
    handleCancelGeneratePullRequestFieldsForActive,
    handleCreatePullRequest,
    handleDeleteComment,
    handleEditComment,
    handleEntryRefresh,
    handleFixChecksWithAI,
    handleGeneratePullRequestFieldsForActive,
    handleLinkAnotherPullRequest,
    handleLoadCheckDetails,
    handleOpenPR,
    handlePrBaseChange,
    handlePrTitleChange,
    handlePublishBranch,
    handlePullRequestCreated,
    handlePullRequestGenerationSeedRestored,
    handleRefresh,
    handleReplyToComment,
    handleResolve,
    handleResolveCommentsWithAI,
    handleResolveConflictsWithAI,
    handleSaveTitle,
    handleStartEdit,
    handleSyncBranch,
    handleTitleKeyDown,
    handleUnlinkPullRequest,
    hardErrorObservedAt,
    hasNonGitHubLinkedReview,
    hasUncommittedChanges,
    hasUnrenderedReviewEvidence,
    hostedReview,
    hostedReviewCacheKey,
    hostedReviewCreateCopy,
    hostedReviewCreateProvider,
    hostedReviewCreation,
    hostedReviewCreationRequestKey,
    isCurrentAsyncResult,
    isFolder,
    isGitHubReviewContext,
    isGitLabReviewContext,
    isPanelVisible,
    isRemoteOperationActive,
    isResolvingConflictsWithAI,
    lastEntryKeyRef,
    linkedAzureDevOpsPR,
    linkedBitbucketPR,
    linkedGitLabMR,
    linkedGiteaPR,
    linkedPR,
    linkedReviewNumber,
    localExecutionScope,
    mountedRef,
    noEnabledAgentKnown,
    openModal,
    ownerSettings,
    panelContextKey,
    panelContextKeyRef,
    panelVisibleSinceRef,
    pollIntervalRef,
    pr,
    prCacheEntry,
    prCacheKey,
    prCachedHasPR,
    prCachedHasPRForContext,
    prCreationDefaults,
    prFetchedAt,
    prGenerationRecords,
    prNumber,
    prRefreshState,
    prevChecksRef,
    publishActionGitStatusInputs,
    publishActionHasUncommittedChanges,
    publishActionRemoteStatus,
    pushBeforeCreatePullRequest,
    pushBranch,
    rawPRRefreshState,
    refreshCommentsAfterBulkResolve,
    refreshContextKey,
    refreshContextKeyRef,
    refreshHostedReviewAfterMutation,
    refreshInFlightRef,
    refreshLinkedGitHubPullRequest,
    refreshRequestKeyRef,
    remoteDetectedAgentIds,
    remoteStatus,
    remoteStatusInvalidation,
    repo,
    repoConnectionId,
    resolveCommentsWithAIDisabledReason,
    resolveReviewThread,
    resolveSelectedThreadsAfterLaunch,
    rightSidebarOpen,
    rightSidebarTab,
    runtimeEnvironmentId,
    saveLaunchActionDefault,
    setChecksPanelContentRef,
    setPullRequestGenerationRecord,
    setRightSidebarOpen,
    setRightSidebarTab,
    settings,
    sourceControlAiActionsVisible,
    sshConnectionStatus,
    stateRequestKey,
    syncBranch,
    titleInputFocusTimerRef,
    titleInputRef,
    unrenderedReviewEvidenceIdentity,
    unrenderedReviewEvidenceProvider,
    updatePullRequestGenerationRecord,
    updateRepo,
    updateSettings,
    updateWorktreeGitIdentity,
    updateWorktreeMeta,
    checksLoading,
    commentsLoading,
    commentsSelectionClearRequest,
    emptyRefreshing,
    isRefreshing,
    conflictDetailsRefreshing,
    createPrError,
    gitStatusProbeErrorContextKey,
    gitStatusRefreshNonce,
    eligibilityRefreshNonce,
    editingTitle,
    titleDraft,
    titleSaving,
    prAiGenerationEnabled,
    setPrBody,
    setPrDraft,
    prBaseQuery,
    setPrBaseQuery,
    prBaseResults,
    setPrBaseResults,
    prBaseSearchError,
    prGenerateError,
    prGenerateDisabled,
    prGenerateDisabledReason,
    pullRequestFieldsInitialized,
    handleGeneratePullRequestFields,
    handleCancelGeneratePullRequestFields,
    isPublishingBranch,
    isSyncingBranch,
    prBase,
    prTitle,
    prBody,
    prDraft,
    prGenerating,
    isCreatingPr,
    setPrBase,
    setPrTitle,
    applyGeneratedPullRequestFields,
  })
}
