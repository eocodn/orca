import React, { useCallback, useMemo, useState } from 'react'
import { Check, CircleDashed, ExternalLink, LoaderCircle, RefreshCw, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useMountedRef } from '@/hooks/useMountedRef'
import { useImmediateMutation } from '@/hooks/useIssueMetadata'
import { useAppStore } from '@/store'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  getGitHubRuntimeRepoId,
  getGitHubSourceRuntimeHost
} from '@/lib/github-source-runtime-context'
import { translate } from '@/i18n/i18n'
import { CHECK_COLOR, CHECK_ICON } from '@/components/right-sidebar/checks-panel-content'
import { sortChecksBySeverity } from '../../../shared/pr-check-severity-order'
import { getCheckConclusion, getCheckCounts, getChecksSummaryLabel } from '@/components/pr-check-counts'
import { startFixChecksAgent } from '@/lib/fix-checks-agent-launch'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { buildFixBrokenChecksPrompt, getBrokenChecks } from '@/components/pr-checks-fix-prompt'
import { resolvePullRequestRepo } from './github-item-dialog-model'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { GitHubWorkItem, GitHubWorkItemDetails, PRCheckDetail } from '../../../shared/types'

function getCheckStatusLabel(check: PRCheckDetail): string {
  const conclusion = getCheckConclusion(check)
  if (conclusion === 'success') {
    return 'Successful'
  }
  if (conclusion === 'failure') {
    return 'Failed'
  }
  if (conclusion === 'cancelled') {
    return 'Cancelled'
  }
  if (conclusion === 'timed_out') {
    return 'Timed out'
  }
  if (conclusion === 'action_required') {
    return 'Action required'
  }
  if (conclusion === 'neutral') {
    return 'Neutral'
  }
  if (conclusion === 'skipped') {
    return 'Skipped'
  }
  if (check.status === 'queued') {
    return 'Queued'
  }
  if (check.status === 'in_progress') {
    return 'In progress'
  }
  return 'Pending'
}

function getCheckDetailsKey(check: PRCheckDetail): string {
  return String(check.checkRunId ?? check.workflowRunId ?? check.url ?? check.name)
}

function formatCheckTimestamp(input: string | null | undefined): string | null {
  if (!input) {
    return null
  }
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

export function ChecksTab({
  item,
  repoPath,
  repoId,
  sourceContext,
  headSha,
  checks,
  loading,
  variant = 'compact',
  onChecksUpdated
}: {
  item: GitHubWorkItem
  repoPath: string | null
  repoId: string | null
  sourceContext?: TaskSourceContext | null
  headSha: string | undefined
  checks: GitHubWorkItemDetails['checks']
  loading: boolean
  variant?: 'compact' | 'page'
  onChecksUpdated: (checks: PRCheckDetail[]) => void
}): React.JSX.Element {
  const [refreshing, setRefreshing] = useState(false)
  const [rerunning, setRerunning] = useState(false)
  const [fixingChecks, setFixingChecks] = useState(false)
  const [checksState, setChecksState] = useState(() => createGitHubChecksTabState(checks))
  const mountedRef = useMountedRef()
  const resolvedChecksState = resolveGitHubChecksTabState(checksState, checks)
  if (resolvedChecksState !== checksState) {
    // Why: a parent check refresh replaces the source list; reset local state before stale rows/details can paint.
    setChecksState(resolvedChecksState)
  }
  const { localChecks, expandedCheckKey, detailsByCheckKey } = resolvedChecksState
  const list = useMemo(() => localChecks ?? checks ?? [], [checks, localChecks])
  const prRepo = useMemo(() => resolvePullRequestRepo(item), [item])
  const runtimeHost = getGitHubSourceRuntimeHost(sourceContext)
  const canUseChecksRepoContext = canUseGitHubRepoContext(repoPath, sourceContext)
  const sorted = sortChecksBySeverity(list)
  const failedChecks = getBrokenChecks(list)
  const counts = getCheckCounts(list)
  const summaryLabel = getChecksSummaryLabel(list)
  // Why: keying the green tick off `list.length` painted an all-neutral PR green above the words
  // "0 of N checks passing"; nothing passed, so it reads unresolved like the checks pill does.
  const SummaryIcon =
    counts.failing > 0
      ? CHECK_ICON.failure
      : counts.needsAction > 0
        ? CHECK_ICON.action_required
        : counts.pending > 0
          ? CHECK_ICON.pending
          : counts.passing > 0
            ? CHECK_ICON.success
            : CircleDashed
  const summaryColor =
    counts.failing > 0
      ? CHECK_COLOR.failure
      : counts.needsAction > 0
        ? CHECK_COLOR.action_required
        : counts.pending > 0
          ? CHECK_COLOR.pending
          : counts.passing > 0
            ? CHECK_COLOR.success
            : 'text-muted-foreground'
  const canFixBrokenChecks = Boolean((repoId ?? item.repoId) && failedChecks.length > 0)

  const handleRefresh = useCallback(async (): Promise<PRCheckDetail[] | null> => {
    if (!canUseChecksRepoContext) {
      toast.error(
        translate(
          'auto.components.GitHubItemDialog.e7007aa1d8',
          'Unable to refresh checks without a repository path.'
        )
      )
      return null
    }
    setRefreshing(true)
    try {
      const nextChecks = (await (runtimeHost
        ? callRuntimeRpc<PRCheckDetail[]>(
            { kind: 'environment', environmentId: runtimeHost.environmentId },
            'github.prChecks',
            {
              repo: getGitHubRuntimeRepoId(sourceContext, repoId ?? item.repoId),
              prNumber: item.number,
              headSha,
              prRepo,
              noCache: true
            },
            { timeoutMs: 30_000 }
          )
        : window.api.gh.prChecks({
            repoPath: repoPath ?? '',
            repoId: repoId ?? undefined,
            sourceContext,
            prNumber: item.number,
            headSha,
            prRepo,
            noCache: true
          }))) as PRCheckDetail[]
      setChecksState((current) => updateGitHubChecksTabLocalChecks(current, nextChecks))
      onChecksUpdated(nextChecks)
      return nextChecks
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : translate('auto.components.GitHubItemDialog.0bbdc673c1', 'Failed to refresh checks')
      )
      return null
    } finally {
      setRefreshing(false)
    }
  }, [
    canUseChecksRepoContext,
    headSha,
    item.number,
    item.repoId,
    onChecksUpdated,
    runtimeHost,
    prRepo,
    repoId,
    repoPath,
    sourceContext
  ])

  const handleRerun = useCallback(
    async (failedOnly: boolean): Promise<void> => {
      if (!canUseChecksRepoContext || rerunning) {
        return
      }
      setRerunning(true)
      try {
        const result = runtimeHost
          ? await callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.rerunPRChecks>>>(
              { kind: 'environment', environmentId: runtimeHost.environmentId },
              'github.rerunPRChecks',
              {
                repo: getGitHubRuntimeRepoId(sourceContext, repoId ?? item.repoId),
                prNumber: item.number,
                headSha,
                failedOnly,
                prRepo
              },
              { timeoutMs: 30_000 }
            )
          : await window.api.gh.rerunPRChecks({
              repoPath: repoPath ?? '',
              repoId: repoId ?? undefined,
              sourceContext,
              prNumber: item.number,
              headSha,
              failedOnly,
              prRepo
            })
        if (!result.ok) {
          toast.error(result.error)
          return
        }
        toast.success(
          result.count === 1
            ? translate('auto.components.GitHubItemDialog.ddafe851e1', 'Check rerun requested')
            : translate('auto.components.GitHubItemDialog.e463ec935f', 'Check reruns requested')
        )
        await handleRefresh()
      } catch (err) {
        toast.error(
          err instanceof Error
            ? err.message
            : translate('auto.components.GitHubItemDialog.9e7c221b8d', 'Failed to rerun checks')
        )
      } finally {
        setRerunning(false)
      }
    },
    [
      canUseChecksRepoContext,
      handleRefresh,
      headSha,
      item.number,
      item.repoId,
      prRepo,
      runtimeHost,
      rerunning,
      repoId,
      repoPath,
      sourceContext
    ]
  )

  const handleFixBrokenChecks = useCallback(async (): Promise<void> => {
    const targetRepoId = repoId ?? item.repoId
    if (!targetRepoId || fixingChecks) {
      return
    }
    if (failedChecks.length === 0) {
      toast.message(
        translate('auto.components.GitHubItemDialog.1690fd7f4a', 'No broken checks to fix.')
      )
      return
    }

    const basePrompt = buildFixBrokenChecksPrompt({
      reviewKind: 'PR',
      reviewNumber: item.number,
      reviewTitle: item.title,
      reviewUrl: item.url,
      checks: list
    })
    setFixingChecks(true)
    try {
      const started = await startFixChecksAgent({
        item,
        repoId: targetRepoId,
        basePrompt,
        launchSource: 'task_page',
        telemetrySource: 'sidebar',
        openModalFallback: () => {
          toast.error(
            translate(
              'auto.components.GitHubItemDialog.06482d6190',
              'Unable to create a fix workspace automatically.'
            )
          )
        }
      })
      if (started) {
        toast.success(
          translate(
            'auto.components.GitHubItemDialog.28986b3747',
            'Started an AI agent for the broken checks.'
          )
        )
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error('Failed to start fix checks agent', err)
      toast.error(
        translate(
          'auto.components.GitHubItemDialog.03e542fcfe',
          'Failed to start an AI agent for the broken checks: {{value0}}',
          { value0: message }
        )
      )
    } finally {
      setFixingChecks(false)
    }
  }, [failedChecks.length, fixingChecks, item, list, repoId])

  const handleToggleCheckDetails = useCallback(
    (check: PRCheckDetail): void => {
      const key = getCheckDetailsKey(check)
      setChecksState((current) => toggleGitHubChecksTabExpandedKey(current, key))
      if (
        !canUseChecksRepoContext ||
        detailsByCheckKey[key] ||
        (!check.checkRunId && !check.workflowRunId && !check.url)
      ) {
        return
      }
      setChecksState((current) =>
        updateGitHubChecksTabDetails(current, key, {
          loading: true,
          details: null,
          error: null
        })
      )
      const detailsRequest = runtimeHost
        ? callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.prCheckDetails>>>(
            { kind: 'environment', environmentId: runtimeHost.environmentId },
            'github.prCheckDetails',
            {
              repo: getGitHubRuntimeRepoId(sourceContext, repoId ?? item.repoId),
              checkRunId: check.checkRunId,
              workflowRunId: check.workflowRunId,
              checkName: check.name,
              url: check.url,
              prRepo
            },
            { timeoutMs: 30_000 }
          )
        : window.api.gh.prCheckDetails({
            repoPath: repoPath ?? '',
            repoId: repoId ?? undefined,
            sourceContext,
            checkRunId: check.checkRunId,
            workflowRunId: check.workflowRunId,
            checkName: check.name,
            url: check.url,
            prRepo
          })
      void detailsRequest
        .then((details) => {
          if (!mountedRef.current) {
            return
          }
          setChecksState((current) =>
            updateGitHubChecksTabDetails(current, key, {
              loading: false,
              details,
              error: details ? null : 'No inline details are available for this check.'
            })
          )
        })
        .catch((err) => {
          if (!mountedRef.current) {
            return
          }
          setChecksState((current) =>
            updateGitHubChecksTabDetails(current, key, {
              loading: false,
              details: null,
              error: err instanceof Error ? err.message : 'Failed to load check details.'
            })
          )
        })
    },
    [
      canUseChecksRepoContext,
      detailsByCheckKey,
      item.repoId,
      mountedRef,
      runtimeHost,
      prRepo,
      repoId,
      repoPath,
      sourceContext
    ]
  )

  const refreshAction = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-7 shrink-0"
          disabled={!canUseChecksRepoContext || refreshing}
          onClick={() => void handleRefresh()}
          aria-label={translate('auto.components.GitHubItemDialog.9a1004fc76', 'Refresh checks')}
        >
          <RefreshCw className={cn('size-3.5', refreshing && 'animate-spin')} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {translate('auto.components.GitHubItemDialog.9a1004fc76', 'Refresh checks')}
      </TooltipContent>
    </Tooltip>
  )
  const fixBrokenChecksAction =
    failedChecks.length > 0 || fixingChecks ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={!canFixBrokenChecks || fixingChecks}
            onClick={() => void handleFixBrokenChecks()}
          >
            {fixingChecks ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <Wrench className="size-3" />
            )}
            {variant === 'compact'
              ? translate('auto.components.GitHubItemDialog.9157d48ddb', 'Fix checks')
              : translate('auto.components.GitHubItemDialog.2511f44bb7', 'Fix broken checks')}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {translate(
            'auto.components.GitHubItemDialog.f4b1292569',
            'Start the default AI agent on these checks'
          )}
        </TooltipContent>
      </Tooltip>
    ) : null
  const rerunAction =
    list.length > 0 || rerunning ? (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="h-7 gap-1 px-2 text-[11px]"
            disabled={!canUseChecksRepoContext || rerunning || list.length === 0}
          >
            {rerunning ? (
              <LoaderCircle className="size-3 animate-spin" />
            ) : (
              <RefreshCw className="size-3" />
            )}
            {translate('auto.components.GitHubItemDialog.1b56e28faa', 'Rerun')}
            <ChevronDown className="size-3 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem
            disabled={failedChecks.length === 0 || rerunning}
            onSelect={() => void handleRerun(true)}
          >
            <RefreshCw className="size-4" />
            {translate('auto.components.GitHubItemDialog.e31651a224', 'Rerun failed checks')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={rerunning} onSelect={() => void handleRerun(false)}>
            <RefreshCw className="size-4" />
            {translate('auto.components.GitHubItemDialog.71c11aff84', 'Rerun all checks')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : null
  const secondaryActions =
    variant === 'compact' && !fixBrokenChecksAction ? null : fixBrokenChecksAction ||
      rerunAction ? (
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
        {fixBrokenChecksAction}
        {variant === 'page' ? rerunAction : null}
      </div>
    ) : null
  const actions = (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
      {refreshAction}
      {fixBrokenChecksAction}
      {rerunAction}
    </div>
  )
  const compactHeader = (
    <div className="border-b border-border/50 px-3 py-2">
      <div className="flex min-w-0 items-start gap-2">
        <div className="flex min-w-0 flex-1 items-start gap-2">
          <SummaryIcon
            className={cn(
              'mt-0.5 size-3.5 shrink-0',
              summaryColor,
              counts.pending > 0 && counts.failing === 0 && 'animate-spin'
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-medium leading-5 text-foreground">
              {translate('auto.components.GitHubItemDialog.4bd1f5b055', 'Checks')}
            </div>
            {list.length > 0 && (
              <div className="truncate text-[11px] leading-4 text-muted-foreground">
                {summaryLabel}
              </div>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {refreshAction}
          {list.length > 0 && (
            <div className="[&_button]:h-7 [&_button]:px-2 [&_button]:text-[11px]">
              {rerunAction}
            </div>
          )}
        </div>
      </div>
      {secondaryActions ? (
        <div className="mt-2 flex min-w-0 justify-end">{secondaryActions}</div>
      ) : null}
    </div>
  )

  const renderCheckRow = (check: PRCheckDetail): React.JSX.Element => {
    const conclusion = getCheckConclusion(check)
    const Icon = CHECK_ICON[conclusion] ?? CircleDashed
    const color = CHECK_COLOR[conclusion] ?? 'text-muted-foreground'
    const statusLabel = getCheckStatusLabel(check)
    const key = getCheckDetailsKey(check)
    const expanded = expandedCheckKey === key
    const detailsState = detailsByCheckKey[key]
    return (
      <div key={key} className="min-w-0">
        <button
          type="button"
          onClick={() => handleToggleCheckDetails(check)}
          aria-expanded={expanded}
          className={cn(
            'flex w-full min-w-0 items-center gap-2 rounded-md text-left transition',
            variant === 'page' ? 'px-3 py-2.5 hover:bg-accent/60' : 'px-2 py-1.5 hover:bg-muted/40'
          )}
        >
          <ChevronDown
            className={cn(
              'size-3 shrink-0 text-muted-foreground transition-transform',
              !expanded && '-rotate-90'
            )}
          />
          <Icon
            className={cn('size-3.5 shrink-0', color, conclusion === 'pending' && 'animate-spin')}
          />
          <span className="min-w-0 flex-1 truncate text-[12px] text-foreground">{check.name}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{statusLabel}</span>
        </button>
        {expanded && renderCheckDetails(check, detailsState)}
      </div>
    )
  }

  const renderCheckDetails = (
    check: PRCheckDetail,
    state: CheckDetailsLoadState | undefined
  ): React.JSX.Element => {
    const details = state?.details
    const openUrl = details?.detailsUrl ?? details?.url ?? check.url
    const startedAt = formatCheckTimestamp(details?.startedAt)
    const completedAt = formatCheckTimestamp(details?.completedAt)
    const detailsStatusCheck: PRCheckDetail = {
      ...check,
      status: (details?.status as PRCheckDetail['status'] | undefined) ?? check.status,
      conclusion:
        (details?.conclusion as PRCheckDetail['conclusion'] | undefined) ?? check.conclusion
    }
    const hasOutput = Boolean(details?.title || details?.summary || details?.text)
    const hasAnnotations = (details?.annotations.length ?? 0) > 0
    const hasJobs = (details?.jobs.length ?? 0) > 0

    return (
      <div className="mx-2 mb-2 mt-1 min-w-0 rounded-md border border-border/50 bg-muted/20 px-3 py-2">
        {state?.loading ? (
          <div className="flex items-center gap-2 py-2 text-[12px] text-muted-foreground">
            <LoaderCircle className="size-3.5 animate-spin" />
            {translate('auto.components.GitHubItemDialog.934d87ab96', 'Loading check details…')}
          </div>
        ) : (
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span>
                {translate('auto.components.GitHubItemDialog.9c3ba11a05', 'Status:')}{' '}
                {details ? getCheckStatusLabel(detailsStatusCheck) : getCheckStatusLabel(check)}
              </span>
              {startedAt && (
                <span>
                  {translate('auto.components.GitHubItemDialog.4812814bc8', 'Started')} {startedAt}
                </span>
              )}
              {completedAt && (
                <span>
                  {translate('auto.components.GitHubItemDialog.0f478f5efa', 'Completed')}{' '}
                  {completedAt}
                </span>
              )}
              {check.checkRunId && (
                <span className="font-mono">
                  {translate('auto.components.GitHubItemDialog.485609c4f2', 'check #')}
                  {check.checkRunId}
                </span>
              )}
            </div>

            {state?.error && <div className="text-[12px] text-muted-foreground">{state.error}</div>}

            {hasOutput && (
              <div className="min-w-0 rounded-md border border-border/40 bg-background/70 px-2.5 py-2">
                {details?.title && (
                  <div className="mb-1 text-[12px] font-medium text-foreground">
                    {details.title}
                  </div>
                )}
                {details?.summary && (
                  <CommentMarkdown
                    content={details.summary}
                    variant="document"
                    className="min-w-0 max-w-full overflow-hidden break-words text-[12px] leading-relaxed [&_a]:break-all [&_code]:break-words [&_pre]:max-w-full"
                  />
                )}
                {details?.text && (
                  <CommentMarkdown
                    content={details.text}
                    variant="document"
                    className="mt-2 min-w-0 max-w-full overflow-hidden break-words text-[12px] leading-relaxed [&_a]:break-all [&_code]:break-words [&_pre]:max-w-full"
                  />
                )}
              </div>
            )}

            {hasAnnotations && (
              <div className="min-w-0 rounded-md border border-border/40 bg-background/70">
                <div className="border-b border-border/40 px-2.5 py-1.5 text-[11px] font-medium text-foreground">
                  {translate('auto.components.GitHubItemDialog.96d8f36798', 'Annotations')}
                </div>
                <div className="flex flex-col">
                  {details!.annotations.map((annotation, index) => (
                    <div
                      key={`${annotation.path ?? 'annotation'}-${index}`}
                      className={cn(
                        'min-w-0 px-2.5 py-2 text-[12px]',
                        index > 0 && 'border-t border-border/30'
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">
                          {annotation.path ??
                            translate('auto.components.GitHubItemDialog.7d42606f66', 'Annotation')}
                          {annotation.startLine ? `:${annotation.startLine}` : ''}
                        </span>
                        {annotation.annotationLevel && (
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {annotation.annotationLevel}
                          </span>
                        )}
                      </div>
                      {annotation.title && (
                        <div className="mt-1 text-[12px] font-medium text-foreground">
                          {annotation.title}
                        </div>
                      )}
                      <div className="mt-1 break-words text-[12px] text-foreground">
                        {annotation.message}
                      </div>
                      {annotation.rawDetails && (
                        <pre className="mt-1 whitespace-pre-wrap rounded bg-muted/40 p-2 font-mono text-[11px] text-muted-foreground">
                          {annotation.rawDetails}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasJobs && (
              <div className="min-w-0 rounded-md border border-border/40 bg-background/70">
                <div className="border-b border-border/40 px-2.5 py-1.5 text-[11px] font-medium text-foreground">
                  {translate('auto.components.GitHubItemDialog.08d072664d', 'Jobs')}
                </div>
                <div className="flex flex-col">
                  {details!.jobs.map((job, index) => (
                    <div
                      key={`${job.name}-${index}`}
                      className={cn(
                        'min-w-0 px-2.5 py-2',
                        index > 0 && 'border-t border-border/30'
                      )}
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-foreground">
                          {job.name}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {job.conclusion ??
                            job.status ??
                            translate('auto.components.GitHubItemDialog.773ff70035', 'unknown')}
                        </span>
                      </div>
                      {job.steps.length > 0 && (
                        <div className="mt-1 grid gap-1">
                          {job.steps.map((step) => (
                            <div
                              key={step.name}
                              className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground"
                            >
                              <span className="min-w-0 flex-1 truncate">{step.name}</span>
                              <span className="shrink-0">{step.conclusion ?? step.status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!state?.error && !hasOutput && !hasAnnotations && !hasJobs && (
              <div className="text-[12px] text-muted-foreground">
                {getCheckConclusion(check) === 'action_required'
                  ? translate(
                      'auto.components.GitHubItemDialog.checkActionRequiredHint',
                      'Needs a manual action on GitHub (e.g. approving the run) to unblock merging.'
                    )
                  : translate(
                      'auto.components.GitHubItemDialog.744197c84d',
                      'No inline output is available for this check.'
                    )}
              </div>
            )}

            {openUrl && (
              <div>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="h-7 gap-1 px-2 text-[11px]"
                  onClick={() => window.api.shell.openUrl(openUrl)}
                >
                  {translate('auto.components.GitHubItemDialog.5dddefdf58', 'Open in GitHub')}
                  <ExternalLink className="size-3" />
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (loading && list.length === 0) {
    return (
      <>
        {variant === 'compact' ? compactHeader : null}
        <div className="flex items-center justify-center py-10">
          <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
        </div>
      </>
    )
  }
  if (list.length === 0) {
    if (variant === 'page') {
      return (
        <div className="flex flex-col gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            <CircleDashed className="size-4 shrink-0 text-muted-foreground" />
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="truncate text-[13px] font-medium text-foreground">
                {translate('auto.components.GitHubItemDialog.ecffebc251', 'No checks found')}
              </span>
              <span className="truncate text-[11px] text-muted-foreground">
                {translate(
                  'auto.components.GitHubItemDialog.90020cc1f3',
                  'This pull request has no reported checks yet.'
                )}
              </span>
            </div>
            {actions}
          </div>
        </div>
      )
    }
    return (
      <>
        {compactHeader}
        <div className="flex flex-col items-center justify-center gap-1 px-4 py-6 text-center">
          <CircleDashed className="size-4 text-muted-foreground/60" />
          <div className="text-[12px] text-muted-foreground">
            {translate('auto.components.GitHubItemDialog.e52bed9264', 'No checks reported yet')}
          </div>
        </div>
      </>
    )
  }
  if (variant === 'page') {
    const countChips: { label: string; className: string }[] = []
    if (counts.passing > 0) {
      countChips.push({
        label: translate('auto.components.GitHubItemDialog.311d0cee55', '{{value0}} passing', {
          value0: counts.passing
        }),
        className: CHECK_COLOR.success
      })
    }
    if (counts.failing > 0) {
      countChips.push({
        label: translate('auto.components.GitHubItemDialog.b1ac991806', '{{value0}} failing', {
          value0: counts.failing
        }),
        className: CHECK_COLOR.failure
      })
    }
    if (counts.needsAction > 0) {
      countChips.push({
        label: translate(
          'auto.components.GitHubItemDialog.checksNeedActionChip',
          '{{value0}} action required',
          {
            value0: counts.needsAction
          }
        ),
        className: CHECK_COLOR.action_required
      })
    }
    if (counts.pending > 0) {
      countChips.push({
        label: translate('auto.components.GitHubItemDialog.18f80e1329', '{{value0}} pending', {
          value0: counts.pending
        }),
        className: CHECK_COLOR.pending
      })
    }
    if (counts.neutral > 0) {
      countChips.push({
        label: translate('auto.components.GitHubItemDialog.d23bbb6416', '{{value0}} skipped', {
          value0: counts.neutral
        }),
        className: 'text-muted-foreground'
      })
    }
    return (
      <div className="flex flex-col gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <SummaryIcon
            className={cn(
              'size-4 shrink-0',
              summaryColor,
              counts.pending > 0 && counts.failing === 0 && 'animate-spin'
            )}
          />
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="truncate text-[13px] font-medium text-foreground">{summaryLabel}</span>
            {countChips.length > 1 && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {countChips.map((chip, i) => (
                  <React.Fragment key={chip.label}>
                    {i > 0 && <span className="opacity-40">·</span>}
                    <span className={chip.className}>{chip.label}</span>
                  </React.Fragment>
                ))}
              </span>
            )}
          </div>
          {actions}
        </div>
        <div className="overflow-hidden rounded-lg border border-border/50 bg-card/50 shadow-xs">
          {sorted.map((check, index) => (
            <div
              key={getCheckDetailsKey(check)}
              className={cn(index > 0 && 'border-t border-border/40')}
            >
              {renderCheckRow(check)}
            </div>
          ))}
        </div>
      </div>
    )
  }
  return (
    <>
      {compactHeader}
      <div className="max-h-[280px] overflow-y-auto p-1 scrollbar-sleek">
        {sorted.map(renderCheckRow)}
      </div>
    </>
  )
}

// Why: for a Project row whose repo differs from the active workspace, mutations must target the row's actual repo via slug-addressed IPCs, else edits silently apply to the workspace's repo.
// Why: these edit IPCs return `{ ok, error }`; callers throw on `!ok` so useImmediateMutation (which expects throws on failure) works unchanged.
