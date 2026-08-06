import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, ExternalLink, GitMerge, LoaderCircle, Minus } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { getTaskSourceRuntimeSettings, type TaskSourceContext } from '../../../shared/task-source-context'
import { githubProjectHost } from '../../../shared/github-project-identity'
import { parseGitHubIssueOrPRLink } from '@/lib/github-links'
import { getChecksLabel, getChecksPillTone } from '@/components/task-page-checks-pill'
import { presentGitHubPRMergeState } from '@/components/github-pr-merge-state'
import { GITHUB_PR_MERGE_METHOD_LABELS, resolveGitHubPRMergeMethods } from '../../../shared/github-pr-merge-methods'
import { cn } from '@/lib/utils'
import type { GitHubOwnerRepo, GitHubPRMergeMethod, GitHubWorkItem, Repo } from '../../../shared/types'

function resolveTaskPullRequestRepo(item: Pick<GitHubWorkItem, 'prRepo' | 'url'>): GitHubOwnerRepo | null {
  const repo = item.prRepo ?? parseGitHubIssueOrPRLink(item.url)?.slug ?? null
  return repo ? { ...repo, host: githubProjectHost(repo.host) } : null
}

export function PRChecksCell({
  item,
  onOpen,
  onLoadChecks
}: {
  item: GitHubWorkItem
  onOpen: () => void
  onLoadChecks: () => void
}): React.JSX.Element {
  const triggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (item.type !== 'pr' || item.checksSummary) {
      return
    }
    const node = triggerRef.current
    if (!node || typeof IntersectionObserver === 'undefined') {
      return
    }
    let requested = false
    const observer = new IntersectionObserver(
      (entries) => {
        if (requested || !entries.some((entry) => entry.isIntersecting)) {
          return
        }
        requested = true
        onLoadChecks()
        observer.disconnect()
      },
      { rootMargin: '160px 0px' }
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [item.checksSummary, item.type, onLoadChecks])

  if (item.type !== 'pr') {
    return (
      <span className="text-[11px] text-muted-foreground">
        {translate('auto.components.TaskPage.b1eaa18ace', 'Issue')}
      </span>
    )
  }
  const summary = item.checksSummary
  const Icon =
    summary?.state === 'success'
      ? CheckCircle2
      : summary?.state === 'failure'
        ? AlertCircle
        : summary?.state === 'pending'
          ? Clock3
          : Minus
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          onFocus={onLoadChecks}
          onMouseEnter={onLoadChecks}
          onClick={(event) => {
            event.stopPropagation()
            onLoadChecks()
            onOpen()
          }}
          className={cn(
            'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:brightness-110',
            getChecksPillTone(item)
          )}
        >
          <Icon className="size-3" />
          <span className="truncate">{getChecksLabel(item)}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={6}>
        {translate('auto.components.TaskPage.995dd6af9b', 'Open PR checks')}
      </TooltipContent>
    </Tooltip>
  )
}

export function PRMergeCell({
  item,
  repo,
  sourceContext,
  onRefresh
}: {
  item: GitHubWorkItem
  repo: Repo | null
  sourceContext?: TaskSourceContext | null
  onRefresh: () => void
}): React.JSX.Element {
  const [merging, setMerging] = useState(false)
  const confirm = useConfirmationDialog()
  const repoOwnerSettings = useAppStore(
    useShallow((s) => getSettingsForRepoRuntimeOwner(s, repo?.id ?? null))
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
  if (item.type !== 'pr') {
    return (
      <span className="text-[11px] text-muted-foreground">
        {translate('auto.components.TaskPage.b1eaa18ace', 'Issue')}
      </span>
    )
  }
  const mergePresentation = presentGitHubPRMergeState(item)
  const mergeMethods = resolveGitHubPRMergeMethods(item.mergeMethodSettings)
  const prRepo = resolveTaskPullRequestRepo(item)
  const mergeDisabled = !repo || merging || !mergePresentation.directMergeAvailable

  const handleMerge = async (method: GitHubPRMergeMethod): Promise<void> => {
    if (!repo || mergeDisabled) {
      return
    }
    const label = GITHUB_PR_MERGE_METHOD_LABELS[method]
    const confirmed = await confirm({
      title: translate('auto.components.TaskPage.844dc193c7', '{{value0}} PR #{{value1}}?', {
        value0: label,
        value1: item.number
      }),
      description: translate(
        'auto.components.TaskPage.0506a78337',
        'This will update the pull request on GitHub.'
      ),
      confirmLabel: label
    })
    if (!confirmed) {
      return
    }
    setMerging(true)
    try {
      const target = getActiveRuntimeTarget(sourceSettings)
      const runtimeRepoId =
        sourceContext?.provider === 'github' ? (sourceContext.repoId ?? repo.id) : repo.id
      const result =
        target.kind === 'environment'
          ? await callRuntimeRpc<{ ok: boolean; error?: string }>(
              target,
              'github.mergePR',
              {
                repo: runtimeRepoId,
                prNumber: item.number,
                method,
                prRepo
              },
              { timeoutMs: 30_000 }
            )
          : await window.api.gh.mergePR({
              repoPath: repo.path,
              repoId: repo.id,
              sourceContext,
              prNumber: item.number,
              method,
              prRepo
            })
      if (result.ok) {
        useAppStore.getState().recordFeatureInteraction('github-tasks')
        toast.success(translate('auto.components.TaskPage.a161925adc', 'Pull request merged'))
        onRefresh()
      } else {
        toast.error(result.error)
      }
    } catch {
      toast.error(translate('auto.components.TaskPage.88f478cdef', 'Failed to merge pull request'))
    } finally {
      setMerging(false)
    }
  }

  const handleAutoMerge = async (): Promise<void> => {
    if (!repo || !mergePresentation.autoMergeAction) {
      return
    }
    const enabled = mergePresentation.autoMergeAction.kind === 'enable'
    setMerging(true)
    try {
      const target = getActiveRuntimeTarget(sourceSettings)
      const runtimeRepoId =
        sourceContext?.provider === 'github' ? (sourceContext.repoId ?? repo.id) : repo.id
      const result =
        target.kind === 'environment'
          ? await callRuntimeRpc<{ ok: boolean; error?: string }>(
              target,
              'github.setPRAutoMerge',
              {
                repo: runtimeRepoId,
                prNumber: item.number,
                enabled,
                method: enabled ? mergeMethods.defaultMethod : undefined,
                prRepo
              },
              { timeoutMs: 30_000 }
            )
          : await window.api.gh.setPRAutoMerge({
              repoPath: repo.path,
              repoId: repo.id,
              sourceContext,
              prNumber: item.number,
              enabled,
              method: enabled ? mergeMethods.defaultMethod : undefined,
              prRepo
            })
      if (result.ok) {
        useAppStore.getState().recordFeatureInteraction('github-tasks')
        toast.success(
          enabled
            ? translate('auto.components.TaskPage.fed317634c', 'Auto-merge enabled')
            : translate('auto.components.TaskPage.a5bf86defe', 'Auto-merge disabled')
        )
        onRefresh()
      } else {
        toast.error(result.error)
      }
    } catch {
      toast.error(
        enabled
          ? translate('auto.components.TaskPage.a3318684bc', 'Failed to enable auto-merge')
          : translate('auto.components.TaskPage.1a9ea003dc', 'Failed to disable auto-merge')
      )
    } finally {
      setMerging(false)
    }
  }

  return (
    <DropdownMenu modal={false}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              onClick={(event) => event.stopPropagation()}
              className={cn(
                'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:brightness-110',
                mergePresentation.tone
              )}
            >
              {merging ? (
                <LoaderCircle className="size-3 animate-spin text-muted-foreground" />
              ) : (
                <GitMerge className="size-3" />
              )}
              <span className="truncate">{mergePresentation.label}</span>
              <ChevronDown className="size-2.5 opacity-60" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {mergePresentation.tooltip}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" onClick={(event) => event.stopPropagation()}>
        {mergePresentation.autoMergeAction && (
          <DropdownMenuItem disabled={!repo || merging} onSelect={() => void handleAutoMerge()}>
            <GitMerge className="size-4" />
            {mergePresentation.autoMergeAction.label}
          </DropdownMenuItem>
        )}
        {mergePresentation.autoMergeAction && <DropdownMenuSeparator />}
        {mergeMethods.methods.map(({ method, label }) => (
          <DropdownMenuItem
            key={method}
            disabled={mergeDisabled}
            onSelect={() => void handleMerge(method)}
          >
            <GitMerge className="size-4" />
            {label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuItem onSelect={() => window.api.shell.openUrl(item.url)}>
          <ExternalLink className="size-4" />
          {translate('auto.components.TaskPage.37d60046e3', 'Open GitHub merge box')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}


