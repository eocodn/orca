/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Item-scoped drafts reset with the selected GitLab work item. */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useMountedRef } from '@/hooks/useMountedRef'
import type {
  GitLabAssignableUser,
  GitLabWorkItemDetails
} from '../../../shared/types'
import type {
  GitLabDialogRepoSelector,
  GitLabItemDialogProps,
  GitLabJobTraceState
} from './gitlab-item-dialog-contracts'

export function useGitLabItemDialogState({
  item,
  repoPath,
  repoId,
  sourceContext
}: Pick<GitLabItemDialogProps, 'item' | 'repoPath' | 'repoId' | 'sourceContext'>) {
  const [details, setDetails] = useState<GitLabWorkItemDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const itemId = item?.id ?? null
  const [commentDraftState, setCommentDraftState] = useState({
    itemId,
    value: ''
  })
  const commentDraft = commentDraftState.itemId === itemId ? commentDraftState.value : ''
  if (commentDraftState.itemId !== itemId) {
    setCommentDraftState({ itemId, value: '' })
  }
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [resolvingThreadId, setResolvingThreadId] = useState<string | null>(null)
  const [editingDetails, setEditingDetails] = useState(false)
  const [titleDraft, setTitleDraft] = useState('')
  const [bodyDraft, setBodyDraft] = useState('')
  const [labelDraft, setLabelDraft] = useState('')
  const [labelOptions, setLabelOptions] = useState<string[] | null>(null)
  const [labelOptionsLoading, setLabelOptionsLoading] = useState(false)
  const [detailsSaving, setDetailsSaving] = useState(false)
  const [reviewerOptions, setReviewerOptions] = useState<GitLabAssignableUser[] | null>(null)
  const [reviewerOptionsLoading, setReviewerOptionsLoading] = useState(false)
  const [reviewerUpdating, setReviewerUpdating] = useState(false)
  const [reviewerDraftId, setReviewerDraftId] = useState('')
  const [inlineCommentFilePath, setInlineCommentFilePath] = useState('')
  const [inlineCommentLine, setInlineCommentLine] = useState('')
  const [inlineCommentBody, setInlineCommentBody] = useState('')
  const [inlineCommentSubmitting, setInlineCommentSubmitting] = useState(false)
  const [expandedJobId, setExpandedJobId] = useState<number | null>(null)
  const [jobTraceById, setJobTraceById] = useState<Record<number, GitLabJobTraceState>>({})
  const [retryingJobId, setRetryingJobId] = useState<number | null>(null)
  const [actionInFlight, setActionInFlight] = useState<'close' | 'reopen' | 'merge' | null>(null)
  const mountedRef = useMountedRef()
  const repoSelector = useMemo<GitLabDialogRepoSelector | null>(() => {
    if (!repoPath) {
      return null
    }
    return {
      repoPath,
      ...(repoId ? { repoId } : {}),
      ...(sourceContext ? { sourceContext } : {})
    }
  }, [repoId, repoPath, sourceContext])

  useEffect(() => {
    if (!item || !repoSelector) {
      setDetails(null)
      setLoading(false)
      setError(null)
      setEditingDetails(false)
      return
    }
    let stale = false
    setLoading(true)
    setError(null)
    void window.api.gl
      .workItemDetails({ ...repoSelector, iid: item.number, type: item.type })
      .then((data) => {
        if (stale) {
          return
        }
        if (!data) {
          setError('Item not found.')
          return
        }
        setDetails(data as GitLabWorkItemDetails)
      })
      .catch((reason) => {
        if (!stale) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => {
        if (!stale) {
          setLoading(false)
        }
      })
    return () => {
      stale = true
    }
  }, [item, repoSelector, refreshNonce])

  useEffect(() => {
    setDetails(null)
    setError(null)
    setEditingDetails(false)
    setTitleDraft('')
    setBodyDraft('')
    setLabelDraft('')
    setLabelOptions(null)
    setLabelOptionsLoading(false)
    setReviewerOptions(null)
    setReviewerOptionsLoading(false)
    setReviewerUpdating(false)
    setReviewerDraftId('')
    setInlineCommentFilePath('')
    setInlineCommentLine('')
    setInlineCommentBody('')
    setInlineCommentSubmitting(false)
    setExpandedJobId(null)
    setJobTraceById({})
    setRetryingJobId(null)
  }, [item?.id])

  const handleRefresh = useCallback(() => {
    setRefreshNonce((current) => current + 1)
  }, [])

  return {
    actionInFlight,
    bodyDraft,
    commentDraft,
    commentDraftState,
    commentSubmitting,
    details,
    detailsSaving,
    editingDetails,
    error,
    expandedJobId,
    handleRefresh,
    inlineCommentBody,
    inlineCommentFilePath,
    inlineCommentLine,
    inlineCommentSubmitting,
    itemId,
    jobTraceById,
    labelDraft,
    labelOptions,
    labelOptionsLoading,
    loading,
    mountedRef,
    repoSelector,
    refreshNonce,
    resolvingThreadId,
    retryingJobId,
    reviewerDraftId,
    reviewerOptions,
    reviewerOptionsLoading,
    reviewerUpdating,
    setActionInFlight,
    setBodyDraft,
    setCommentDraftState,
    setCommentSubmitting,
    setDetails,
    setDetailsSaving,
    setEditingDetails,
    setError,
    setExpandedJobId,
    setInlineCommentBody,
    setInlineCommentFilePath,
    setInlineCommentLine,
    setInlineCommentSubmitting,
    setJobTraceById,
    setLabelDraft,
    setLabelOptions,
    setLabelOptionsLoading,
    setLoading,
    setRefreshNonce,
    setResolvingThreadId,
    setRetryingJobId,
    setReviewerDraftId,
    setReviewerOptions,
    setReviewerOptionsLoading,
    setReviewerUpdating,
    setTitleDraft,
    titleDraft,
    updateCommentDraft: useCallback(
      (value: string) => setCommentDraftState({ itemId, value }),
      [itemId]
    )
  }
}

export type GitLabItemDialogState = ReturnType<typeof useGitLabItemDialogState>
