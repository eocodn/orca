import React, { useCallback, useMemo, useState } from 'react'
import {
  Ban,
  CircleDot,
  ChevronDown,
  CheckCircle2,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  LoaderCircle
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useConfirmationDialog } from '@/components/confirmation-dialog'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { useShallow } from 'zustand/react/shallow'
import { useImmediateMutation } from '@/hooks/useIssueMetadata'
import { getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { getGitHubMutationRoutingSettings } from '@/lib/github-source-runtime-context'
import { translate } from '@/i18n/i18n'
import {
  GITHUB_PR_MERGE_METHOD_LABELS,
  resolveGitHubPRMergeMethods
} from '../../../shared/github-pr-merge-methods'
import { presentGitHubPRMergeState } from '@/components/github-pr-merge-state'
import { resolvePullRequestRepo, type GitHubItemDialogProjectOrigin } from './github-item-dialog-model'
import { runPullRequestStateUpdate } from './github-item-dialog-mutations'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { GitHubPRMergeMethod, GitHubWorkItem } from '../../../shared/types'

export function PRActionsPanel({
  item,
  repoPath,
  repoId,
  sourceContext,
  projectOrigin,
  localState,
  onStateChange,
  onMutated
}: {
  item: GitHubWorkItem
  repoPath: string | null
  repoId: string | null
  sourceContext?: TaskSourceContext | null
  projectOrigin: GitHubItemDialogProjectOrigin | undefined
  localState: GitHubWorkItem['state']
  onStateChange: (state: GitHubWorkItem['state']) => void
  onMutated: () => void
}): React.JSX.Element {
  const [statePending, setStatePending] = useState(false)
  const [mergePending, setMergePending] = useState(false)
  const patchWorkItem = useAppStore((s) => s.patchWorkItem)
  const patchProjectRowContent = useAppStore((s) => s.patchProjectRowContent)
  const confirm = useConfirmationDialog()
  const actionItem = { ...item, state: localState }
  const mergePresentation = presentGitHubPRMergeState(actionItem)
  const mergeMethods = resolveGitHubPRMergeMethods(actionItem.mergeMethodSettings)
  const sourceSettings = useAppStore(
    useShallow((s) =>
      getGitHubMutationRoutingSettings(s, item.repoId ?? repoId ?? null, sourceContext)
    )
  )
  const mergeTarget = getActiveRuntimeTarget(sourceSettings)
  const prRepo = resolvePullRequestRepo(item, projectOrigin)
  const canMutateWithRepoContext =
    !!repoPath || !!projectOrigin || mergeTarget.kind === 'environment'
  const canMutateState = localState !== 'merged' && canMutateWithRepoContext
  const nextState: 'open' | 'closed' = localState === 'closed' ? 'open' : 'closed'
  const canMergeWithRepoContext = !!repoPath || mergeTarget.kind === 'environment'
  const mergeDisabled =
    !canMergeWithRepoContext || mergePending || !mergePresentation.directMergeAvailable

  const patchProjectRowIfNeeded = useCallback(
    (state: GitHubWorkItem['state']) => {
      if (!projectOrigin) {
        return
      }
      patchProjectRowContent(projectOrigin.cacheKey, projectOrigin.projectItemId, { state })
    },
    [patchProjectRowContent, projectOrigin]
  )

  const applyStatePatch = useCallback(
    (state: GitHubWorkItem['state']) => {
      onStateChange(state)
      patchWorkItem(item.id, { state }, item.repoId, { sourceContext })
      patchProjectRowIfNeeded(state)
    },
    [item.id, item.repoId, onStateChange, patchProjectRowIfNeeded, patchWorkItem, sourceContext]
  )

  const handleStateChange = async (): Promise<void> => {
    if (!canMutateState || statePending) {
      return
    }
    const label = nextState === 'closed' ? 'Close' : 'Reopen'
    const confirmed = await confirm({
      title: translate(
        'auto.components.GitHubItemDialog.03d7216d62',
        '{{value0}} PR #{{value1}}?',
        { value0: label, value1: item.number }
      ),
      description:
        nextState === 'closed'
          ? translate(
              'auto.components.GitHubItemDialog.de45fedf7b',
              'This will close the pull request on GitHub.'
            )
          : translate(
              'auto.components.GitHubItemDialog.b6f1b7adbd',
              'This will reopen the pull request on GitHub.'
            ),
      confirmLabel: label,
      confirmVariant: nextState === 'closed' ? 'destructive' : 'default'
    })
    if (!confirmed) {
      return
    }
    const previousState = localState
    setStatePending(true)
    applyStatePatch(nextState)
    try {
      await runPullRequestStateUpdate({
        repoPath,
        repoId,
        sourceContext,
        projectOrigin,
        number: item.number,
        prRepo,
        updates: { state: nextState }
      })
      useAppStore.getState().recordFeatureInteraction('github-tasks')
      toast.success(
        nextState === 'closed'
          ? translate('auto.components.GitHubItemDialog.9f88657c4e', 'Pull request closed')
          : translate('auto.components.GitHubItemDialog.bd3b4492a0', 'Pull request reopened')
      )
      onMutated()
    } catch (err) {
      applyStatePatch(previousState)
      toast.error(
        err instanceof Error
          ? err.message
          : translate('auto.components.GitHubItemDialog.e9b7cb7d17', 'Failed to {{value0}} PR', {
              value0: label.toLowerCase()
            })
      )
    } finally {
      setStatePending(false)
    }
  }

  const handleMerge = async (method: GitHubPRMergeMethod): Promise<void> => {
    if (mergeDisabled) {
      return
    }
    const label = GITHUB_PR_MERGE_METHOD_LABELS[method]
    const confirmed = await confirm({
      title: translate(
        'auto.components.GitHubItemDialog.03d7216d62',
        '{{value0}} PR #{{value1}}?',
        { value0: label, value1: item.number }
      ),
      description: translate(
        'auto.components.GitHubItemDialog.a27ee5ca1a',
        'This will update the pull request on GitHub.'
      ),
      confirmLabel: label
    })
    if (!confirmed) {
      return
    }
    setMergePending(true)
    try {
      const result =
        mergeTarget.kind === 'environment'
          ? await callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.mergePR>>>(
              mergeTarget,
              'github.mergePR',
              {
                repo: getGitHubRuntimeRepoId(sourceContext, repoId ?? item.repoId),
                prNumber: item.number,
                method,
                prRepo
              },
              { timeoutMs: 30_000 }
            )
          : await window.api.gh.mergePR({
              repoPath: repoPath ?? '',
              repoId: repoId ?? undefined,
              sourceContext,
              prNumber: item.number,
              method,
              prRepo
            })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      applyStatePatch('merged')
      if (mergeTarget.kind === 'environment') {
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
      useAppStore.getState().recordFeatureInteraction('github-tasks')
      toast.success(translate('auto.components.GitHubItemDialog.dbe5e2448e', 'Pull request merged'))
      onMutated()
    } catch {
      toast.error(
        translate('auto.components.GitHubItemDialog.aba792c8b3', 'Failed to merge pull request')
      )
    } finally {
      setMergePending(false)
    }
  }

  const handleAutoMerge = async (): Promise<void> => {
    if (!canMergeWithRepoContext || !mergePresentation.autoMergeAction) {
      return
    }
    const enabled = mergePresentation.autoMergeAction.kind === 'enable'
    setMergePending(true)
    try {
      const result =
        mergeTarget.kind === 'environment'
          ? await callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.setPRAutoMerge>>>(
              mergeTarget,
              'github.setPRAutoMerge',
              {
                repo: getGitHubRuntimeRepoId(sourceContext, repoId ?? item.repoId),
                prNumber: item.number,
                enabled,
                method: enabled ? mergeMethods.defaultMethod : undefined,
                prRepo
              },
              { timeoutMs: 30_000 }
            )
          : await window.api.gh.setPRAutoMerge({
              repoPath: repoPath ?? '',
              repoId: repoId ?? undefined,
              sourceContext,
              prNumber: item.number,
              enabled,
              method: enabled ? mergeMethods.defaultMethod : undefined,
              prRepo
            })
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (mergeTarget.kind === 'environment') {
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
      useAppStore.getState().recordFeatureInteraction('github-tasks')
      toast.success(
        enabled
          ? translate('auto.components.GitHubItemDialog.a35ea5a0f6', 'Auto-merge enabled')
          : translate('auto.components.GitHubItemDialog.4b390bd50d', 'Auto-merge disabled')
      )
      onMutated()
    } catch {
      toast.error(
        enabled
          ? translate('auto.components.GitHubItemDialog.825a8fb8cd', 'Failed to enable auto-merge')
          : translate('auto.components.GitHubItemDialog.ce360fc318', 'Failed to disable auto-merge')
      )
    } finally {
      setMergePending(false)
    }
  }

  return (
    <aside className="rounded-lg border border-border/50 bg-card/50 p-3 shadow-xs">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GitPullRequest className="size-3.5 text-muted-foreground" />
          <span className="text-[13px] font-medium text-foreground">
            {translate('auto.components.GitHubItemDialog.a2495e4784', 'Pull request')}
          </span>
        </div>
        <WorkItemStateBadge item={actionItem} />
      </div>

      <div className="grid gap-2">
        <DropdownMenu modal={false}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="sm"
                  className={cn(
                    'w-full justify-center gap-2 bg-green-600 text-white hover:bg-green-700',
                    'disabled:cursor-not-allowed disabled:opacity-50'
                  )}
                >
                  {mergePending ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <GitMerge className="size-3.5" />
                  )}
                  {mergePresentation.autoMergeAction?.label ??
                    (mergePresentation.directMergeAvailable
                      ? mergeMethods.defaultLabel
                      : mergePresentation.label)}
                  <ChevronDown className="size-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {!canMergeWithRepoContext
                ? translate(
                    'auto.components.GitHubItemDialog.5932578f51',
                    'Merge requires a registered local repo'
                  )
                : mergePresentation.tooltip}
            </TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="start" className="w-52">
            {mergePresentation.autoMergeAction && (
              <DropdownMenuItem
                disabled={!canMergeWithRepoContext || mergePending}
                onSelect={() => void handleAutoMerge()}
              >
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
              {translate('auto.components.GitHubItemDialog.53fe19aefc', 'Open GitHub merge box')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          type="button"
          variant={nextState === 'closed' ? 'outline' : 'secondary'}
          size="sm"
          className={cn(
            'w-full justify-center gap-2',
            nextState === 'closed' &&
              'border-border bg-background text-foreground hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50'
          )}
          disabled={!canMutateState || statePending}
          onClick={() => void handleStateChange()}
        >
          {statePending ? (
            <LoaderCircle className="size-3.5 animate-spin" />
          ) : nextState === 'closed' ? (
            <GitPullRequestClosed className="size-3.5 text-destructive" />
          ) : (
            <CircleDot className="size-3.5" />
          )}
          {nextState === 'closed'
            ? translate('auto.components.GitHubItemDialog.21860b58d0', 'Close pull request')
            : translate('auto.components.GitHubItemDialog.ec5c4b3ab2', 'Reopen PR')}
        </Button>
      </div>
    </aside>
  )
}
