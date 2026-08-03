import React, { useCallback, useMemo, useState } from 'react'
import { ChevronDown, CircleDashed, LoaderCircle, RefreshCw, Wrench } from 'lucide-react'
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
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  canUseGitHubRepoContext,
  getGitHubRuntimeRepoId,
  getGitHubSourceRuntimeHost
} from '@/lib/github-source-runtime-context'
import { translate } from '@/i18n/i18n'
import { CHECK_COLOR, CHECK_ICON } from '@/components/right-sidebar/checks-panel-content'
import { getCheckCounts, getChecksSummaryLabel } from '@/components/pr-check-counts'
import { startFixChecksAgent } from '@/lib/fix-checks-agent-launch'
import { buildFixBrokenChecksPrompt, getBrokenChecks } from '@/components/pr-checks-fix-prompt'
import { resolvePullRequestRepo } from './github-item-dialog-model'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { GitHubWorkItem, GitHubWorkItemDetails, PRCheckDetail } from '../../../shared/types'
import {
  createGitHubChecksTabState,
  resolveGitHubChecksTabState,
  toggleGitHubChecksTabExpandedKey,
  updateGitHubChecksTabDetails,
  updateGitHubChecksTabLocalChecks
} from '@/components/github-checks-tab-state'
import {
  getCheckDetailsKey,
  GitHubChecksResults
} from './github-item-dialog-checks-results'

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

  return (
    <GitHubChecksResults
      loading={loading}
      list={list}
      variant={variant}
      actions={actions}
      compactHeader={compactHeader}
      SummaryIcon={SummaryIcon}
      summaryColor={summaryColor}
      summaryLabel={summaryLabel}
      counts={counts}
      expandedCheckKey={expandedCheckKey}
      detailsByCheckKey={detailsByCheckKey}
      onToggleCheckDetails={handleToggleCheckDetails}
    />
  )
}
