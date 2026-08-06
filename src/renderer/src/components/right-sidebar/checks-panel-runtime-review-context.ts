import type { GitStatusEntry, GitUpstreamStatus, PRInfo } from '../../../../shared/types'
import type { HostedReviewCreationEligibility } from '../../../../shared/hosted-review'
import type { ChecksPanelReview } from './checks-panel-review'
import {
  computeChecksPanelConfirmedReadiness,
  isChecksPanelHardErrorCleared,
  type ChecksPanelConfirmedReadinessInput
} from './checks-panel-review-creation'
import {
  getChecksPanelForegroundReviewEvidenceKey,
  resolveChecksPanelReviewEvidenceProvider
} from './checks-panel-pr-refresh-request'
import { resolveChecksPanelReviewLookup } from './checks-panel-review-lookup-authority'
import {
  readChecksPanelGitStatusSnapshot,
  readChecksPanelPublishActionGitStatus,
  type ChecksPanelGitStatusSnapshot
} from './checks-panel-git-status-snapshot'
import { resolveHostedReviewCreationProvider } from '../../../../shared/hosted-review-creation-providers'
import { localizedHostedReviewCopy } from '@/i18n/hosted-review-localized-copy'

export function buildChecksPanelEligibilityGitFingerprint(input: {
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

export type ChecksPanelReviewContext = {
  hostedReviewCreationRequestKey: string
  gitStatusInputs: ReturnType<typeof readChecksPanelGitStatusSnapshot>
  gitStatusReadyForPanelContext: boolean
  hasUncommittedChanges: boolean | undefined
  remoteStatus: ReturnType<typeof readChecksPanelGitStatusSnapshot>['remoteStatus']
  eligibilityHeadOid: string | null
  eligibilityGitFingerprint: string | null
  publishActionGitStatusInputs: ReturnType<typeof readChecksPanelPublishActionGitStatus>
  publishActionHasUncommittedChanges: boolean
  publishActionRemoteStatus: ReturnType<
    typeof readChecksPanelPublishActionGitStatus
  >['remoteStatus']
  hostedReviewCreation: HostedReviewCreationEligibility | null
  hostedReviewCreateProvider: ReturnType<typeof resolveHostedReviewCreationProvider>
  hostedReviewCreateCopy: ReturnType<typeof localizedHostedReviewCopy>
  hasNonGitHubLinkedReview: boolean
  isGitHubReviewContext: boolean
  prCachedHasPRForContext: boolean | null
  checksPanelReviewLookup: ReturnType<typeof resolveChecksPanelReviewLookup>['state']
  checksPanelReviewLookupResult: ReturnType<typeof resolveChecksPanelReviewLookup>
  hasUnrenderedReviewEvidence: boolean
  unrenderedReviewEvidenceIdentity: number | string
  unrenderedReviewEvidenceProvider: ReturnType<typeof resolveChecksPanelReviewEvidenceProvider>
  foregroundReviewEvidenceKey: string | null
  hardErrorObservedAt: number | undefined
  confirmedReadinessInput: ChecksPanelConfirmedReadinessInput
  confirmedReadiness: ReturnType<typeof computeChecksPanelConfirmedReadiness>
  checksPanelHasHardRefreshError: boolean
}

export function buildChecksPanelHostedReviewCreationRequestKey(input: {
  repo: { id: string; path: string; worktreeBaseRef?: string | null } | null
  branch: string
  worktreeId: string | null
  worktreePath: string | null
  runtimeEnvironmentId: string | null
  repoConnectionId: string | null
  snapshot: ChecksPanelGitStatusSnapshot | null
  panelContextKey: string
  linkedPR: number | null
  fallbackGitHubPRNumber: number | null
  linkedGitLabMR: number | null
  linkedBitbucketPR: number | null
  linkedAzureDevOpsPR: number | null
  linkedGiteaPR: number | null
}): string {
  if (!input.repo || !input.branch) {
    return ''
  }
  const snapshot = input.snapshot?.contextKey === input.panelContextKey ? input.snapshot : null
  return JSON.stringify({
    repoId: input.repo.id,
    repoPath: input.repo.path,
    worktreeId: input.worktreeId,
    worktreePath: input.worktreePath,
    runtimeEnvironmentId: input.runtimeEnvironmentId,
    connectionId: input.repoConnectionId,
    branch: input.branch,
    base: input.repo.worktreeBaseRef ?? null,
    hasUncommittedChanges: snapshot?.hasUncommittedChanges ?? null,
    hasUpstream: snapshot?.remoteStatus?.hasUpstream ?? null,
    ahead: snapshot?.remoteStatus?.ahead ?? null,
    behind: snapshot?.remoteStatus?.behind ?? null,
    linkedGitHubPR: input.linkedPR,
    fallbackGitHubPR: input.fallbackGitHubPRNumber,
    linkedGitLabMR: input.linkedGitLabMR,
    linkedBitbucketPR: input.linkedBitbucketPR,
    linkedAzureDevOpsPR: input.linkedAzureDevOpsPR,
    linkedGiteaPR: input.linkedGiteaPR
  })
}

export function resolveChecksPanelReviewContext(input: {
  activeWorktree: {
    linkedPR?: number | null
    linkedGitLabMR?: number | null
    linkedBitbucketPR?: number | null
    linkedAzureDevOpsPR?: number | null
    linkedGiteaPR?: number | null
  } | null
  gitStatusInvalidation: GitStatusEntry[] | undefined
  remoteStatusInvalidation: GitUpstreamStatus | undefined
  gitStatusSnapshot: ChecksPanelGitStatusSnapshot | null
  hardRefreshError: { observedAt: number; contextKey: string } | null
  hostedReview: ChecksPanelReview | null
  hostedReviewCreationSnapshot: {
    requestKey: string
    contextKey: string
    data: HostedReviewCreationEligibility
    completedAt: number
    requestStartedAt: number
    gitFingerprint: string
  } | null
  isGitHubReviewContextHint: boolean
  linkedReviewNumber: number | null
  localExecutionScope: string | null
  panelContextKey: string
  repo: { id: string; path: string; worktreeBaseRef?: string | null } | null
  repoConnectionId: string | null
  runtimeEnvironmentId: string | null
  settingsRequestKey: string
  pr: PRInfo | null
  prCachedHasPR: boolean | null
  eligibilityReviewLookupOutcome: HostedReviewCreationEligibility['reviewLookupOutcome'] | null
}): ChecksPanelReviewContext {
  const {
    activeWorktree,
    gitStatusInvalidation,
    remoteStatusInvalidation,
    gitStatusSnapshot,
    hardRefreshError,
    hostedReview,
    hostedReviewCreationSnapshot,
    isGitHubReviewContextHint,
    linkedReviewNumber,
    localExecutionScope,
    panelContextKey,
    repo,
    repoConnectionId,
    runtimeEnvironmentId,
    settingsRequestKey,
    pr,
    prCachedHasPR,
    eligibilityReviewLookupOutcome
  } = input
  const hostedReviewCreationRequestKey = settingsRequestKey
  const gitStatusInputs = readChecksPanelGitStatusSnapshot(gitStatusSnapshot, panelContextKey)
  const gitStatusReadyForPanelContext = gitStatusInputs.hasUncommittedChanges !== undefined
  const hasUncommittedChanges = gitStatusInputs.hasUncommittedChanges
  const remoteStatus = gitStatusInputs.remoteStatus
  const eligibilityHeadOid =
    gitStatusSnapshot?.contextKey === panelContextKey
      ? (gitStatusSnapshot.gitIdentity?.head ?? null)
      : null
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
  const hasNonGitHubLinkedReview =
    activeWorktree?.linkedGitLabMR != null ||
    activeWorktree?.linkedBitbucketPR != null ||
    activeWorktree?.linkedAzureDevOpsPR != null ||
    activeWorktree?.linkedGiteaPR != null
  const isGitHubReviewContext = hostedReviewCreation
    ? hostedReviewCreation.provider === 'github'
    : isGitHubReviewContextHint && !hasNonGitHubLinkedReview
  const hostedReviewCreateCopy = localizedHostedReviewCopy(hostedReviewCreateProvider)
  const prCachedHasPRForContext =
    hostedReviewCreationSnapshot && hostedReviewCreationSnapshot.contextKey !== panelContextKey
      ? null
      : prCachedHasPR
  const checksPanelReviewLookupResult = resolveChecksPanelReviewLookup({
    pr,
    prCachedHasPR: prCachedHasPRForContext,
    hostedReview,
    linkedReviewNumber,
    eligibilityReviewLookupOutcome,
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
    linkedGitHubPR: activeWorktree?.linkedPR ?? null,
    linkedGitLabMR: activeWorktree?.linkedGitLabMR ?? null,
    linkedBitbucketPR: activeWorktree?.linkedBitbucketPR ?? null,
    linkedAzureDevOpsPR: activeWorktree?.linkedAzureDevOpsPR ?? null,
    linkedGiteaPR: activeWorktree?.linkedGiteaPR ?? null,
    eligibilityProvider: hostedReviewCreation?.provider,
    cachedProvider: hostedReview?.provider
  })
  const foregroundReviewEvidenceKey = getChecksPanelForegroundReviewEvidenceKey({
    refreshContextKey: settingsRequestKey,
    reviewEvidenceIdentity: unrenderedReviewEvidenceIdentity,
    reviewEvidenceProvider: unrenderedReviewEvidenceProvider,
    hasUnrenderedReviewEvidence,
    isGitHubReviewContext
  })
  const hardErrorObservedAt =
    isGitHubReviewContext && hardRefreshError?.contextKey === panelContextKey
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
  return {
    hostedReviewCreationRequestKey,
    gitStatusInputs,
    gitStatusReadyForPanelContext,
    hasUncommittedChanges,
    remoteStatus,
    eligibilityHeadOid,
    eligibilityGitFingerprint,
    publishActionGitStatusInputs,
    publishActionHasUncommittedChanges,
    publishActionRemoteStatus,
    hostedReviewCreation,
    hostedReviewCreateProvider,
    hostedReviewCreateCopy,
    hasNonGitHubLinkedReview,
    isGitHubReviewContext,
    prCachedHasPRForContext,
    checksPanelReviewLookup,
    checksPanelReviewLookupResult,
    hasUnrenderedReviewEvidence,
    unrenderedReviewEvidenceIdentity,
    unrenderedReviewEvidenceProvider,
    foregroundReviewEvidenceKey,
    hardErrorObservedAt,
    confirmedReadinessInput,
    confirmedReadiness,
    checksPanelHasHardRefreshError:
      hardErrorObservedAt !== undefined && !isChecksPanelHardErrorCleared(confirmedReadinessInput)
  }
}
