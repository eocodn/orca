/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: GitLab item dialogs reset draft/provider state and hydrate details from GitLab IPC when the selected item identity changes. */
/* Why: GitLab counterpart to GitHubItemDialog. Side sheet with three
   tabs (Description / Conversation / Pipeline) and footer actions —
   close/reopen, merge, and a top-level comment composer. Files /
   inline review-comment positioning / approvals are deferred to v1.5
   since they mirror substantial GitHub-side surface area. */
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useMountedRef } from '@/hooks/useMountedRef'
import {
  getCommentBodySubmitState,
  hasBoundedCommentBodyText
} from '@/lib/comment-body-submit-state'
import { useAppStore } from '@/store'
import type {
  GitLabAssignableUser,
  GitLabPipelineJob,
  GitLabMRUpdate,
  GitLabWorkItemDetails,
  MRComment
} from '../../../shared/types'
import { translate } from '@/i18n/i18n'
import {
  CommentCard,
  PipelineJobRow,
  StateBadge,
  dedupeGitLabUsers,
  formatGitLabLabelDraft,
  normalizeGitLabLabels,
  parseGitLabLabelDraft,
  toggleGitLabLabelDraft
} from './gitlab-item-dialog-content'
import type {
  GitLabDialogRepoSelector,
  GitLabItemDialogProps,
  GitLabJobTraceState
} from './gitlab-item-dialog-contracts'



export default function GitLabItemDialog({
  item,
  repoPath,
  repoId,
  sourceContext,
  onClose,
  onCreateWorkspace
}: GitLabItemDialogProps): React.JSX.Element {
  const [details, setDetails] = useState<GitLabWorkItemDetails | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refreshNonce, setRefreshNonce] = useState(0)
  const itemId = item?.id ?? null
  const [commentDraftState, setCommentDraftState] = useState<{
    itemId: string | null
    value: string
  }>(() => ({ itemId, value: '' }))
  const commentDraft = commentDraftState.itemId === itemId ? commentDraftState.value : ''
  if (commentDraftState.itemId !== itemId) {
    // Why: comment drafts are tied to one GitLab item, so switching the sheet
    // target must not leave a draft that could post to the wrong MR/issue.
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
  const updateCommentDraft = useCallback(
    (value: string): void => {
      setCommentDraftState({ itemId, value })
    },
    [itemId]
  )

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
      .catch((err) => {
        if (!stale) {
          setError(err instanceof Error ? err.message : String(err))
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

  // Why: clear item-scoped dialog state when the sheet target changes. The
  // top-level comment draft is reconciled during render so it cannot flash stale.
  useEffect(() => {
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
    setRefreshNonce((n) => n + 1)
  }, [])

  const loadGitLabLabelOptions = useCallback(async (): Promise<void> => {
    if (!repoSelector || labelOptions !== null || labelOptionsLoading) {
      return
    }
    setLabelOptionsLoading(true)
    try {
      const labels = await window.api.gl.listLabels(repoSelector)
      if (mountedRef.current) {
        setLabelOptions(normalizeGitLabLabels(labels))
      }
    } catch {
      if (mountedRef.current) {
        setLabelOptions([])
      }
    } finally {
      if (mountedRef.current) {
        setLabelOptionsLoading(false)
      }
    }
  }, [labelOptions, labelOptionsLoading, mountedRef, repoSelector])

  const loadGitLabReviewerOptions = useCallback(async (): Promise<void> => {
    if (!repoSelector || reviewerOptions !== null || reviewerOptionsLoading) {
      return
    }
    setReviewerOptionsLoading(true)
    try {
      const users = await window.api.gl.listAssignableUsers(repoSelector)
      if (mountedRef.current) {
        setReviewerOptions(dedupeGitLabUsers(users))
      }
    } catch {
      if (mountedRef.current) {
        setReviewerOptions([])
      }
    } finally {
      if (mountedRef.current) {
        setReviewerOptionsLoading(false)
      }
    }
  }, [mountedRef, repoSelector, reviewerOptions, reviewerOptionsLoading])

  const handleStartDetailsEdit = useCallback((): void => {
    if (!item || !details || item.type !== 'mr') {
      return
    }
    setTitleDraft(details.item.title || item.title)
    setBodyDraft(details.body)
    setLabelDraft(formatGitLabLabelDraft(details.item.labels ?? item.labels))
    setEditingDetails(true)
    void loadGitLabLabelOptions()
  }, [details, item, loadGitLabLabelOptions])

  const handleCancelDetailsEdit = useCallback((): void => {
    setEditingDetails(false)
    setTitleDraft('')
    setBodyDraft('')
    setLabelDraft('')
  }, [])

  const handleSaveDetails = useCallback(async (): Promise<void> => {
    if (!item || !details || !repoSelector || item.type !== 'mr') {
      return
    }
    const currentTitle = details.item.title || item.title
    const currentBody = details.body
    const currentLabels = normalizeGitLabLabels(details.item.labels ?? item.labels)
    const nextTitle = titleDraft.trim()
    const nextBody = bodyDraft
    const nextLabels = parseGitLabLabelDraft(labelDraft)
    if (!nextTitle) {
      toast.error(translate('auto.components.GitLabItemDialog.98718490e4', 'MR title is required.'))
      return
    }

    const currentLabelKeys = new Set(currentLabels.map((label) => label.toLowerCase()))
    const nextLabelKeys = new Set(nextLabels.map((label) => label.toLowerCase()))
    const addLabels = nextLabels.filter((label) => !currentLabelKeys.has(label.toLowerCase()))
    const removeLabels = currentLabels.filter((label) => !nextLabelKeys.has(label.toLowerCase()))
    const updates: GitLabMRUpdate = {}
    if (nextTitle !== currentTitle) {
      updates.title = nextTitle
    }
    if (nextBody !== currentBody) {
      updates.body = nextBody
    }
    if (addLabels.length > 0) {
      updates.addLabels = addLabels
    }
    if (removeLabels.length > 0) {
      updates.removeLabels = removeLabels
    }
    if (Object.keys(updates).length === 0) {
      handleCancelDetailsEdit()
      return
    }

    setDetailsSaving(true)
    try {
      const res = await window.api.gl.updateMR({ ...repoSelector, iid: item.number, updates })
      if (res.ok) {
        if (mountedRef.current) {
          setDetails((current) =>
            current
              ? {
                  ...current,
                  body: nextBody,
                  item: { ...current.item, title: nextTitle, labels: nextLabels }
                }
              : current
          )
          setLabelOptions((current) =>
            current ? normalizeGitLabLabels([...current, ...nextLabels]) : current
          )
          setEditingDetails(false)
          setTitleDraft('')
          setBodyDraft('')
          setLabelDraft('')
          useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
        }
      } else if (mountedRef.current) {
        toast.error(res.error)
      }
    } finally {
      if (mountedRef.current) {
        setDetailsSaving(false)
      }
    }
  }, [
    bodyDraft,
    details,
    handleCancelDetailsEdit,
    item,
    labelDraft,
    mountedRef,
    repoSelector,
    titleDraft
  ])

  const handleToggleJobTrace = useCallback(
    async (job: GitLabPipelineJob): Promise<void> => {
      if (expandedJobId === job.id) {
        setExpandedJobId(null)
        return
      }
      setExpandedJobId(job.id)
      if (!repoSelector || !item || jobTraceById[job.id]?.trace || jobTraceById[job.id]?.error) {
        return
      }
      setJobTraceById((current) => ({
        ...current,
        [job.id]: { loading: true }
      }))
      try {
        const result = await window.api.gl.jobTrace({
          ...repoSelector,
          jobId: job.id,
          projectRef: details?.item.projectRef ?? item.projectRef ?? null
        })
        if (!mountedRef.current) {
          return
        }
        setJobTraceById((current) => ({
          ...current,
          [job.id]: result.ok
            ? { loading: false, trace: result.trace }
            : { loading: false, error: result.error }
        }))
      } catch (error) {
        if (mountedRef.current) {
          setJobTraceById((current) => ({
            ...current,
            [job.id]: {
              loading: false,
              error: error instanceof Error ? error.message : String(error)
            }
          }))
        }
      }
    },
    [details?.item.projectRef, expandedJobId, item, jobTraceById, mountedRef, repoSelector]
  )

  const handleRetryJob = useCallback(
    async (job: GitLabPipelineJob): Promise<void> => {
      if (!repoSelector || !item) {
        return
      }
      setRetryingJobId(job.id)
      try {
        const result = await window.api.gl.retryJob({
          ...repoSelector,
          jobId: job.id,
          projectRef: details?.item.projectRef ?? item.projectRef ?? null
        })
        if (!mountedRef.current) {
          return
        }
        if (result.ok) {
          toast.success(
            translate('auto.components.GitLabItemDialog.f7cb495a12', 'Retried {{value0}}', {
              value0: job.name
            })
          )
          if (result.job) {
            setDetails((current) =>
              current
                ? {
                    ...current,
                    pipelineJobs: (current.pipelineJobs ?? []).map((existing) =>
                      existing.id === job.id ? result.job! : existing
                    )
                  }
                : current
            )
          }
          handleRefresh()
        } else {
          toast.error(result.error)
        }
      } finally {
        if (mountedRef.current) {
          setRetryingJobId(null)
        }
      }
    },
    [details?.item.projectRef, handleRefresh, item, mountedRef, repoSelector]
  )

  const handleSetReviewers = useCallback(
    async (nextReviewers: GitLabAssignableUser[]): Promise<void> => {
      if (!repoSelector || !item || !details || item.type !== 'mr') {
        return
      }
      const reviewerIds = nextReviewers
        .map((reviewer) => reviewer.id)
        .filter((id): id is number => typeof id === 'number')
      if (reviewerIds.length !== nextReviewers.length) {
        toast.error(
          translate(
            'auto.components.GitLabItemDialog.ceaf7c30c7',
            'Reviewer id is unavailable for this GitLab user.'
          )
        )
        return
      }
      setReviewerUpdating(true)
      try {
        const result = await window.api.gl.updateMRReviewers({
          ...repoSelector,
          iid: item.number,
          reviewerIds,
          projectRef: details.item.projectRef ?? item.projectRef ?? null
        })
        if (!mountedRef.current) {
          return
        }
        if (result.ok) {
          setDetails((current) =>
            current ? { ...current, reviewers: dedupeGitLabUsers(result.reviewers) } : current
          )
          setReviewerDraftId('')
          setReviewerOptions((current) =>
            current ? dedupeGitLabUsers([...current, ...result.reviewers]) : current
          )
          useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
        } else {
          toast.error(result.error)
        }
      } finally {
        if (mountedRef.current) {
          setReviewerUpdating(false)
        }
      }
    },
    [details, item, mountedRef, repoSelector]
  )

  const handleSubmitInlineComment = useCallback(async (): Promise<void> => {
    if (!repoSelector || !item || !details || item.type !== 'mr') {
      return
    }
    const file = (details.files ?? []).find((row) => row.path === inlineCommentFilePath)
    const line = Number.parseInt(inlineCommentLine, 10)
    const bodyState = getCommentBodySubmitState(inlineCommentBody)
    if (!file || !Number.isFinite(line) || line <= 0 || bodyState.status === 'empty') {
      toast.error(
        translate(
          'auto.components.GitLabItemDialog.00d0d25825',
          'File, line, and comment are required.'
        )
      )
      return
    }
    if (bodyState.status === 'too-large-leading-whitespace') {
      toast.error(
        translate(
          'auto.components.GitLabItemDialog.commentTooLarge',
          'Comment is too large to submit safely.'
        )
      )
      return
    }
    if (!details.baseSha || !details.startSha || !details.headSha) {
      toast.error(
        translate(
          'auto.components.GitLabItemDialog.ffdd9a78e1',
          'MR diff refs are unavailable for inline comments.'
        )
      )
      return
    }
    setInlineCommentSubmitting(true)
    try {
      const result = await window.api.gl.addMRInlineComment({
        ...repoSelector,
        iid: item.number,
        projectRef: details.item.projectRef ?? item.projectRef ?? null,
        input: {
          body: bodyState.body,
          path: file.path,
          ...(file.oldPath ? { oldPath: file.oldPath } : {}),
          line,
          baseSha: details.baseSha,
          startSha: details.startSha,
          headSha: details.headSha
        }
      })
      if (!mountedRef.current) {
        return
      }
      if (result.ok) {
        setDetails((current) =>
          current ? { ...current, comments: [...current.comments, result.comment] } : current
        )
        setInlineCommentBody('')
        useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
        toast.success(
          translate('auto.components.GitLabItemDialog.60c13320c4', 'Inline comment added')
        )
      } else {
        toast.error(result.error)
      }
    } finally {
      if (mountedRef.current) {
        setInlineCommentSubmitting(false)
      }
    }
  }, [
    details,
    inlineCommentBody,
    inlineCommentFilePath,
    inlineCommentLine,
    item,
    mountedRef,
    repoSelector
  ])

  const handleClose = useCallback(async (): Promise<void> => {
    if (!item || !repoSelector || item.type !== 'mr') {
      return
    }
    setActionInFlight('close')
    try {
      const res = await window.api.gl.closeMR({ ...repoSelector, iid: item.number })
      if (res.ok) {
        if (mountedRef.current) {
          useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
          toast.success(
            translate('auto.components.GitLabItemDialog.9b11cd233f', 'Closed MR !{{value0}}', {
              value0: item.number
            })
          )
          handleRefresh()
        }
      } else {
        if (mountedRef.current) {
          toast.error(res.error)
        }
      }
    } finally {
      if (mountedRef.current) {
        setActionInFlight(null)
      }
    }
  }, [item, repoSelector, mountedRef, handleRefresh])

  const handleReopen = useCallback(async (): Promise<void> => {
    if (!item || !repoSelector || item.type !== 'mr') {
      return
    }
    setActionInFlight('reopen')
    try {
      const res = await window.api.gl.reopenMR({ ...repoSelector, iid: item.number })
      if (res.ok) {
        if (mountedRef.current) {
          useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
          toast.success(
            translate('auto.components.GitLabItemDialog.865ea2703e', 'Reopened MR !{{value0}}', {
              value0: item.number
            })
          )
          handleRefresh()
        }
      } else {
        if (mountedRef.current) {
          toast.error(res.error)
        }
      }
    } finally {
      if (mountedRef.current) {
        setActionInFlight(null)
      }
    }
  }, [item, repoSelector, mountedRef, handleRefresh])

  const handleMerge = useCallback(async (): Promise<void> => {
    if (!item || !repoSelector || item.type !== 'mr') {
      return
    }
    setActionInFlight('merge')
    try {
      const res = await window.api.gl.mergeMR({ ...repoSelector, iid: item.number })
      if (res.ok) {
        if (mountedRef.current) {
          useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
          toast.success(
            translate('auto.components.GitLabItemDialog.e089f62594', 'Merged MR !{{value0}}', {
              value0: item.number
            })
          )
          handleRefresh()
        }
      } else {
        if (mountedRef.current) {
          toast.error(res.error)
        }
      }
    } finally {
      if (mountedRef.current) {
        setActionInFlight(null)
      }
    }
  }, [item, repoSelector, mountedRef, handleRefresh])

  const handleSubmitComment = useCallback(async (): Promise<void> => {
    const bodyState = getCommentBodySubmitState(commentDraft)
    if (bodyState.status === 'empty' || !item || !repoSelector) {
      return
    }
    if (bodyState.status === 'too-large-leading-whitespace') {
      toast.error(
        translate(
          'auto.components.GitLabItemDialog.commentTooLarge',
          'Comment is too large to submit safely.'
        )
      )
      return
    }
    setCommentSubmitting(true)
    try {
      // Why: the IPC for issue comments takes `number`, MR takes `iid`.
      // Branch on the item type to hit the right channel.
      const res =
        item.type === 'mr'
          ? await window.api.gl.addMRComment({
              ...repoSelector,
              iid: item.number,
              body: bodyState.body
            })
          : await window.api.gl.addIssueComment({
              ...repoSelector,
              number: item.number,
              body: bodyState.body
            })
      if (res.ok) {
        if (mountedRef.current) {
          setCommentDraftState((current) =>
            current.itemId === itemId ? { itemId, value: '' } : current
          )
          useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
          handleRefresh()
        }
      } else {
        if (mountedRef.current) {
          toast.error(res.error)
        }
      }
    } finally {
      if (mountedRef.current) {
        setCommentSubmitting(false)
      }
    }
  }, [commentDraft, item, itemId, repoSelector, mountedRef, handleRefresh])
  const canSubmitInlineComment = hasBoundedCommentBodyText(inlineCommentBody)
  const canSubmitComment = hasBoundedCommentBodyText(commentDraft)

  const handleResolveDiscussion = useCallback(
    async (threadId: string, resolved: boolean): Promise<void> => {
      if (!item || !repoSelector || item.type !== 'mr') {
        return
      }
      setResolvingThreadId(threadId)
      try {
        const res = await window.api.gl.resolveMRDiscussion({
          ...repoSelector,
          iid: item.number,
          discussionId: threadId,
          resolved
