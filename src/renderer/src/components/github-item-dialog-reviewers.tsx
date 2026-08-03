import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useShallow } from 'zustand/react/shallow'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { useRepoAssignees } from '@/hooks/useIssueMetadata'
import { useRepoAssigneesBySlug } from '@/hooks/useGitHubSlugMetadata'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { getTaskSourceRuntimeSettings, type TaskSourceContext } from '../../../shared/task-source-context'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { getGitHubRuntimeRepoId } from '@/lib/github-source-runtime-context'
import { translate } from '@/i18n/i18n'
import {
  getGitHubPRReviewerRows,
  normalizeGitHubReviewerLogins,
  parseGitHubReviewerInputLogins
} from '@/components/github-pr-reviewer-display'
import {
  filterGitHubPRReviewerCandidates,
  getGitHubPRReviewerQueryState
} from '@/components/github/github-pr-reviewer-candidate-filter'
import {
  buildRequestedReviewUsers,
  mergeReviewerSuggestions,
  resolvePullRequestRepo,
  type GitHubItemDialogProjectOrigin
} from './github-item-dialog-model'
import { notifyWorkItemDetailsMutation } from './github-item-dialog-cache'
import { ReviewerAvatar } from './github-item-dialog-assignees'
import { ReviewerPicker } from './github-item-dialog-reviewer-picker'
import type { GitHubAssignableUser, GitHubWorkItem } from '../../../shared/types'

export { PRAssigneesPanel, ReviewerAvatar } from './github-item-dialog-assignees'

export function PRReviewersPanel({
  item,
  loading,
  repoPath,
  sourceContext,
  projectOrigin,
  onReviewersRequested
}: {
  item: GitHubWorkItem
  loading: boolean
  repoPath: string | null
  sourceContext?: TaskSourceContext | null
  projectOrigin?: GitHubItemDialogProjectOrigin
  onReviewersRequested: (reviewRequests: GitHubAssignableUser[]) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [reviewerInput, setReviewerInput] = useState('')
  const [activeReviewerCursor, setActiveReviewerCursor] = useState({
    resetKey: '',
    index: 0
  })
  const [submitting, setSubmitting] = useState(false)
  const [localReviewRequests, setLocalReviewRequests] = useState<GitHubAssignableUser[]>(
    () => item.reviewRequests ?? []
  )
  const [reviewRequestsSource, setReviewRequestsSource] = useState(() => ({
    itemId: item.id,
    repoId: item.repoId,
    reviewRequests: item.reviewRequests
  }))
  const patchWorkItem = useAppStore((s) => s.patchWorkItem)
  const repoOwnerSettings = useAppStore(
    useShallow((s) => getSettingsForRepoRuntimeOwner(s, item.repoId ?? null))
  )
  const sourceSettings = useMemo(
    () =>
      sourceContext?.provider === 'github'
        ? ({
            ...repoOwnerSettings,
            ...getTaskSourceRuntimeSettings(sourceContext)
          } as typeof repoOwnerSettings)
        : repoOwnerSettings,
    [repoOwnerSettings, sourceContext]
  )
  const reviewerInputRef = useRef<HTMLInputElement | null>(null)
  const reviewerInputFocusFrameRef = useRef<number | null>(null)
  const reviewerPanelMountedRef = useRef(true)

  const cancelReviewerInputFocusFrame = useCallback((): void => {
    if (reviewerInputFocusFrameRef.current !== null) {
      cancelAnimationFrame(reviewerInputFocusFrameRef.current)
      reviewerInputFocusFrameRef.current = null
    }
  }, [])

  const scheduleReviewerInputFocus = useCallback((): void => {
    if (!reviewerPanelMountedRef.current) {
      return
    }
    cancelReviewerInputFocusFrame()
    reviewerInputFocusFrameRef.current = requestAnimationFrame(() => {
      reviewerInputFocusFrameRef.current = null
      reviewerInputRef.current?.focus()
    })
  }, [cancelReviewerInputFocusFrame])

  useEffect(() => {
    reviewerPanelMountedRef.current = true
    return () => {
      reviewerPanelMountedRef.current = false
      cancelReviewerInputFocusFrame()
    }
  }, [cancelReviewerInputFocusFrame])

  // Why: clear stale optimistic reviewer requests on item switch/refetch before paint; a passive Effect would leave one stale render.
  if (
    reviewRequestsSource.itemId !== item.id ||
    reviewRequestsSource.repoId !== item.repoId ||
    reviewRequestsSource.reviewRequests !== item.reviewRequests
  ) {
    setReviewRequestsSource({
      itemId: item.id,
      repoId: item.repoId,
      reviewRequests: item.reviewRequests
    })
    setLocalReviewRequests(item.reviewRequests ?? [])
  }

  const reviewerSeedUsers = useMemo<GitHubAssignableUser[]>(() => {
    const byLogin = new Map<string, GitHubAssignableUser>()
    const add = (user: GitHubAssignableUser): void => {
      if (!user.login) {
        return
      }
      byLogin.set(user.login.toLowerCase(), user)
    }
    for (const user of localReviewRequests) {
      add(user)
    }
    for (const review of item.latestReviews ?? []) {
      add({
        login: review.login,
        name: null,
        avatarUrl: review.avatarUrl ?? ''
      })
    }
    if (item.author) {
      add({ login: item.author, name: null, avatarUrl: '' })
    }
    return Array.from(byLogin.values())
  }, [item.author, item.latestReviews, localReviewRequests])

  const reviewRepo = useMemo(
    () => resolvePullRequestRepo(item, projectOrigin),
    [item, projectOrigin]
  )
  const reviewerMetadataBySlug = useRepoAssigneesBySlug(
    open && reviewRepo ? reviewRepo.owner : null,
    open && reviewRepo ? reviewRepo.repo : null,
    reviewerSeedUsers.map((user) => user.login),
    sourceSettings,
    reviewRepo?.host
  )
  const reviewerMetadataByPath = useRepoAssignees(
    open && !reviewRepo ? repoPath : null,
    open && !reviewRepo ? item.repoId : null,
    sourceSettings
  )
  const reviewerMetadata = reviewRepo ? reviewerMetadataBySlug : reviewerMetadataByPath
  const displayItem = { ...item, reviewRequests: localReviewRequests }
  const reviewers = getGitHubPRReviewerRows(displayItem)
  const authorLogin = item.author?.toLowerCase() ?? null
  const reviewerCandidates = useMemo(
    () =>
      mergeReviewerSuggestions(reviewerMetadata.data, reviewerSeedUsers).filter(
        (user) => user.login.toLowerCase() !== authorLogin
      ),
    [authorLogin, reviewerMetadata.data, reviewerSeedUsers]
  )
  const reviewerCandidatesByLogin = useMemo(
    () => new Map(reviewerCandidates.map((user) => [user.login.toLowerCase(), user])),
    [reviewerCandidates]
  )
  const selectedReviewerLogins = useMemo(
    () =>
      new Set(
        localReviewRequests.map((reviewer) => reviewer.login.trim().toLowerCase()).filter(Boolean)
      ),
    [localReviewRequests]
  )
  const reviewerQueryState = useMemo(
    () => getGitHubPRReviewerQueryState(reviewerInput),
    [reviewerInput]
  )
  const reviewerQuery = reviewerQueryState.query
  const filteredReviewerCandidates = useMemo(
    () =>
      filterGitHubPRReviewerCandidates({
        candidates: reviewerCandidates,
        queryState: reviewerQueryState
      }),
    [reviewerCandidates, reviewerQueryState]
  )
  const suggestedReviewerRows = useMemo(
    () =>
      reviewerQuery.length === 0 && !reviewerQueryState.isTooLarge
        ? reviewerSeedUsers
            .filter((user) => !selectedReviewerLogins.has(user.login.toLowerCase()))
            .filter((user) => user.login.toLowerCase() !== authorLogin)
            .map((user) => reviewerCandidatesByLogin.get(user.login.toLowerCase()) ?? user)
            .slice(0, 1)
        : [],
    [
      authorLogin,
      reviewerCandidatesByLogin,
      reviewerQuery.length,
      reviewerQueryState.isTooLarge,
      reviewerSeedUsers,
      selectedReviewerLogins
    ]
  )
  const everyoneElseReviewerRows = useMemo(() => {
    const suggestedLogins = new Set(suggestedReviewerRows.map((user) => user.login.toLowerCase()))
    return filteredReviewerCandidates.filter(
      (user) => !suggestedLogins.has(user.login.toLowerCase())
    )
  }, [filteredReviewerCandidates, suggestedReviewerRows])
  const actionableReviewerRows = useMemo(
    () => [...suggestedReviewerRows, ...everyoneElseReviewerRows],
    [everyoneElseReviewerRows, suggestedReviewerRows]
  )

  const reviewerCursorResetKey = `${reviewerQuery}\u0000${actionableReviewerRows.length}`
  if (activeReviewerCursor.resetKey !== reviewerCursorResetKey) {
    setActiveReviewerCursor({ resetKey: reviewerCursorResetKey, index: 0 })
  }
  const activeReviewerIndex =
    activeReviewerCursor.resetKey === reviewerCursorResetKey ? activeReviewerCursor.index : 0
  const setActiveReviewerIndex = useCallback(
    (nextIndex: number | ((current: number) => number)): void => {
      setActiveReviewerCursor((current) => {
        const currentIndex = current.resetKey === reviewerCursorResetKey ? current.index : 0
        return {
          resetKey: reviewerCursorResetKey,
          index: typeof nextIndex === 'function' ? nextIndex(currentIndex) : nextIndex
        }
      })
    },
    [reviewerCursorResetKey]
  )

  const hasReviewerMetadata =
    item.reviewDecision !== undefined ||
    localReviewRequests.length > 0 ||
    item.reviewRequests !== undefined ||
    item.latestReviews !== undefined
  const canRequestReview =
    !!repoPath || getActiveRuntimeTarget(sourceSettings).kind === 'environment'

  const handleRequestReview = async (requestedLogins?: string[]): Promise<void> => {
    if (submitting) {
      return
    }
    const logins = normalizeGitHubReviewerLogins(
      requestedLogins ?? parseGitHubReviewerInputLogins(reviewerInput),
      selectedReviewerLogins
    )
    if (logins.length === 0) {
      toast.error(translate('auto.components.GitHubItemDialog.94ab23a9f9', 'Enter a reviewer'))
      return
    }
    if (localReviewRequests.length + logins.length > 15) {
      toast.error(
        translate(
          'auto.components.GitHubItemDialog.12e761610e',
          'You can request up to 15 reviewers'
        )
      )
      return
    }
    const target = getActiveRuntimeTarget(sourceSettings)
    if (target.kind !== 'environment' && !repoPath) {
      toast.error(
        translate(
          'auto.components.GitHubItemDialog.b4af16bf43',
          'No repo context available for this pull request.'
        )
      )
      return
    }
    setSubmitting(true)
    try {
      const runtimeRepo = getGitHubRuntimeRepoId(sourceContext, item.repoId)
      const result =
        target.kind === 'environment'
          ? await callRuntimeRpc<{ ok: boolean; error?: string }>(
              target,
              'github.requestPRReviewers',
              {
                repo: runtimeRepo,
                prNumber: item.number,
                reviewers: logins,
                prRepo: reviewRepo
              },
              { timeoutMs: 30_000 }
            )
          : await window.api.gh.requestPRReviewers({
              repoPath: repoPath ?? '',
              repoId: item.repoId,
              sourceContext,
              prNumber: item.number,
              reviewers: logins,
              prRepo: reviewRepo
            })
      if (!reviewerPanelMountedRef.current) {
        return
      }
      if (!result.ok) {
        toast.error(
          result.error ??
            translate('auto.components.GitHubItemDialog.c42d942b75', 'Failed to request reviewer')
        )
        return
      }
      const nextReviewRequests = buildRequestedReviewUsers(
        logins,
        reviewerCandidates,
        localReviewRequests
      )
      setLocalReviewRequests(nextReviewRequests)
      patchWorkItem(item.id, { reviewRequests: nextReviewRequests }, item.repoId, {
        sourceContext
      })
      onReviewersRequested(nextReviewRequests)
      if (target.kind === 'environment') {
        notifyWorkItemDetailsMutation(
          {
            repoPath: repoPath ?? '',
            repoId: item.repoId,
            sourceContext,
            type: 'pr',
            number: item.number
          },
          { local: false }
        )
      }
      setReviewerInput('')
      useAppStore.getState().recordFeatureInteraction('github-tasks')
      toast.success(
        logins.length === 1
          ? translate('auto.components.GitHubItemDialog.ea985e657f', 'Reviewer requested')
          : translate('auto.components.GitHubItemDialog.c016e4bac3', 'Reviewers requested')
      )
    } catch {
      if (reviewerPanelMountedRef.current) {
        toast.error(
          translate('auto.components.GitHubItemDialog.c42d942b75', 'Failed to request reviewer')
        )
      }
    } finally {
      if (reviewerPanelMountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  const handleRemoveReviewers = async (reviewersToRemove: string[]): Promise<void> => {
    if (submitting) {
      return
    }
    const selected = new Set(localReviewRequests.map((reviewer) => reviewer.login.toLowerCase()))
    const logins = reviewersToRemove
      .map((reviewer) => reviewer.trim().replace(/^@/, ''))
      .filter((reviewer) => reviewer.length > 0 && selected.has(reviewer.toLowerCase()))
    if (logins.length === 0) {
      return
    }
    const target = getActiveRuntimeTarget(sourceSettings)
    if (target.kind !== 'environment' && !repoPath) {
      toast.error(
        translate(
          'auto.components.GitHubItemDialog.b4af16bf43',
          'No repo context available for this pull request.'
        )
      )
      return
    }
    setSubmitting(true)
    try {
      const runtimeRepo = getGitHubRuntimeRepoId(sourceContext, item.repoId)
      const result =
        target.kind === 'environment'
          ? await callRuntimeRpc<{ ok: boolean; error?: string }>(
              target,
              'github.removePRReviewers',
              {
                repo: runtimeRepo,
                prNumber: item.number,
                reviewers: logins,
                prRepo: reviewRepo
              },
              { timeoutMs: 30_000 }
            )
          : await window.api.gh.removePRReviewers({
              repoPath: repoPath ?? '',
              repoId: item.repoId,
              sourceContext,
              prNumber: item.number,
              reviewers: logins,
              prRepo: reviewRepo
            })
      if (!reviewerPanelMountedRef.current) {
        return
      }
      if (!result.ok) {
        toast.error(
          result.error ??
            translate('auto.components.GitHubItemDialog.73487fb975', 'Failed to remove reviewer')
        )
        return
      }
      const removed = new Set(logins.map((login) => login.toLowerCase()))
      const nextReviewRequests = localReviewRequests.filter(
        (reviewer) => !removed.has(reviewer.login.toLowerCase())
      )
      setLocalReviewRequests(nextReviewRequests)
      patchWorkItem(item.id, { reviewRequests: nextReviewRequests }, item.repoId, {
        sourceContext
      })
      onReviewersRequested(nextReviewRequests)
      if (target.kind === 'environment') {
        notifyWorkItemDetailsMutation(
          {
            repoPath: repoPath ?? '',
            repoId: item.repoId,
            sourceContext,
            type: 'pr',
            number: item.number
          },
          { local: false }
        )
      }
      setReviewerInput('')
      useAppStore.getState().recordFeatureInteraction('github-tasks')
      toast.success(
        logins.length === 1
          ? translate('auto.components.GitHubItemDialog.69515bff81', 'Reviewer removed')
          : translate('auto.components.GitHubItemDialog.2e69540652', 'Reviewers removed')
      )
    } catch {
      if (reviewerPanelMountedRef.current) {
        toast.error(
          translate('auto.components.GitHubItemDialog.73487fb975', 'Failed to remove reviewer')
        )
      }
    } finally {
      if (reviewerPanelMountedRef.current) {
        setSubmitting(false)
      }
    }
  }

  const requestReviewer = async (reviewer: GitHubAssignableUser): Promise<void> => {
    await (selectedReviewerLogins.has(reviewer.login.toLowerCase())
      ? handleRemoveReviewers([reviewer.login])
      : handleRequestReview([reviewer.login]))
    scheduleReviewerInputFocus()
  }

  const handleReviewerPickerOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen)
    if (nextOpen) {
      scheduleReviewerInputFocus()
      return
    }
    setReviewerInput('')
  }

  const handleReviewerInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && actionableReviewerRows.length > 0) {
      event.preventDefault()
      setActiveReviewerIndex((current) => (current + 1) % actionableReviewerRows.length)
      return
    }
    if (event.key === 'ArrowUp' && actionableReviewerRows.length > 0) {
      event.preventDefault()
      setActiveReviewerIndex(
        (current) => (current - 1 + actionableReviewerRows.length) % actionableReviewerRows.length
      )
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const activeReviewer = actionableReviewerRows[activeReviewerIndex]
      if (activeReviewer) {
        void requestReviewer(activeReviewer)
        return
      }
      void handleRequestReview()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      handleReviewerPickerOpenChange(false)
    }
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        <span>{translate('auto.components.GitHubItemDialog.dc8a092c57', 'Reviewers')}</span>
        <ReviewerPicker
          open={open}
          submitting={submitting}
          canRequestReview={canRequestReview}
          reviewerInputRef={reviewerInputRef}
          reviewerInput={reviewerInput}
          actionableReviewerRows={actionableReviewerRows}
          activeReviewerIndex={activeReviewerIndex}
          selectedReviewerLogins={selectedReviewerLogins}
          suggestedReviewerRows={suggestedReviewerRows}
          everyoneElseReviewerRows={everyoneElseReviewerRows}
          hasReviewerCandidates={filteredReviewerCandidates.length > 0}
          loading={reviewerMetadata.loading}
          error={reviewerMetadata.error}
          hasReviewerMetadata={hasReviewerMetadata}
          onOpenChange={handleReviewerPickerOpenChange}
          onInputChange={setReviewerInput}
          onInputKeyDown={handleReviewerInputKeyDown}
          onSetActiveReviewerIndex={setActiveReviewerIndex}
          onRequestReviewer={(reviewer) => void requestReviewer(reviewer)}
        />
      </div>
      {loading && !hasReviewerMetadata ? (
        <div className="flex items-center gap-2 py-1 text-[12px] text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          {translate('auto.components.GitHubItemDialog.6a45771d47', 'Loading reviewers')}
        </div>
      ) : reviewers.length > 0 ? (
        <div className="flex flex-col gap-2">
          {reviewers.map((reviewer) => {
            const canRemoveReviewer = selectedReviewerLogins.has(reviewer.login.toLowerCase())
            return (
              <div key={reviewer.login} className="flex min-w-0 items-center gap-2">
                <ReviewerAvatar login={reviewer.login} avatarUrl={reviewer.avatarUrl} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium text-foreground">
                    {reviewer.login}
                  </div>
                  {reviewer.name ? (
                    <div className="truncate text-[11px] text-muted-foreground">
                      {reviewer.name}
                    </div>
                  ) : null}
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {reviewer.stateLabel}
                </span>
                {canRemoveReviewer ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 shrink-0 text-muted-foreground hover:text-foreground"
                        disabled={submitting || !canRequestReview}
                        aria-label={translate(
                          'auto.components.GitHubItemDialog.8b15a5e91c',
                          'Remove reviewer {{value0}}',
                          { value0: reviewer.login }
                        )}
                        onClick={() => {
                          void handleRemoveReviewers([reviewer.login])
                        }}
                      >
                        <X className="size-3.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {translate('auto.components.GitHubItemDialog.5c1c973855', 'Remove reviewer')}
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>
            )
          })}
        </div>
      ) : (
        <div className="py-1 text-[12px] text-muted-foreground">
          {translate('auto.components.GitHubItemDialog.36f9ac4a47', 'No reviewers requested.')}
        </div>
      )}
    </section>
  )
}
