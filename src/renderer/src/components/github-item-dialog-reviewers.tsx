import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  LoaderCircle,
  Pencil,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useShallow } from 'zustand/react/shallow'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useRepoAssignees, useImmediateMutation } from '@/hooks/useIssueMetadata'
import { useRepoAssigneesBySlug } from '@/hooks/useGitHubSlugMetadata'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { getTaskSourceRuntimeSettings, type TaskSourceContext } from '../../../shared/task-source-context'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { getGitHubRuntimeRepoId } from '@/lib/github-source-runtime-context'
import { translate } from '@/i18n/i18n'
import { parseOwnerRepoFromItemUrl } from '@/components/github-work-item-display'
import {
  getGitHubPRReviewerRows,
  normalizeGitHubReviewerLogins,
  parseGitHubReviewerInputLogins
} from '@/components/github-pr-reviewer-display'
import {
  filterGitHubPRReviewerCandidates,
  getGitHubPRReviewerQueryState
} from '@/components/github/github-pr-reviewer-candidate-filter'
import { GitHubUserAvatar } from '@/components/github/github-user-avatar'
import {
  buildRequestedReviewUsers,
  mergeReviewerSuggestions,
  resolvePullRequestRepo,
  type GitHubItemDialogProjectOrigin
} from './github-item-dialog-model'
import { notifyWorkItemDetailsMutation } from './github-item-dialog-cache'
import { runIssueUpdate } from './github-item-dialog-mutations'
import type { GitHubAssignableUser, GitHubWorkItem } from '../../../shared/types'

export function ReviewerAvatar({
  login,
  avatarUrl
}: {
  login: string
  avatarUrl: string
}): React.JSX.Element {
  return <GitHubUserAvatar login={login} avatarUrl={avatarUrl} title={login} className="size-6" />
}
export function PRAssigneesPanel({
  item,
  repoPath,
  projectOrigin,
  sourceContext,
  onMutated
}: {
  item: GitHubWorkItem
  repoPath: string | null
  projectOrigin: GitHubItemDialogProjectOrigin | undefined
  sourceContext?: TaskSourceContext | null
  onMutated: () => void
}): React.JSX.Element {
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false)
  const [localAssignees, setLocalAssignees] = useState<GitHubAssignableUser[]>(
    () => item.assignees ?? []
  )
  const [assigneesSource, setAssigneesSource] = useState(() => ({
    itemId: item.id,
    repoId: item.repoId,
    assignees: item.assignees
  }))
  const patchWorkItem = useAppStore((s) => s.patchWorkItem)
  const patchProjectRowContent = useAppStore((s) => s.patchProjectRowContent)
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
  const { isPending, run } = useImmediateMutation()

  // Why: a background refetch can change PR assignees; sync before paint so the right rail never shows a stale reviewer/assignee split.
  if (
    assigneesSource.itemId !== item.id ||
    assigneesSource.repoId !== item.repoId ||
    assigneesSource.assignees !== item.assignees
  ) {
    setAssigneesSource({ itemId: item.id, repoId: item.repoId, assignees: item.assignees })
    setLocalAssignees(item.assignees ?? [])
  }

  const patchProjectRowIfNeeded = useCallback(
    (assignees: string[]) => {
      if (!projectOrigin) {
        return
      }
      patchProjectRowContent(projectOrigin.cacheKey, projectOrigin.projectItemId, { assignees })
    },
    [patchProjectRowContent, projectOrigin]
  )
  const assigneeLogins = useMemo(() => localAssignees.map((user) => user.login), [localAssignees])
  const assigneeSlug = useMemo(() => parseOwnerRepoFromItemUrl(item.url), [item.url])
  const slugOwner = projectOrigin?.owner ?? assigneeSlug?.owner ?? null
  const slugRepo = projectOrigin?.repo ?? assigneeSlug?.repo ?? null
  const repoAssigneesBySlug = useRepoAssigneesBySlug(
    slugOwner,
    slugRepo,
    assigneeLogins,
    sourceSettings,
    projectOrigin?.host ?? assigneeSlug?.host
  )
  const repoAssigneesByPath = useRepoAssignees(repoPath, item.repoId, sourceSettings)
  const repoAssignees = slugOwner && slugRepo ? repoAssigneesBySlug : repoAssigneesByPath
  const canEditAssignees = Boolean(projectOrigin || repoPath)
  const assigneesByLogin = useMemo(
    () => new Map(repoAssignees.data.map((user) => [user.login.toLowerCase(), user])),
    [repoAssignees.data]
  )

  const handleAssigneeToggle = useCallback(
    (login: string) => {
      const lowerLogin = login.toLowerCase()
      const isAssigned = localAssignees.some((user) => user.login.toLowerCase() === lowerLogin)
      const prevAssignees = localAssignees
      const candidate = assigneesByLogin.get(lowerLogin) ?? { login, name: null, avatarUrl: '' }
      const nextAssignees = isAssigned
        ? prevAssignees.filter((user) => user.login.toLowerCase() !== lowerLogin)
        : [...prevAssignees, candidate]
      const nextLogins = nextAssignees.map((user) => user.login)
      const prevLogins = prevAssignees.map((user) => user.login)

      run('assignees', {
        mutate: () =>
          runIssueUpdate({
            repoId: item.repoId,
            repoPath,
            sourceContext,
            projectOrigin,
            number: item.number,
            updates: isAssigned ? { removeAssignees: [login] } : { addAssignees: [login] }
          }),
        onOptimistic: () => {
          setLocalAssignees(nextAssignees)
          patchWorkItem(item.id, { assignees: nextAssignees }, item.repoId, { sourceContext })
          patchProjectRowIfNeeded(nextLogins)
        },
        onRevert: () => {
          setLocalAssignees(prevAssignees)
          patchWorkItem(item.id, { assignees: prevAssignees }, item.repoId, { sourceContext })
          patchProjectRowIfNeeded(prevLogins)
        },
        onSuccess: () => {
          useAppStore.getState().recordFeatureInteraction('github-tasks')
          onMutated()
        },
        onError: (err) => toast.error(err)
      })
    },
    [
      assigneesByLogin,
      item.id,
      item.number,
      item.repoId,
      localAssignees,
      onMutated,
      patchProjectRowIfNeeded,
      patchWorkItem,
      projectOrigin,
      repoPath,
      run,
      sourceContext
    ]
  )

  const checkIcon = (
    <svg className="size-2.5" viewBox="0 0 12 12" fill="none">
      <path
        d="M2 6l3 3 5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )

  return (
    <section>
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        <span>{translate('auto.components.GitHubItemDialog.83ac703dda', 'Assignees')}</span>
        <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={!canEditAssignees || isPending('assignees') || repoAssignees.loading}
              aria-label={translate(
                'auto.components.GitHubItemDialog.76adcf5fe2',
                'Edit assignees'
              )}
              className="rounded p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {isPending('assignees') ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Pencil className="size-3" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent className="popover-scroll-content scrollbar-sleek w-60 p-1" align="end">
            {repoAssignees.error ? (
              <div className="px-2 py-3 text-center text-[12px] text-destructive">
                {repoAssignees.error}
              </div>
            ) : (
              <div>
                {repoAssignees.data.map((user) => {
                  const selected = localAssignees.some(
                    (assignee) => assignee.login.toLowerCase() === user.login.toLowerCase()
                  )
                  return (
                    <button
                      key={user.login}
                      type="button"
                      onClick={() => handleAssigneeToggle(user.login)}
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent"
                    >
                      <span
                        className={cn(
                          'flex size-3.5 items-center justify-center rounded-sm border',
                          selected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-input'
                        )}
                      >
                        {selected && checkIcon}
                      </span>
                      {user.avatarUrl ? (
                        <img src={user.avatarUrl} alt="" className="size-5 rounded-full" />
                      ) : null}
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate">{user.login}</span>
                        {user.name ? (
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {user.name}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      {localAssignees.length === 0 ? (
        <div className="text-[12px] text-muted-foreground">
          {translate('auto.components.GitHubItemDialog.c67de9e2fe', 'No one assigned')}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {localAssignees.map((assignee) => (
            <li key={assignee.login} className="flex min-w-0 items-center gap-2">
              <ReviewerAvatar login={assignee.login} avatarUrl={assignee.avatarUrl} />
              <span className="min-w-0 truncate text-[13px] font-medium text-foreground">
                {assignee.login}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

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

  const renderReviewerPickerRow = (
    reviewer: GitHubAssignableUser,
    options: { suggested: boolean; activeIndex: number }
  ): React.JSX.Element => {
    const selected = selectedReviewerLogins.has(reviewer.login.toLowerCase())
    const active = actionableReviewerRows[activeReviewerIndex]?.login === reviewer.login
    return (
      <button
        key={`${options.suggested ? 'suggested' : 'reviewer'}:${reviewer.login}`}
        type="button"
        aria-label={
          selected
            ? translate(
                'auto.components.GitHubItemDialog.fedc09eeb9',
                'Unrequest reviewer {{value0}}',
                { value0: reviewer.login }
              )
            : translate(
                'auto.components.GitHubItemDialog.8c45901789',
                'Request reviewer {{value0}}',
                { value0: reviewer.login }
              )
        }
        aria-pressed={selected}
        className={cn(
          'flex min-h-10 w-full items-center gap-2 border-b border-border/70 px-3 py-2 text-left text-[13px] outline-none last:border-b-0 hover:bg-accent/70 focus-visible:bg-accent focus-visible:text-accent-foreground',
          active && 'bg-accent text-accent-foreground',
          selected && 'font-medium'
        )}
        onMouseEnter={() => setActiveReviewerIndex(options.activeIndex)}
        onMouseDown={(event) => {
          event.preventDefault()
        }}
        onFocus={() => setActiveReviewerIndex(options.activeIndex)}
        onClick={() => {
          void requestReviewer(reviewer)
        }}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-foreground">
          {selected ? <Check className="size-3.5" /> : null}
        </span>
        {reviewer.avatarUrl ? (
          <img src={reviewer.avatarUrl} alt="" className="size-5 shrink-0 rounded-full" />
        ) : (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-medium text-muted-foreground">
            {reviewer.login.slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate">
            <span className="font-semibold text-foreground">{reviewer.login}</span>
            {reviewer.name ? (
              <span className="ml-1 font-normal text-muted-foreground">{reviewer.name}</span>
            ) : null}
          </span>
          {options.suggested ? (
            <span className="block truncate text-[12px] leading-4 text-muted-foreground">
              {translate(
                'auto.components.GitHubItemDialog.e3243d9376',
                'Recently edited these files'
              )}
            </span>
          ) : null}
        </span>
      </button>
    )
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        <span>{translate('auto.components.GitHubItemDialog.dc8a092c57', 'Reviewers')}</span>
        <Popover open={open} onOpenChange={handleReviewerPickerOpenChange}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={submitting || !canRequestReview}
              aria-label={translate('auto.components.GitHubItemDialog.934add88b6', 'Reviewer')}
              className="rounded p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              {submitting ? (
                <LoaderCircle className="size-3 animate-spin" />
              ) : (
                <Pencil className="size-3" />
              )}
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="flex max-h-[420px] w-[330px] flex-col overflow-hidden rounded-md border-border/70 p-0"
            align="end"
            side="bottom"
            sideOffset={6}
            onOpenAutoFocus={(event) => {
              event.preventDefault()
            }}
          >
            <div className="border-b border-border/70 p-2">
              <Input
                ref={reviewerInputRef}
                value={reviewerInput}
                onChange={(event) => setReviewerInput(event.target.value)}
                disabled={submitting || !canRequestReview}
                placeholder={translate(
                  'auto.components.GitHubItemDialog.bb42774171',
                  'Type or choose a user'
                )}
                aria-label={translate('auto.components.GitHubItemDialog.934add88b6', 'Reviewer')}
                aria-expanded={open}
                aria-haspopup="listbox"
                className="h-8 min-w-0 cursor-text rounded-md border-border/50 bg-background text-xs"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' && actionableReviewerRows.length > 0) {
                    event.preventDefault()
                    setActiveReviewerIndex(
                      (current) => (current + 1) % actionableReviewerRows.length
                    )
                    return
                  }
                  if (event.key === 'ArrowUp' && actionableReviewerRows.length > 0) {
                    event.preventDefault()
                    setActiveReviewerIndex(
                      (current) =>
                        (current - 1 + actionableReviewerRows.length) %
                        actionableReviewerRows.length
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
                }}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek">
              {reviewerMetadata.loading ? (
                <div className="px-3 py-2 text-[13px] text-muted-foreground">
                  {translate('auto.components.GitHubItemDialog.a98433e73d', 'Loading...')}
                </div>
              ) : filteredReviewerCandidates.length > 0 ? (
                <>
                  {suggestedReviewerRows.length > 0 ? (
                    <>
                      <div className="border-b border-border/70 bg-muted/50 px-3 py-1.5 text-[12px] font-semibold text-foreground">
                        {translate('auto.components.GitHubItemDialog.c2b21818e1', 'Suggestions')}
                      </div>
                      {suggestedReviewerRows.map((reviewer, index) =>
                        renderReviewerPickerRow(reviewer, {
                          suggested: true,
                          activeIndex: index
                        })
                      )}
                    </>
                  ) : null}
                  <div className="border-b border-border/70 bg-muted/50 px-3 py-1.5 text-[12px] font-semibold text-foreground">
                    {translate('auto.components.GitHubItemDialog.1ffce94a8b', 'Everyone else')}
                  </div>
                  {everyoneElseReviewerRows.length > 0 ? (
                    everyoneElseReviewerRows.map((reviewer, index) =>
                      renderReviewerPickerRow(reviewer, {
                        suggested: false,
                        activeIndex: suggestedReviewerRows.length + index
                      })
                    )
                  ) : (
                    <div className="px-3 py-2 text-[13px] text-muted-foreground">
                      {translate(
                        'auto.components.GitHubItemDialog.70e84e3d0b',
                        'No matching reviewers.'
                      )}
                    </div>
                  )}
                </>
              ) : (
                <div className="px-3 py-2 text-[13px] text-muted-foreground">
                  {reviewerMetadata.error ??
                    (hasReviewerMetadata
                      ? translate(
                          'auto.components.GitHubItemDialog.70e84e3d0b',
                          'No matching reviewers.'
                        )
                      : translate(
                          'auto.components.GitHubItemDialog.3f79ffc8b7',
                          'Open the PR details to view current reviewers.'
                        ))}
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>
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
