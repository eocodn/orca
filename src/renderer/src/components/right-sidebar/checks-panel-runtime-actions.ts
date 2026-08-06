import type React from 'react'
import type { PRComment } from '../../../../shared/types'
import type { HostedReviewProvider } from '../../../../shared/hosted-review'
import type { PRCommentGroup } from '@/lib/pr-comment-groups'
import { useChecksPanelCommentActions } from './checks-panel-comment-actions-controller'
import { useChecksPanelAiActions } from './checks-panel-ai-actions-controller'
import { useChecksPanelFixChecks } from './checks-panel-ai-fix-controller'
import { useChecksPanelLinkActions } from './checks-panel-link-actions'
import { useChecksPanelCreateAction } from './checks-panel-create-action'

export type ChecksPanelRuntimeActionsInput = {
  comments: Parameters<typeof useChecksPanelCommentActions>[0]
  ai: Omit<Parameters<typeof useChecksPanelAiActions>[0], 'handleResolve'>
  fixChecks: Parameters<typeof useChecksPanelFixChecks>[0]
  links: Parameters<typeof useChecksPanelLinkActions>[0]
  create: Parameters<typeof useChecksPanelCreateAction>[0]
}

export type ChecksPanelRuntimeActions = {
  handleStartEdit: () => void
  handleCancelEdit: () => void
  handleSaveTitle: () => Promise<void>
  handleTitleKeyDown: (event: React.KeyboardEvent) => void
  handleResolve: (
    threadId: string,
    resolve: boolean,
    options?: { notifyOnFailure?: boolean }
  ) => Promise<boolean>
  handleAddPRComment: (body: string) => Promise<{ ok: boolean; error?: string }>
  handleEditComment: (comment: PRComment, body: string) => Promise<boolean>
  handleDeleteComment: (comment: PRComment) => Promise<void>
  handleReplyToComment: (
    comment: PRComment,
    body: string
  ) => Promise<{ ok: boolean; error?: string }>
  handleResolveConflictsWithAI: () => Promise<void>
  handleResolveCommentsWithAI: (groups: PRCommentGroup[]) => void
  handleFixChecksWithAI: () => Promise<void>
  handleOpenPR: (event: React.MouseEvent<HTMLButtonElement>) => void
  handleUnlinkPullRequest: () => void
  handleLinkAnotherPullRequest: () => void
  pushBeforeCreatePullRequest: () => Promise<boolean>
  handlePublishBranch: () => Promise<void>
  handleSyncBranch: () => Promise<void>
  handlePullRequestCreated: (result: {
    provider: HostedReviewProvider
    number: number
    url: string
  }) => Promise<void>
  handleCreatePullRequest: () => Promise<void>
  canTargetPRComments: boolean
  commentsDisabledReason: string | undefined
  clearSentCommentSelection: (reviewContextKey: string) => void
  refreshCommentsAfterBulkResolve: (provider: 'github' | 'gitlab') => Promise<void>
  resolveSelectedThreadsAfterLaunch: (resolution: {
    reviewContextKey: string
    provider: 'github' | 'gitlab'
    selectedThreadIds: string[]
    selectedGroups: PRCommentGroup[]
  }) => Promise<void>
}

export function useChecksPanelRuntimeActions(
  args: ChecksPanelRuntimeActionsInput
): ChecksPanelRuntimeActions {
  const comments = useChecksPanelCommentActions(args.comments) as Omit<
    ChecksPanelRuntimeActions,
    | 'handleResolveConflictsWithAI'
    | 'handleResolveCommentsWithAI'
    | 'handleFixChecksWithAI'
    | 'handleOpenPR'
    | 'handleUnlinkPullRequest'
    | 'handleLinkAnotherPullRequest'
    | 'pushBeforeCreatePullRequest'
    | 'handlePublishBranch'
    | 'handleSyncBranch'
    | 'handlePullRequestCreated'
    | 'handleCreatePullRequest'
    | 'canTargetPRComments'
    | 'commentsDisabledReason'
    | 'clearSentCommentSelection'
    | 'refreshCommentsAfterBulkResolve'
    | 'resolveSelectedThreadsAfterLaunch'
  > &
    Pick<ChecksPanelRuntimeActions, 'canTargetPRComments' | 'commentsDisabledReason'>
  const ai = useChecksPanelAiActions({ ...args.ai, handleResolve: comments.handleResolve }) as Pick<
    ChecksPanelRuntimeActions,
    | 'handleResolveConflictsWithAI'
    | 'handleResolveCommentsWithAI'
    | 'clearSentCommentSelection'
    | 'refreshCommentsAfterBulkResolve'
    | 'resolveSelectedThreadsAfterLaunch'
  >
  const handleFixChecksWithAI = useChecksPanelFixChecks(args.fixChecks) as () => Promise<void>
  const links = useChecksPanelLinkActions(args.links) as Pick<
    ChecksPanelRuntimeActions,
    | 'handleOpenPR'
    | 'handleUnlinkPullRequest'
    | 'handleLinkAnotherPullRequest'
    | 'pushBeforeCreatePullRequest'
    | 'handlePublishBranch'
    | 'handleSyncBranch'
    | 'handlePullRequestCreated'
  >
  const handleCreatePullRequest = useChecksPanelCreateAction(args.create) as () => Promise<void>
  return { ...comments, ...ai, handleFixChecksWithAI, ...links, handleCreatePullRequest }
}
