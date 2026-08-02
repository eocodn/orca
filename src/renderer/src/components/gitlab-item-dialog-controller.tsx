/* Public GitLab dialog controller facade; state and actions live in concrete modules. */
import React from 'react'
import { CircleDot, GitMerge } from 'lucide-react'
import { getCommentBodySubmitState, hasBoundedCommentBodyText } from '@/lib/comment-body-submit-state'
import {
  dedupeGitLabUsers,
  gitLabUserKey,
  normalizeGitLabLabels,
  parseGitLabLabelDraft
} from './gitlab-item-dialog-content'
import { useGitLabItemDialogCommentActions } from './gitlab-item-dialog-comment-actions'
import { useGitLabItemDialogDetailsActions } from './gitlab-item-dialog-details-actions'
import { useGitLabItemDialogMrActions } from './gitlab-item-dialog-mr-actions'
import { useGitLabItemDialogPipelineActions } from './gitlab-item-dialog-pipeline-actions'
import { useGitLabItemDialogState } from './gitlab-item-dialog-controller-state'
import { GitLabItemDialogView } from './gitlab-item-dialog-view'
import type { GitLabItemDialogProps } from './gitlab-item-dialog-contracts'

export default function GitLabItemDialog(props: GitLabItemDialogProps): React.JSX.Element {
  const { item, repoPath, repoId, sourceContext, onClose, onCreateWorkspace } = props
  const state = useGitLabItemDialogState({ item, repoPath, repoId, sourceContext })
  const detailsActions = useGitLabItemDialogDetailsActions({ item, state })
  const pipelineActions = useGitLabItemDialogPipelineActions({ item, state })
  const commentActions = useGitLabItemDialogCommentActions({ item, state })
  const mrActions = useGitLabItemDialogMrActions({ item, state })
  const isMR = item?.type === 'mr'
  const prefix = isMR ? '!' : '#'
  const visibleTitle = state.details?.item.title || item?.title || ''
  const visibleLabels = normalizeGitLabLabels(state.details?.item.labels ?? item?.labels ?? [])
  const labelSuggestionOptions = normalizeGitLabLabels([
    ...(state.labelOptions ?? []),
    ...visibleLabels,
    ...parseGitLabLabelDraft(state.labelDraft)
  ])
  const currentReviewers = dedupeGitLabUsers(state.details?.reviewers ?? [])
  const currentReviewerKeys = new Set(currentReviewers.map(gitLabUserKey))
  const reviewerOptionRows = dedupeGitLabUsers([
    ...(state.reviewerOptions ?? []),
    ...currentReviewers
  ]).filter((user) => !currentReviewerKeys.has(gitLabUserKey(user)))
  const commentBodyState = getCommentBodySubmitState(state.commentDraft)
  const inlineCommentBodyState = getCommentBodySubmitState(state.inlineCommentBody)
  const context = {
    ...state,
    ...detailsActions,
    ...pipelineActions,
    ...commentActions,
    ...mrActions,
    Icon: isMR ? GitMerge : CircleDot,
    approvalState: state.details?.approvalState,
    canClose: isMR && item?.state === 'opened',
    canMerge: isMR && item?.state === 'opened',
    canReopen: isMR && item?.state === 'closed',
    canSubmitComment: hasBoundedCommentBodyText(state.commentDraft),
    canSubmitInlineComment: hasBoundedCommentBodyText(state.inlineCommentBody),
    commentBodyState,
    currentReviewerKeys,
    currentReviewers,
    inlineCommentBodyState,
    isMR,
    item,
    itemId: state.itemId,
    labelSuggestionOptions,
    onClose,
    onCreateWorkspace,
    prefix,
    repoId,
    repoPath,
    sourceContext,
    reviewerOptionRows,
    visibleLabels,
    visibleTitle
  }
  return <GitLabItemDialogView context={context} />
}
