import type { ChecksPanelCommentKey } from './checks-panel-comment-actions-types'
/* Title and comment mutation actions for ChecksPanel. */
import { useCallback, useEffect } from 'react'
import { toast } from 'sonner'
import { checksPanelAsyncResultKey } from './checks-panel-async-result-key'
import { translate } from '@/i18n/i18n'
import { isMutablePRConversationComment } from './checks-panel-content'
import { githubProjectHost } from '../../../../shared/github-project-identity'
import { markPRCommentThreadResolved, restorePRCommentThreadSnapshot } from './pr-comment-thread-resolution'
import { resolveGitLabMRDiscussionForChecks } from './checks-panel-runtime-data'
import type { PRComment } from '../../../../shared/types'

export function useChecksPanelCommentActions<T extends Record<string, unknown>>(context: T & { [K in ChecksPanelCommentKey]: K extends keyof T ? T[K] : never }): Record<string, unknown> {
  const {
    activeGitLabReview,
    activeReview,
    addPRConversationComment,
    addPRReviewCommentReply,
    branch,
    clearTitleInputFocusTimer,
    confirm,
    isCurrentAsyncResult,
    mountedRef,
    pr,
    prCacheKey,
    prNumber,
    refreshHostedReviewAfterMutation,
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
  } = context

const handleStartEdit = useCallback(() => {
  if (!activeReview) {
    return
  }
  setTitleDraft(activeReview.title)
  setEditingTitle(true)
  clearTitleInputFocusTimer()
  titleInputFocusTimerRef.current = setTimeout(() => {
    titleInputFocusTimerRef.current = null
    titleInputRef.current?.focus()
  }, 0)
}, [activeReview, clearTitleInputFocusTimer])

const handleCancelEdit = useCallback(() => {
  clearTitleInputFocusTimer()
  setEditingTitle(false)
  setTitleDraft('')
}, [clearTitleInputFocusTimer])

const handleSaveTitle = useCallback(async () => {
  const nextTitle = titleDraft.trim()
  if (!repo || !activeReview || !nextTitle || nextTitle === activeReview.title) {
    clearTitleInputFocusTimer()
    setEditingTitle(false)
    return
  }
  setTitleSaving(true)
  try {
    if (activeReview.provider === 'gitlab') {
      const result = await window.api.gl.updateMR({
        repoPath: repo.path,
        repoId: repo.id,
        iid: activeReview.number,
        updates: { title: nextTitle }
      })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      await refreshHostedReviewAfterMutation()
    } else {
      if (!pr) {
        return
      }
      const ok = await window.api.gh.updatePRTitle({
        repoPath: repo.path,
        repoId: repo.id,
        prNumber: pr.number,
        title: nextTitle,
        prRepo: pr.prRepo ?? null
      })
      if (ok) {
        await refreshHostedReviewAfterMutation()
      }
    }
  } finally {
    clearTitleInputFocusTimer()
    if (mountedRef.current) {
      setTitleSaving(false)
      setEditingTitle(false)
    }
  }
}, [
  activeReview,
  repo,
  pr,
  titleDraft,
  refreshHostedReviewAfterMutation,
  clearTitleInputFocusTimer,
  mountedRef
])

const handleTitleKeyDown = useCallback(
  (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      void handleSaveTitle()
    } else if (e.key === 'Escape') {
      handleCancelEdit()
    }
  },
  [handleSaveTitle, handleCancelEdit]
)

const handleResolve = useCallback(
  async (
    threadId: string,
    resolve: boolean,
    options: { notifyOnFailure?: boolean } = {}
  ): Promise<boolean> => {
    const notifyOnFailure = options.notifyOnFailure !== false
    const rollbackThread = (previousThreadComments: PRComment[]): void => {
      setComments((prev) => restorePRCommentThreadSnapshot(prev, previousThreadComments))
    }
    if (repo && activeGitLabReview) {
      let previousThreadComments: PRComment[] = []
      setComments((prev) => {
        previousThreadComments = prev.filter((comment) => comment.threadId === threadId)
        return markPRCommentThreadResolved(prev, threadId, resolve)
      })
      const result = await resolveGitLabMRDiscussionForChecks({
        repoPath: repo.path,
        repoId: repo.id,
        settings,
        iid: activeGitLabReview.number,
        discussionId: threadId,
        resolved: resolve
      })
      if (!result.ok) {
        rollbackThread(previousThreadComments)
        if (notifyOnFailure) {
          toast.error(result.error)
        }
        return false
      }
      return true
    }
    if (!repo || !prNumber) {
      return false
    }
    const requestKey = checksPanelAsyncResultKey(
      prCacheKey,
      branch,
      prNumber,
      pr?.prRepo,
      pr?.headSha
    )
    let previousThreadComments: PRComment[] = []
    setComments((prev) => {
      previousThreadComments = prev.filter((comment) => comment.threadId === threadId)
      return markPRCommentThreadResolved(prev, threadId, resolve)
    })
    const ok = await resolveReviewThread(repo.path, prNumber, threadId, resolve, {
      repoId: repo.id,
      prRepo: pr?.prRepo
    })
    if (!isCurrentAsyncResult(requestKey)) {
      return ok
    }
    if (!ok) {
      rollbackThread(previousThreadComments)
      if (notifyOnFailure) {
        toast.error(
          translate(
            'auto.components.right.sidebar.ChecksPanel.5788d1059d',
            'Could not update review thread. Check the GitHub API budget.'
          )
        )
      }
    }
    return ok
  },
  [
    activeGitLabReview,
    branch,
    isCurrentAsyncResult,
    pr?.headSha,
    pr?.prRepo,
    prCacheKey,
    prNumber,
    repo,
    resolveReviewThread,
    settings
  ]
)

const canTargetPRComments = Boolean(repo && prNumber && pr?.prRepo)
const commentsDisabledReason = canTargetPRComments
  ? undefined
  : 'Commenting requires a GitHub PR repository target.'
useEffect(() => {
  if (!sourceControlAiActionsVisible) {
    setAgentComposerState(null)
  }
}, [sourceControlAiActionsVisible])
const handleAddPRComment = useCallback(
  async (body: string) => {
    if (!repo || !prNumber || !pr?.prRepo) {
      return { ok: false as const, error: commentsDisabledReason ?? 'Commenting unavailable.' }
    }
    const requestKey = checksPanelAsyncResultKey(
      prCacheKey,
      branch,
      prNumber,
      pr.prRepo,
      pr.headSha
    )
    const result = await addPRConversationComment(repo.path, prNumber, body, {
      repoId: repo.id,
      prRepo: pr.prRepo
    })
    if (!isCurrentAsyncResult(requestKey)) {
      return result.ok ? { ok: true as const } : result
    }
    if (!result.ok) {
      toast.error(result.error)
      return result
    }
    setComments((prev) => mergePRCommentIntoList(prev, result.comment))
    return { ok: true as const }
  },
  [
    addPRConversationComment,
    branch,
    commentsDisabledReason,
    isCurrentAsyncResult,
    pr,
    prCacheKey,
    prNumber,
    repo
  ]
)

const handleEditComment = useCallback(
  async (comment: PRComment, body: string): Promise<boolean> => {
    if (!pr?.prRepo || !isMutablePRConversationComment(comment)) {
      return false
    }
    const result = await window.api.gh.updateIssueCommentBySlug({
      owner: pr.prRepo.owner,
      repo: pr.prRepo.repo,
      host: githubProjectHost(pr.prRepo.host),
      commentId: comment.id,
      body
    })
    if (!result.ok) {
      toast.error(result.error.message)
      return false
    }
    setComments((prev) =>
      prev.map((entry) => (entry.id === comment.id ? { ...entry, body } : entry))
    )
    return true
  },
  [pr?.prRepo]
)

const handleDeleteComment = useCallback(
  async (comment: PRComment): Promise<void> => {
    if (!pr?.prRepo || !isMutablePRConversationComment(comment)) {
      return
    }
    const confirmed = await confirm({
      title: translate('auto.components.right.sidebar.ChecksPanel.ea9b649ce3', 'Delete comment?'),
      description: translate(
        'auto.components.right.sidebar.ChecksPanel.3b203c62f8',
        'This will permanently remove the comment from the PR.'
      ),
      confirmLabel: translate('auto.components.right.sidebar.ChecksPanel.786e3c143f', 'Delete'),
      confirmVariant: 'destructive'
    })
    if (!confirmed) {
      return
    }
    const result = await window.api.gh.deleteIssueCommentBySlug({
      owner: pr.prRepo.owner,
      repo: pr.prRepo.repo,
      host: githubProjectHost(pr.prRepo.host),
      commentId: comment.id
    })
    if (!result.ok) {
      toast.error(result.error.message)
      return
    }
    setComments((prev) => prev.filter((entry) => entry.id !== comment.id))
  },
  [pr?.prRepo, confirm]
)

const handleReplyToComment = useCallback(
  async (comment: PRComment, body: string) => {
    if (!repo || !prNumber || !pr?.prRepo) {
      return { ok: false as const, error: commentsDisabledReason ?? 'Commenting unavailable.' }
    }
    const requestKey = checksPanelAsyncResultKey(
      prCacheKey,
      branch,
      prNumber,
      pr.prRepo,
      pr.headSha
    )
    const canReplyToReviewThread =
      Boolean(comment.threadId) && Number.isSafeInteger(comment.id) && comment.id > 0
    const result = canReplyToReviewThread
      ? await addPRReviewCommentReply(repo.path, prNumber, comment.id, body, {
          repoId: repo.id,
          prRepo: pr.prRepo,
          threadId: comment.threadId,
          path: comment.path,
          line: comment.line
        })
      : await addPRConversationComment(repo.path, prNumber, `@${comment.author} ${body}`, {
          repoId: repo.id,
          prRepo: pr.prRepo
        })
    if (!isCurrentAsyncResult(requestKey)) {
      return result.ok ? { ok: true as const } : result
    }
    if (!result.ok) {
      toast.error(result.error)
      return result
    }
    setComments((prev) => mergePRCommentIntoList(prev, result.comment))
    return { ok: true as const }
  },
  [
    addPRConversationComment,
    addPRReviewCommentReply,
    branch,
    commentsDisabledReason,
    isCurrentAsyncResult,
    pr,
    prCacheKey,
    prNumber,
    repo
  ]
)

// Why: hosted-review conflicts come from the host mergeability check (no local MERGE_HEAD), so the prompt reproduces the merge locally.
  return { handleStartEdit, handleCancelEdit, handleSaveTitle, handleTitleKeyDown, handleResolve, handleAddPRComment, handleEditComment, handleDeleteComment, handleReplyToComment }
}
