import { useCallback } from 'react'
import { toast } from 'sonner'
import { getCommentBodySubmitState } from '@/lib/comment-body-submit-state'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import type { GitLabItemDialogProps } from './gitlab-item-dialog-contracts'
import type { GitLabItemDialogState } from './gitlab-item-dialog-controller-state'

export function useGitLabItemDialogCommentActions({
  item,
  state
}: {
  item: GitLabItemDialogProps['item']
  state: GitLabItemDialogState
}) {
  const {
    commentDraft,
    details,
    handleRefresh,
    inlineCommentBody,
    inlineCommentFilePath,
    inlineCommentLine,
    itemId,
    mountedRef,
    repoSelector,
    setCommentDraftState,
    setCommentSubmitting,
    setDetails,
    setInlineCommentBody,
    setInlineCommentSubmitting,
    setResolvingThreadId,
    resolvingThreadId
  } = state

  const handleSubmitInlineComment = useCallback(async (): Promise<void> => {
    if (!repoSelector || !item || !details || item.type !== 'mr') return
    const file = (details.files ?? []).find((row) => row.path === inlineCommentFilePath)
    const line = Number.parseInt(inlineCommentLine, 10)
    const bodyState = getCommentBodySubmitState(inlineCommentBody)
    if (!file || !Number.isFinite(line) || line <= 0 || bodyState.status === 'empty') {
      toast.error(translate('auto.components.GitLabItemDialog.00d0d25825', 'File, line, and comment are required.'))
      return
    }
    if (bodyState.status === 'too-large-leading-whitespace') {
      toast.error(translate('auto.components.GitLabItemDialog.commentTooLarge', 'Comment is too large to submit safely.'))
      return
    }
    if (!details.baseSha || !details.startSha || !details.headSha) {
      toast.error(translate('auto.components.GitLabItemDialog.ffdd9a78e1', 'MR diff refs are unavailable for inline comments.'))
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
      if (!mountedRef.current) return
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setDetails((current) => current ? { ...current, comments: [...current.comments, result.comment] } : current)
      setInlineCommentBody('')
      useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
      toast.success(translate('auto.components.GitLabItemDialog.60c13320c4', 'Inline comment added'))
    } finally {
      if (mountedRef.current) setInlineCommentSubmitting(false)
    }
  }, [details, inlineCommentBody, inlineCommentFilePath, inlineCommentLine, item, mountedRef, repoSelector, setDetails, setInlineCommentBody, setInlineCommentSubmitting])

  const handleSubmitComment = useCallback(async (): Promise<void> => {
    const bodyState = getCommentBodySubmitState(commentDraft)
    if (bodyState.status === 'empty' || !item || !repoSelector) return
    if (bodyState.status === 'too-large-leading-whitespace') {
      toast.error(translate('auto.components.GitLabItemDialog.commentTooLarge', 'Comment is too large to submit safely.'))
      return
    }
    setCommentSubmitting(true)
    try {
      const result = item.type === 'mr'
        ? await window.api.gl.addMRComment({ ...repoSelector, iid: item.number, body: bodyState.body })
        : await window.api.gl.addIssueComment({ ...repoSelector, number: item.number, body: bodyState.body })
      if (!mountedRef.current) return
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setCommentDraftState((current) => current.itemId === itemId ? { itemId, value: '' } : current)
      useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
      handleRefresh()
    } finally {
      if (mountedRef.current) setCommentSubmitting(false)
    }
  }, [commentDraft, handleRefresh, item, itemId, mountedRef, repoSelector, setCommentDraftState, setCommentSubmitting])

  const handleResolveDiscussion = useCallback(async (threadId: string, resolved: boolean): Promise<void> => {
    if (!item || !repoSelector || item.type !== 'mr') return
    setResolvingThreadId(threadId)
    try {
      const result = await window.api.gl.resolveMRDiscussion({ ...repoSelector, iid: item.number, discussionId: threadId, resolved })
      if (!mountedRef.current) return
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setDetails((current) => current ? {
        ...current,
        comments: current.comments.map((comment) => comment.threadId === threadId ? { ...comment, isResolved: resolved } : comment)
      } : current)
      useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
    } finally {
      if (mountedRef.current) setResolvingThreadId(null)
    }
  }, [item, mountedRef, repoSelector, setDetails, setResolvingThreadId])

  return { handleResolveDiscussion, handleSubmitComment, handleSubmitInlineComment, resolvingThreadId }
}
