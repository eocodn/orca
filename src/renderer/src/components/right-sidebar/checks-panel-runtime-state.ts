import { useRef, useState } from 'react'
import type { PRCheckDetail, PRComment } from '../../../../shared/types'
import type { PRCommentsListSelectionClearRequest } from './pr-comments-list-selection'
import type { HostedReviewCreationEligibility } from '../../../../shared/hosted-review'
import type { PRRefreshErrorType } from '../../../../shared/types'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import { useMountedRef } from '@/hooks/useMountedRef'
import type { ChecksPanelReview } from './checks-panel-review'
import type { ChecksPanelGitStatusSnapshot } from './checks-panel-git-status-snapshot'
import type { PRCommentGroup } from '@/lib/pr-comment-groups'
import type { SourceControlLaunchActionId } from '../../../../shared/source-control-ai-actions'

export type ChecksAgentComposerState = {
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

export function useChecksPanelRuntimeState() {
  const [checks, setChecks] = useState<PRCheckDetail[]>([])
  const [checksLoading, setChecksLoading] = useState(false)
  const [comments, setComments] = useState<PRComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const commentsRef = useRef<PRComment[]>([])
  const [commentsSelectionClearRequest, setCommentsSelectionClearRequest] = useState<{
    token: number
    request: PRCommentsListSelectionClearRequest
  } | null>(null)
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
  const [isFixingChecksWithAI, setIsFixingChecksWithAI] = useState(false)
  const [agentComposerState, setAgentComposerState] = useState<ChecksAgentComposerState | null>(
    null
  )
  const [hostedReviewCreationSnapshot, setHostedReviewCreationSnapshot] = useState<{
    requestKey: string
    contextKey: string
    repoId: string
    worktreeId: string | null
    branch: string
    requestStartedAt: number
    completedAt: number
    gitFingerprint: string
    data: HostedReviewCreationEligibility
  } | null>(null)
  const [hardRefreshError, setHardRefreshError] = useState<{
    observedAt: number
    errorType: PRRefreshErrorType
    contextKey: string
  } | null>(null)
  const [gitStatusSnapshot, setGitStatusSnapshot] = useState<ChecksPanelGitStatusSnapshot | null>(
    null
  )
  const [gitStatusProbeErrorContextKey, setGitStatusProbeErrorContextKey] = useState<string | null>(
    null
  )
  const [gitStatusRefreshNonce, setGitStatusRefreshNonce] = useState(0)
  const [eligibilityRefreshNonce, setEligibilityRefreshNonce] = useState(0)
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [titleSaving, setTitleSaving] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const titleInputFocusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollIntervalRef = useRef(30_000)
  const mountedRef = useMountedRef()
  const confirm = useConfirmationDialog()
  const prevChecksRef = useRef<string>('')
  const conflictSummaryRefreshKeyRef = useRef<string | null>(null)
  const panelVisibleSinceRef = useRef<number | null>(null)
  const foregroundedUnrenderedReviewKeyRef = useRef<string | null>(null)

  return {
    checks,
    setChecks,
    checksLoading,
    setChecksLoading,
    comments,
    setComments,
    commentsLoading,
    setCommentsLoading,
    commentsRef,
    commentsSelectionClearRequest,
    setCommentsSelectionClearRequest,
    commentsSelectionClearTokenRef,
    emptyRefreshing,
    setEmptyRefreshing,
    isRefreshing,
    setIsRefreshing,
    refreshInFlightRef,
    conflictDetailsRefreshing,
    setConflictDetailsRefreshing,
    createPrInFlightRef,
    isCreatingPr,
    setIsCreatingPr,
    createPrError,
    setCreatePrError,
    isPublishingBranch,
    setIsPublishingBranch,
    isSyncingBranch,
    setIsSyncingBranch,
    isFixingChecksWithAI,
    setIsFixingChecksWithAI,
    agentComposerState,
    setAgentComposerState,
    hostedReviewCreationSnapshot,
    setHostedReviewCreationSnapshot,
    hardRefreshError,
    setHardRefreshError,
    gitStatusSnapshot,
    setGitStatusSnapshot,
    gitStatusProbeErrorContextKey,
    setGitStatusProbeErrorContextKey,
    gitStatusRefreshNonce,
    setGitStatusRefreshNonce,
    eligibilityRefreshNonce,
    setEligibilityRefreshNonce,
    editingTitle,
    setEditingTitle,
    titleDraft,
    setTitleDraft,
    titleSaving,
    setTitleSaving,
    titleInputRef,
    titleInputFocusTimerRef,
    pollIntervalRef,
    mountedRef,
    confirm,
    prevChecksRef,
    conflictSummaryRefreshKeyRef,
    panelVisibleSinceRef,
    foregroundedUnrenderedReviewKeyRef
  }
}
