import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  CircleDashed,
  CircleDot,
  Copy,
  ExternalLink,
  FileText,
  FolderKanban,
  ListChecks,
  LoaderCircle,
  MessageSquare,
  Plus,
  RefreshCw
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useAllWorktrees } from '@/store/selectors'
import { lookupGitHubWorkItemDetailsForSource } from '@/lib/github-work-item-source-lookup'
import { canUseGitHubRepoContext } from '@/lib/github-source-runtime-context'
import {
  clearGitHubLinkCopied,
  createGitHubLinkCopyState,
  markGitHubLinkCopied,
  resolveGitHubLinkCopyState
} from '@/components/github-link-copy-state'
import {
  findGithubIssueWorkspaceAttachment,
  getGithubWorkItemWorkspaceAttachmentLabel
} from '@/lib/github-work-item-workspace-attachment'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { translate } from '@/i18n/i18n'
import { getTaskSourceCacheScope } from '../../../shared/task-source-context'
import { parseOwnerRepoFromItemUrl } from '@/components/github-work-item-display'
import type {
  GitHubPRFileViewedState,
  GitHubWorkItem,
  GitHubWorkItemDetails,
  PRComment
} from '../../../shared/types'
import {
  normalizeItemDialogTab,
  resolvePullRequestRepo,
  WorkItemStateBadge,
  type GitHubItemDialogProjectOrigin,
  type GitHubItemDialogProps,
  type ItemDialogTab
} from './github-item-dialog-model'
import {
  getWorkItemDetailsCacheKey,
  invalidateWorkItemDetailsCacheForKey,
  patchCachedPRChecks,
  patchCachedPRFileViewedState,
  patchCachedPRReviewRequests,
  patchCachedWorkItemBody,
  subscribeWorkItemDetailsCache,
  touchWorkItemDetailsCache,
  invalidateWorkItemDetailsCacheByMatch,
  workItemDetailsCache,
  workItemDetailsCacheGeneration,
  type WorkItemDetailsCacheEntry,
  WORK_ITEM_DETAILS_FRESH_MS,
  WORK_ITEM_DETAILS_UNAVAILABLE_MESSAGE
} from './github-item-dialog-cache'
import { ChecksTab } from './github-item-dialog-checks'
import { ConversationTab } from './github-item-dialog-conversation'
import { GHEditSection } from './github-item-dialog-edit'
import { PRFilesCombinedDiffViewer } from './github-item-dialog-files'
import { WorkItemIssueSourceIndicator } from './github-item-dialog-source-indicator'
import { GitHubItemDialogContent } from './github-item-dialog-content'

export type { GitHubItemDialogProjectOrigin, ItemDialogTab } from './github-item-dialog-model'
export { invalidateWorkItemDetailsCacheForKey } from './github-item-dialog-cache'
export default function GitHubItemDialog({
  workItem,
  repoPath,
  repoId,
  sourceContext,
  initialTab,
  backLabel = 'Back',
  projectOrigin,
  onUse,
  onReviewRequestsChange,
  onClose
}: GitHubItemDialogProps): React.JSX.Element {
  const workItemId = workItem?.id
  const [tab, setTab] = useState<ItemDialogTab>(() => normalizeItemDialogTab(workItem, initialTab))
  const [localState, setLocalState] = useState<GitHubWorkItem['state']>(workItem?.state ?? 'open')
  const [localLabels, setLocalLabels] = useState<string[]>(workItem?.labels ?? [])
  const [linkCopyState, setLinkCopyState] = useState(() => createGitHubLinkCopyState(workItemId))
  const resolvedLinkCopyState = resolveGitHubLinkCopyState(linkCopyState, workItemId)
  if (resolvedLinkCopyState !== linkCopyState) {
    // Why: switching items must not paint a stale "copied" indicator from the previous item.
    setLinkCopyState(resolvedLinkCopyState)
  }
  const linkCopied = resolvedLinkCopyState.copied
  const workItemState = workItem?.state
  const workItemLabels = workItem?.labels
  const effectiveRepoId = repoId ?? workItem?.repoId ?? null
  const allWorktrees = useAllWorktrees()
  const issueAttachedWorkspace = useMemo(
    () =>
      workItem?.type === 'issue'
        ? findGithubIssueWorkspaceAttachment(allWorktrees, effectiveRepoId, workItem.number)
        : null,
    [allWorktrees, effectiveRepoId, workItem]
  )
  const issueAttachedWorkspaceLabel = issueAttachedWorkspace
    ? getGithubWorkItemWorkspaceAttachmentLabel(issueAttachedWorkspace)
    : null
  const handleOpenOrUseIssueWorkspace = useCallback(
    (item: GitHubWorkItem): void => {
      const currentAttached = findGithubIssueWorkspaceAttachment(
        useAppStore.getState().allWorktrees(),
        effectiveRepoId,
        item.number
      )
      if (!currentAttached) {
        onUse(item)
        return
      }
      const result = activateAndRevealWorktree(currentAttached.id)
      if (result === false) {
        toast.error(
          translate(
            'auto.components.GitHubItemDialog.2ef631437e',
            'Unable to open the workspace attached to this issue.'
          )
        )
      }
    },
    [effectiveRepoId, onUse]
  )
  // Why: the cache key must include issue source preference so toggling origin/upstream for the same issue number doesn't read the wrong repo's details.
  const issueSourcePreference = useAppStore((s) => {
    if (!repoPath && !effectiveRepoId) {
      return undefined
    }
    return s.repos.find((r) => (effectiveRepoId ? r.id === effectiveRepoId : r.path === repoPath))
      ?.issueSourcePreference
  })
  const canUseDetailsRepoContext = canUseGitHubRepoContext(repoPath, sourceContext)
  const detailsCacheKey = useMemo(() => {
    if (!workItem || !effectiveRepoId || !canUseDetailsRepoContext) {
      return null
    }
    return getWorkItemDetailsCacheKey({
      repoPath: repoPath ?? '',
      repoId: effectiveRepoId,
      issueSourcePreference,
      sourceCacheScope:
        sourceContext?.provider === 'github' ? getTaskSourceCacheScope(sourceContext) : null,
      type: workItem.type,
      number: workItem.number
    })
  }, [
    canUseDetailsRepoContext,
    repoPath,
    effectiveRepoId,
    sourceContext,
    workItem,
    issueSourcePreference
  ])
  // Why: hold comments added before the detail fetch resolves so they merge into the result instead of being overwritten.
  const optimisticCommentsRef = useRef<PRComment[]>([])
  // Why: distinguish "reopen same item" from "switch item" — reopen must keep optimistic comments since gh's 60s cache omits the just-posted one.
  const prevItemIdRef = useRef<string | null>(null)
  // Why: a just-closed Radix overlay can leave `pointer-events: none` on <body>, killing header button clicks; poll a few frames to clear it.
  useEffect(() => {
    if (!workItem) {
      return
    }
    let cancelled = false
    let count = 0
    let frameId: number | null = null
    const tick = (): void => {
      frameId = null
      if (cancelled) {
        return
      }
      if (document.body.style.pointerEvents === 'none') {
        document.body.style.pointerEvents = ''
      }
      if (count++ < 5) {
        frameId = requestAnimationFrame(tick)
      }
    }
    tick()
    return () => {
      cancelled = true
      if (frameId !== null) {
        cancelAnimationFrame(frameId)
      }
    }
  }, [workItem])
  // Why: subscribe to the module-level cache so reopening a cached item paints synchronously on first render.
  const cachedEntry = useSyncExternalStore(
    subscribeWorkItemDetailsCache,
    useCallback(
      () => (detailsCacheKey ? workItemDetailsCache.get(detailsCacheKey) : undefined),
      [detailsCacheKey]
    )
  )
  // Why: bumped on cold open (no cached details yet) so the details memo re-runs and surfaces the optimistic comment before the fetch lands.
  const [optimisticTick, setOptimisticTick] = useState(0)
  // Why: key off cachedEntry identity (stable), not the optimistic ref array (fresh each render), to avoid needless recompute.
  const details = useMemo<GitHubWorkItemDetails | null>(() => {
    const cachedDetails = cachedEntry?.details ?? null
    const opt = optimisticCommentsRef.current
    if (!cachedDetails) {
      // Why: on cold open, details may still be loading — surface optimistic comments via a minimal shell so a pre-fetch comment isn't invisible.
      if (opt.length > 0 && workItem) {
        return { item: workItem, body: '', comments: [...opt] }
      }
      return null
    }
    if (opt.length === 0) {
      return cachedDetails
    }
    const ids = new Set(cachedDetails.comments.map((c) => c.id))
    const missing = opt.filter((c) => !ids.has(c.id))
    if (missing.length === 0) {
      return cachedDetails
    }
    return {
      ...cachedDetails,
      comments: [...cachedDetails.comments, ...missing]
    }
    // Why: optimisticTick forces this ref-reading memo to re-run on cold-open writes; lint can't see the dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cachedEntry, workItem, optimisticTick])
  const resolvedWorkItemState = details?.item.state ?? workItemState
  // Why: the opening list row can be stale; the detail payload has authoritative state, so refresh the local edit UI from it.
  useEffect(() => {
    if (resolvedWorkItemState) {
      setLocalState(resolvedWorkItemState)
    }
    if (workItemLabels) {
      setLocalLabels(workItemLabels)
    }
  }, [workItemId, resolvedWorkItemState, workItemLabels])
  const loading = !!cachedEntry?.pending && !cachedEntry?.details
  const error = cachedEntry?.error && !cachedEntry?.details ? cachedEntry.error : null
  const detailsLoaded = Boolean(cachedEntry?.details)
  // Why: if a cross-window mutation invalidates the open drawer's entry (cachedEntry undefined, fetch deps unchanged), bump a tick to force the refetch.
  const [refetchTick, setRefetchTick] = useState(0)
  useEffect(() => {
    if (workItem && detailsCacheKey && !cachedEntry) {
      setRefetchTick((n) => n + 1)
    }
  }, [workItem, detailsCacheKey, cachedEntry])
  useEffect(() => {
    if (!workItem || !effectiveRepoId || !detailsCacheKey || !canUseDetailsRepoContext) {
      return
    }
    // Why: clear optimistic comments only on item switch — on reopen, gh's 60s cache omits the just-posted comment, so keep the ref to re-merge.
    if (workItem.id !== prevItemIdRef.current) {
      optimisticCommentsRef.current = []
    }
    prevItemIdRef.current = workItem.id
    setTab(normalizeItemDialogTab(workItem, initialTab))
    const cached = workItemDetailsCache.get(detailsCacheKey)
    const now = Date.now()
    const hasFreshData = cached?.details && now - cached.fetchedAt <= WORK_ITEM_DETAILS_FRESH_MS
    if (hasFreshData) {
      return
    }
    // Why: dedupe concurrent opens for the same key — share one in-flight promise instead of racing two `gh` subprocesses.
    const inflight: Promise<GitHubWorkItemDetails | null> =
      cached?.pending ??
      lookupGitHubWorkItemDetailsForSource({
        repoPath: repoPath ?? '',
        repoId: effectiveRepoId,
        sourceContext,
        number: workItem.number,
        type: workItem.type
      })
    // Why: snapshot the invalidation generation; if it advances before resolve, a mid-flight mutation invalidated the entry — don't write back.
    const launchedAtGeneration = workItemDetailsCacheGeneration
    if (!cached?.pending) {
      touchWorkItemDetailsCache(detailsCacheKey, {
        details: cached?.details ?? null,
        fetchedAt: cached?.fetchedAt ?? 0,
        pending: inflight,
        error: cached?.error
      })
    }
    inflight
      .then((result) => {
        const invalidatedMidFlight = workItemDetailsCacheGeneration !== launchedAtGeneration
        const prev = workItemDetailsCache.get(detailsCacheKey)
        if (invalidatedMidFlight && prev?.pending !== inflight) {
          // Why: entry was deliberately dropped (or later repopulated) — don't recreate or touch it.
          return
        }
        // Why: null means unavailable/not found, not loaded empty content.
        if (result === null && prev?.details) {
          touchWorkItemDetailsCache(detailsCacheKey, {
            details: prev.details,
            fetchedAt: prev.fetchedAt,
            error: undefined
          })
        } else if (result === null) {
          touchWorkItemDetailsCache(detailsCacheKey, {
            details: null,
            fetchedAt: 0,
            error: WORK_ITEM_DETAILS_UNAVAILABLE_MESSAGE
          })
        } else {
          touchWorkItemDetailsCache(detailsCacheKey, {
            details: result,
            fetchedAt: Date.now(),
            error: undefined
          })
        }
      })
      .catch((err) => {
        const message = err instanceof Error ? err.message : 'Failed to load details'
        const invalidatedMidFlight = workItemDetailsCacheGeneration !== launchedAtGeneration
        const prev = workItemDetailsCache.get(detailsCacheKey)
        if (invalidatedMidFlight && prev?.pending !== inflight) {
          return
        }
        // Why: stale-on-error — keep cached data, drop the pending promise so next open retries; show the error only when nothing is cached.
        touchWorkItemDetailsCache(detailsCacheKey, {
          details: prev?.details ?? null,
          fetchedAt: prev?.fetchedAt ?? 0,
          error: message
        })
      })
  }, [
    canUseDetailsRepoContext,
    repoPath,
    effectiveRepoId,
    sourceContext,
    workItem,
    detailsCacheKey,
    initialTab,
    refetchTick
  ])
  const displayWorkItem = useMemo<GitHubWorkItem | null>(() => {
    if (!workItem) {
      return null
    }
    if (!details?.item) {
      return workItem
    }
    return { ...workItem, ...details.item, repoId: workItem.repoId }
  }, [details?.item, workItem])

  useEffect(() => {
    if (!workItem || details?.item.reviewRequests === undefined) {
      return
    }
    // Why: PR details can carry fresher reviewer metadata than the list row; push it back so the Tasks review chip isn't stale.
    onReviewRequestsChange?.(
      { id: workItem.id, repoId: workItem.repoId },
      details.item.reviewRequests
    )
  }, [details?.item.reviewRequests, onReviewRequestsChange, workItem])

  const body = details?.body ?? ''
  const comments = details?.comments ?? []
  const timelineItems = details?.timelineItems ?? []
  const files = details?.files ?? []
  const filesUnavailable = details?.filesUnavailable ?? false
  const checks = details?.checks ?? []
  const [pendingViewedPaths, setPendingViewedPaths] = useState<Set<string>>(() => new Set())
  // Why: clipboard IPC can resolve after unmount; skip copied-state feedback rather than start a reset timer on a stale surface.
  const linkCopyMountedRef = useRef(false)
  const linkCopiedResetTimerRef = useRef<number | null>(null)
  const clearLinkCopiedResetTimer = useCallback((): void => {
    if (linkCopiedResetTimerRef.current === null) {
      return
    }
    window.clearTimeout(linkCopiedResetTimerRef.current)
    linkCopiedResetTimerRef.current = null
  }, [])
  const setLinkCopyButtonRef = useCallback(
    (node: HTMLButtonElement | null) => {
      linkCopyMountedRef.current = node !== null
      if (node === null) {
        // Why: the copied-state timer belongs to this control; clear it on detach without a passive cleanup Effect.
        clearLinkCopiedResetTimer()
      }
    },
    [clearLinkCopiedResetTimer]
  )

  const handleCopyWorkItemLink = useCallback(async (): Promise<void> => {
    if (!workItem) {
      return
    }
    try {
      // Why: Electron clipboard IPC works even when browser clipboard APIs lose focus/activation in nested overlays.
      await window.api.ui.writeClipboardText(workItem.url)
      if (!linkCopyMountedRef.current) {
        return
      }
      clearLinkCopiedResetTimer()
      const copiedWorkItemId = workItem.id
      setLinkCopyState(markGitHubLinkCopied(copiedWorkItemId))
      linkCopiedResetTimerRef.current = window.setTimeout(() => {
        linkCopiedResetTimerRef.current = null
        setLinkCopyState((current) => clearGitHubLinkCopied(current, copiedWorkItemId))
      }, 1500)
      toast.success(translate('auto.components.GitHubItemDialog.2e77dc2053', 'GitHub link copied'))
    } catch {
      toast.error(
        translate('auto.components.GitHubItemDialog.5fea151559', 'Failed to copy GitHub link')
      )
    }
  }, [clearLinkCopiedResetTimer, workItem])

  const appendOptimisticComment = useCallback(
    (comment: PRComment) => {
      useAppStore.getState().recordFeatureInteraction('github-tasks')
      // Why: skip refreshDetails() — gh's 60s cache would overwrite the optimistic comment; next open picks up the server version.
      optimisticCommentsRef.current.push(comment)
      // Why: write through the module cache so concurrent drawers re-render; mark fetchedAt stale (0) so next open refetches server fields.
      if (detailsCacheKey) {
        const prev = workItemDetailsCache.get(detailsCacheKey)
        if (prev?.details) {
          const ids = new Set(prev.details.comments.map((c) => c.id))
          if (!ids.has(comment.id)) {
            touchWorkItemDetailsCache(detailsCacheKey, {
              details: {
                ...prev.details,
                comments: [...prev.details.comments, comment]
              },
              fetchedAt: 0,
              error: undefined
            })
            return
          }
        }
      }
      // Why: no cache write fires while details are still loading; bump local state so the memo re-runs and shows the optimistic comment.
      setOptimisticTick((n) => n + 1)
    },
    [detailsCacheKey]
  )

  const invalidateCurrentDetailsCache = useCallback((): void => {
    if (!workItem) {
      return
    }
    // Why: local repos invalidate all source-pref variants; runtime-only entries need their exact source-scoped key (no local path).
    if (repoPath) {
      invalidateWorkItemDetailsCacheByMatch({
        repoPath,
        repoId: effectiveRepoId ?? undefined,
        type: workItem.type,
        number: workItem.number
      })
      return
    }
    if (detailsCacheKey) {
      invalidateWorkItemDetailsCacheForKey(detailsCacheKey)
    }
  }, [detailsCacheKey, effectiveRepoId, repoPath, workItem])

  const handlePRFileViewedChange = useCallback(
    async (path: string, viewed: boolean): Promise<boolean> => {
      if (
        !canUseDetailsRepoContext ||
        !details?.pullRequestId ||
        !workItem ||
        workItem.type !== 'pr'
      ) {
        toast.error(
          translate(
            'auto.components.GitHubItemDialog.c0253318d6',
            'Unable to sync viewed state for this pull request.'
          )
        )
        return false
      }
      setPendingViewedPaths((prev) => new Set(prev).add(path))
      const nextState: GitHubPRFileViewedState = viewed ? 'VIEWED' : 'UNVIEWED'
      const previousState = detailsCacheKey
        ? patchCachedPRFileViewedState(detailsCacheKey, path, nextState)
        : undefined
      try {
        const ok = await setPRFileViewedForRepo({
          repoId: workItem.repoId,
          repoPath: repoPath ?? '',
          sourceContext,
          prNumber: workItem.number,
          prRepo: resolvePullRequestRepo(workItem, projectOrigin),
          pullRequestId: details.pullRequestId,
          path,
          viewed
        })
        if (!ok) {
          if (detailsCacheKey && previousState) {
            patchCachedPRFileViewedState(detailsCacheKey, path, previousState)
          }
          toast.error(
            translate(
              'auto.components.GitHubItemDialog.b7bf31b8de',
              'Failed to sync viewed state with GitHub.'
            )
          )
          return false
        }
        return true
      } finally {
        setPendingViewedPaths((prev) => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
      }
    },
    [
      canUseDetailsRepoContext,
      details?.pullRequestId,
      detailsCacheKey,
      projectOrigin,
      repoPath,
      sourceContext,
      workItem
    ]
  )

  const isIssuePage = workItem?.type === 'issue'
  const ownerRepo = workItem ? parseOwnerRepoFromItemUrl(workItem.url) : null
  const issueStateBadgeTone =
    localState === 'closed' ? 'bg-rose-600 text-white' : 'bg-emerald-600 text-white'

  return (
    // Why: rendered inline (not a Radix dialog), so e2e needs a stable hook to scope assertions to this detail surface.
    <div
      data-testid="github-item-detail"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-sm"
    >
      <GitHubItemDialogContent
        workItem={workItem!}
        isIssuePage={isIssuePage}
        ownerRepo={ownerRepo}
        issueStateBadgeTone={issueStateBadgeTone}
        localState={localState}
        localLabels={localLabels}
        linkCopied={linkCopied}
        backLabel={backLabel}
        issueAttachedWorkspace={issueAttachedWorkspace}
        issueAttachedWorkspaceLabel={issueAttachedWorkspaceLabel}
        effectiveRepoId={effectiveRepoId}
        repoPath={repoPath}
        projectOrigin={projectOrigin}
        sourceContext={sourceContext}
        canUseDetailsRepoContext={canUseDetailsRepoContext}
        details={details ?? null}
        displayWorkItem={displayWorkItem}
        body={body}
        comments={comments}
        timelineItems={timelineItems}
        files={files}
        checks={checks}
        headSha={details?.headSha}
        baseSha={details?.baseSha}
        loading={loading}
        detailsLoaded={detailsLoaded}
        filesUnavailable={filesUnavailable}
        pendingViewedPaths={pendingViewedPaths}
        detailsCacheKey={detailsCacheKey}
        error={error}
        tab={tab}
        setTab={setTab}
        setLinkCopyButtonRef={setLinkCopyButtonRef}
        handleCopyWorkItemLink={handleCopyWorkItemLink}
        handleOpenOrUseIssueWorkspace={handleOpenOrUseIssueWorkspace}
        onUse={onUse}
        onClose={onClose}
        setLocalState={setLocalState}
        setLocalLabels={setLocalLabels}
        invalidateCurrentDetailsCache={invalidateCurrentDetailsCache}
        appendOptimisticComment={appendOptimisticComment}
        handlePRFileViewedChange={handlePRFileViewedChange}
        onReviewRequestsChange={onReviewRequestsChange}
      />
    </div>
  )
}
