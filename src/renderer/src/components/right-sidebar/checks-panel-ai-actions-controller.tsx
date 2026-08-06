import type { ChecksPanelAiKey } from './checks-panel-ai-actions-types'
/* AI actions for ChecksPanel comments and checks. */
import { useCallback } from 'react'
import { toast } from 'sonner'
import { buildResolvePullRequestConflictsPrompt } from './SourceControl'
import { buildPRCommentsResolutionPrompt, isResolvablePRCommentGroup } from '../pr-comments-resolution-prompt'
import { groupPRComments, type PRCommentGroup } from '@/lib/pr-comment-groups'
import { translate } from '@/i18n/i18n'
import type { ChecksPanelReview } from './checks-panel-review'

type CommentResolution = { reviewContextKey: string; provider: 'github' | 'gitlab'; selectedThreadIds: string[]; selectedGroups: PRCommentGroup[] }
export function useChecksPanelAiActions<T extends Record<string, unknown>>(context: T & { [K in ChecksPanelAiKey]: K extends keyof T ? T[K] : never }): Record<string, unknown> {
  const {
    activeConflictReview,
    activeReview,
    activeWorktreeId,
    activeWorktreePath,
    asyncResultKeyRef,
    commentsRef,
    commentsSelectionClearTokenRef,
    fetchComments,
    fetchGitLabDetails,
    handleResolve,
    repo,
    resolveCommentsWithAIDisabledReason,
    setAgentComposerState,
    setCommentsSelectionClearRequest,
    sourceControlAiActionsVisible,
    stateRequestKey,
  } = context

const handleResolveConflictsWithAI = useCallback(async (): Promise<void> => {
  if (!sourceControlAiActionsVisible || !activeWorktreeId || !activeConflictReview) {
    return
  }
  const conflictFiles = activeConflictReview.conflictSummary?.files ?? []
  setAgentComposerState({
    actionId: 'resolveConflicts',
    title: translate(
      'auto.components.right.sidebar.ChecksPanel.4ede779461',
      'Resolve Review Conflicts With AI'
    ),
    description: translate(
      'auto.components.right.sidebar.ChecksPanel.abf59262fb',
      'Review and edit the full command input before starting an agent.'
    ),
    prompt: buildResolvePullRequestConflictsPrompt({
      reviewKind: activeConflictReview.provider === 'gitlab' ? 'MR' : 'PR',
      baseRef: activeConflictReview.conflictSummary?.baseRef,
      entries: conflictFiles.map((path) => ({ path })),
      worktreePath: activeWorktreePath ?? null
    }),
    launchSource: 'conflict_resolution'
  })
}, [activeConflictReview, activeWorktreeId, activeWorktreePath, sourceControlAiActionsVisible])

const handleResolveCommentsWithAI = useCallback(
  (selectedGroups: PRCommentGroup[]): void => {
    if (
      !sourceControlAiActionsVisible ||
      !activeWorktreeId ||
      !activeReview ||
      !repo ||
      resolveCommentsWithAIDisabledReason
    ) {
      return
    }
    const selectedThreadIds = selectedGroups.flatMap((group) =>
      group.kind === 'thread' && isResolvablePRCommentGroup(group) ? [group.threadId] : []
    )
    if (selectedGroups.length === 0) {
      toast.message(
        translate(
          'auto.components.right.sidebar.ChecksPanel.f316a8ca2b',
          'No unresolved comments selected.'
        )
      )
      return
    }
    setAgentComposerState({
      actionId: 'resolveComments',
      title: translate(
        'auto.components.right.sidebar.ChecksPanel.d00ebdc402',
        'Resolve {{value0}} Comments With AI',
        { value0: activeReview.provider === 'gitlab' ? 'MR' : 'PR' }
      ),
      description: translate(
        'auto.components.right.sidebar.ChecksPanel.ed3f79c031',
        'Review the prompt before starting an agent. Selected threads are marked resolved after launch.'
      ),
      prompt: buildPRCommentsResolutionPrompt({
        reviewKind: activeReview.provider === 'gitlab' ? 'MR' : 'PR',
        reviewNumber: activeReview.number,
        reviewTitle: activeReview.title,
        reviewUrl: activeReview.url,
        groups: selectedGroups,
        worktreePath: activeWorktreePath
      }),
      launchSource: 'task_page',
      commentResolution: {
        reviewContextKey: stateRequestKey,
        provider: activeReview.provider,
        selectedThreadIds,
        selectedGroups
      }
    })
  },
  [
    activeReview,
    activeWorktreeId,
    activeWorktreePath,
    repo,
    resolveCommentsWithAIDisabledReason,
    sourceControlAiActionsVisible,
    stateRequestKey
  ]
)

const clearSentCommentSelection = useCallback((reviewContextKey: string): void => {
  clearPRCommentsListSelection(reviewContextKey)
  commentsSelectionClearTokenRef.current += 1
  setCommentsSelectionClearRequest({
    contextKey: reviewContextKey,
    token: commentsSelectionClearTokenRef.current
  })
}, [])

const refreshCommentsAfterBulkResolve = useCallback(
  async (provider: ChecksPanelReview['provider']): Promise<void> => {
    if (provider === 'gitlab') {
      await fetchGitLabDetails({ commitAsCurrent: true })
      return
    }
    await fetchComments({ force: true })
  },
  [fetchComments, fetchGitLabDetails]
)

const resolveSelectedThreadsAfterLaunch = useCallback(
  async (resolution: CommentResolution) => {
    clearSentCommentSelection(resolution.reviewContextKey)
    let resolved = 0
    let skipped = Math.max(
      0,
      resolution.selectedGroups.length - resolution.selectedThreadIds.length
    )
    let failed = 0
    let attemptedThreadCount = 0
    if (resolution.selectedThreadIds.length === 0) {
      toast.success(
        translate(
          'auto.components.right.sidebar.ChecksPanel.3c3ad3a1d2',
          'Started the agent. No selected comments can be marked resolved on the host.'
        )
      )
      return
    }
    for (const threadId of resolution.selectedThreadIds) {
      if (asyncResultKeyRef.current !== resolution.reviewContextKey) {
        skipped += resolution.selectedThreadIds.length - attemptedThreadCount
        break
      }
      attemptedThreadCount += 1
      const currentGroup = groupPRComments(commentsRef.current).find(
        (group) => group.kind === 'thread' && group.threadId === threadId
      )
      if (!currentGroup || !isResolvablePRCommentGroup(currentGroup)) {
        skipped += 1
        continue
      }
      const ok = await handleResolve(threadId, true, { notifyOnFailure: false })
      if (ok) {
        resolved += 1
      } else {
        failed += 1
      }
    }

    if (asyncResultKeyRef.current === resolution.reviewContextKey) {
      await refreshCommentsAfterBulkResolve(resolution.provider)
    }

    if (failed > 0) {
      toast.error(
        translate(
          'auto.components.right.sidebar.ChecksPanel.f273f2271c',
          'Started the agent. Marked {{value0}} resolved, skipped {{value1}}, failed {{value2}}.',
          { value0: resolved, value1: skipped, value2: failed }
        )
      )
      return
    }
    toast.success(
      translate(
        'auto.components.right.sidebar.ChecksPanel.aa95b81a3a',
        'Started the agent. Marked {{value0}} resolved, skipped {{value1}}, failed {{value2}}.',
        { value0: resolved, value1: skipped, value2: failed }
      )
    )
  },
  [clearSentCommentSelection, handleResolve, refreshCommentsAfterBulkResolve]
)
  return { handleResolveConflictsWithAI, handleResolveCommentsWithAI, clearSentCommentSelection, refreshCommentsAfterBulkResolve, resolveSelectedThreadsAfterLaunch }
}
