import React, { useCallback, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import { Ban, CheckCircle2, ChevronDown, ChevronRight, CircleDot, Copy } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useAppStore } from '@/store'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import {
  getTaskSourceRuntimeSettings,
  type TaskSourceContext
} from '../../../shared/task-source-context'
import { githubProjectHost } from '../../../shared/github-project-identity'
import { parseGitHubIssueOrPRLink } from '@/lib/github-links'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { TaskPageGitHubWorkItemStateBadge } from '@/components/task-page-github-work-item-status-badge'
import { TaskPageGitHubDuplicatePicker } from './task-page-github-duplicate-picker'
import {
  createTaskPageGitHubStatusStateDraft,
  resolveTaskPageGitHubStatusStateDraft,
  updateTaskPageGitHubStatusLocalState
} from '@/components/task-page-github-status-state'
import {
  buildTaskPageGitHubCloseUpdate,
  getTaskPageGitHubDuplicateCandidates,
  getTaskPageGitHubDuplicateTargetErrorMessage,
  validateTaskPageGitHubDuplicateTarget,
  type TaskPageGitHubCloseAction
} from '@/components/task-page-github-status-actions'
import type { GitHubIssueUpdate, GitHubWorkItem, Repo } from '../../../shared/types'
export function GHStatusCell({
  item,
  repo,
  sourceContext
}: {
  item: GitHubWorkItem
  repo: Repo | null
  sourceContext?: TaskSourceContext | null
}): React.JSX.Element {
  const patchWorkItem = useAppStore((s) => s.patchWorkItem)
  const [statusStateDraft, setStatusStateDraft] = useState(() =>
    createTaskPageGitHubStatusStateDraft(item)
  )
  const [open, setOpen] = useState(false)
  const [duplicatePickerOpen, setDuplicatePickerOpen] = useState(false)
  const [duplicateSearch, setDuplicateSearch] = useState('')
  const [duplicateError, setDuplicateError] = useState<string | null>(null)
  const duplicateIssueCandidates = useAppStore(
    useShallow((s) => {
      if (!duplicatePickerOpen) {
        return []
      }
      const deduped = new Map<number, GitHubWorkItem>()
      for (const entry of Object.values(s.workItemsCache)) {
        for (const candidate of entry.data ?? []) {
          if (
            candidate.type === 'issue' &&
            candidate.repoId === item.repoId &&
            candidate.number !== item.number &&
            !deduped.has(candidate.number)
          ) {
            deduped.set(candidate.number, candidate)
          }
        }
      }
      return Array.from(deduped.values()).sort((a, b) => b.number - a.number)
    })
  )
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
  const reqRef = useRef(0)
  const parsedIssueLink = useMemo(() => parseGitHubIssueOrPRLink(item.url), [item.url])
  const filteredDuplicateCandidates = useMemo(
    () =>
      getTaskPageGitHubDuplicateCandidates(duplicateIssueCandidates, item.number, duplicateSearch),
    [duplicateIssueCandidates, duplicateSearch, item.number]
  )
  const directDuplicateTarget = useMemo(() => {
    const trimmed = duplicateSearch.trim()
    const validation = validateTaskPageGitHubDuplicateTarget(trimmed, item.number)
    if (!trimmed || !validation.ok) {
      return null
    }
    if (
      filteredDuplicateCandidates.some((candidate) => candidate.number === validation.duplicateOf)
    ) {
      return null
    }
    return validation.duplicateOf
  }, [duplicateSearch, filteredDuplicateCandidates, item.number])
  const duplicatePickerTitle = parsedIssueLink?.slug
    ? `${parsedIssueLink.slug.owner}/${parsedIssueLink.slug.repo}`
    : (repo?.displayName ?? translate('auto.components.TaskPage.repository', 'Repository'))

  const resolvedStatusStateDraft = resolveTaskPageGitHubStatusStateDraft(statusStateDraft, item)
  if (resolvedStatusStateDraft !== statusStateDraft) {
    // Why: item rows can refresh from the cache while this cell is mounted; reconcile before paint to avoid one stale status frame.
    setStatusStateDraft(resolvedStatusStateDraft)
  }
  const localState = resolvedStatusStateDraft.localState
  const updateLocalState = useCallback(
    (nextState: GitHubWorkItem['state']) => {
      setStatusStateDraft((current) =>
        updateTaskPageGitHubStatusLocalState(current, item, nextState)
      )
    },
    [item]
  )

  const handleStateChange = useCallback(
    (newState: 'open' | 'closed', closeAction?: TaskPageGitHubCloseAction) => {
      if (newState === localState || item.type !== 'issue') {
        return
      }
      const parsedOwnerRepo = parsedIssueLink?.slug
      if (!repo && !parsedOwnerRepo) {
        return
      }
      reqRef.current += 1
      const reqId = reqRef.current
      const updates: GitHubIssueUpdate =
        newState === 'closed' && closeAction
          ? buildTaskPageGitHubCloseUpdate(closeAction)
          : { state: newState }
      updateLocalState(newState)
      patchWorkItem(item.id, { state: newState }, item.repoId, { sourceContext })
      const target = getActiveRuntimeTarget(sourceSettings)
      // Why: issue rows can be sourced by owner/repo URL, not local repo context; slug-aware writes preserve close reasons and duplicates.
      const updatePromise = parsedOwnerRepo
        ? target.kind === 'environment'
          ? callRuntimeRpc<{ ok?: boolean; error?: { message?: string } | string }>(
              target,
              'github.project.updateIssueBySlug',
              {
                owner: parsedOwnerRepo.owner,
                repo: parsedOwnerRepo.repo,
                host: githubProjectHost(parsedOwnerRepo.host),
                number: item.number,
                updates
              },
              { timeoutMs: 30_000 }
            )
          : window.api.gh.updateIssueBySlug({
              owner: parsedOwnerRepo.owner,
              repo: parsedOwnerRepo.repo,
              host: githubProjectHost(parsedOwnerRepo.host),
              number: item.number,
              updates
            })
        : (() => {
            if (!repo) {
              throw new Error('No GitHub repository context available for this issue.')
            }
            const runtimeRepoId =
              sourceContext?.provider === 'github' ? (sourceContext.repoId ?? repo.id) : repo.id
            return target.kind === 'environment'
              ? callRuntimeRpc<{ ok?: boolean; error?: string }>(
                  target,
                  'github.updateIssue',
                  { repo: runtimeRepoId, number: item.number, updates },
                  { timeoutMs: 30_000 }
                )
              : window.api.gh.updateIssue({
                  repoPath: repo.path,
                  repoId: repo.id,
                  sourceContext,
                  number: item.number,
                  updates
                })
          })()
      updatePromise
        .then((result) => {
          if (reqId !== reqRef.current) {
            return
          }
          const typed = result as { ok?: boolean; error?: string | { message?: string } }
          if (typed && typed.ok === false) {
            updateLocalState(newState === 'closed' ? 'open' : 'closed')
            patchWorkItem(
              item.id,
              { state: newState === 'closed' ? 'open' : 'closed' },
              item.repoId,
              { sourceContext }
            )
            toast.error(
              typeof typed.error === 'string'
                ? typed.error
                : (typed.error?.message ??
                    translate('auto.components.TaskPage.1c893195ac', 'Failed to update state'))
            )
            return
          }
          if (repo) {
            useAppStore.getState().evictGitHubRepoCaches(repo.id, repo.path)
          }
          useAppStore.getState().recordFeatureInteraction('github-tasks')
        })
        .catch(() => {
          if (reqId !== reqRef.current) {
            return
          }
          updateLocalState(newState === 'closed' ? 'open' : 'closed')
          patchWorkItem(
            item.id,
            { state: newState === 'closed' ? 'open' : 'closed' },
            item.repoId,
            {
              sourceContext
            }
          )
          toast.error(translate('auto.components.TaskPage.1c893195ac', 'Failed to update state'))
        })
    },
    [
      item,
      localState,
      parsedIssueLink,
      patchWorkItem,
      repo,
      sourceContext,
      sourceSettings,
      updateLocalState
    ]
  )

  const closeAsDuplicate = useCallback(
    (targetIssueNumber: number | string) => {
      const validation = validateTaskPageGitHubDuplicateTarget(
        String(targetIssueNumber),
        item.number
      )
      if (!validation.ok) {
        setDuplicateError(getTaskPageGitHubDuplicateTargetErrorMessage(validation, translate))
        return
      }
      setDuplicateError(null)
      handleStateChange('closed', { stateReason: 'duplicate', duplicateOf: validation.duplicateOf })
      setOpen(false)
      setDuplicatePickerOpen(false)
    },
    [handleStateChange, item.number]
  )

  const handleDuplicateSearchSubmit = useCallback(() => {
    const validation = validateTaskPageGitHubDuplicateTarget(duplicateSearch, item.number)
    if (!validation.ok) {
      setDuplicateError(getTaskPageGitHubDuplicateTargetErrorMessage(validation, translate))
      return
    }
    closeAsDuplicate(validation.duplicateOf)
  }, [closeAsDuplicate, duplicateSearch, item.number])

  const handlePopoverOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      setDuplicatePickerOpen(false)
      setDuplicateSearch('')
      setDuplicateError(null)
    }
  }, [])

  if (item.type !== 'issue' || (!repo && !parsedIssueLink?.slug)) {
    return <TaskPageGitHubWorkItemStateBadge item={item} />
  }

  return (
    <Popover open={open} onOpenChange={handlePopoverOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className={cn(
            'group/status inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium transition hover:brightness-125 hover:ring-1 hover:ring-white/10',
            localState === 'closed'
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200'
          )}
        >
          {localState === 'open' ? <CircleDot className="size-2.5" /> : null}
          <span>
            {localState === 'closed'
              ? translate('auto.components.TaskPage.d09bf34db7', 'Closed')
              : translate('auto.components.TaskPage.606a85c774', 'Open')}
          </span>
          <ChevronDown className="size-2.5 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className={cn(duplicatePickerOpen ? 'w-[360px]' : 'w-56', 'p-1')}
        align="start"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {duplicatePickerOpen ? (
          <TaskPageGitHubDuplicatePicker
            title={duplicatePickerTitle}
            search={duplicateSearch}
            onSearchChange={(value) => {
              setDuplicateSearch(value)
              setDuplicateError(null)
            }}
            error={duplicateError}
            directTarget={directDuplicateTarget}
            candidates={filteredDuplicateCandidates}
            onSubmitSearch={handleDuplicateSearchSubmit}
            onSelectDuplicate={closeAsDuplicate}
            onBack={() => {
              setDuplicatePickerOpen(false)
              setDuplicateSearch('')
              setDuplicateError(null)
            }}
          />
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                handleStateChange('open')
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent',
                localState === 'open' && 'bg-accent/50'
              )}
            >
              <CircleDot className="size-4 text-muted-foreground" />
              {translate('auto.components.TaskPage.606a85c774', 'Open')}
            </button>
            <button
              type="button"
              onClick={() => {
                handleStateChange('closed', { stateReason: 'completed' })
                setOpen(false)
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-accent',
                localState === 'closed' && 'bg-accent/50'
              )}
            >
              <CheckCircle2 className="size-4 text-muted-foreground" />
              {translate('auto.components.TaskPage.closeAsCompleted', 'Close as completed')}
            </button>
            <button
              type="button"
              onClick={() => {
                handleStateChange('closed', { stateReason: 'not_planned' })
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-accent"
            >
              <Ban className="size-4 text-muted-foreground" />
              {translate('auto.components.TaskPage.closeAsNotPlanned', 'Close as not planned')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDuplicatePickerOpen(true)
                setDuplicateSearch('')
                setDuplicateError(null)
              }}
              className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-accent"
            >
              <Copy className="size-4 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                {translate('auto.components.TaskPage.closeAsDuplicate', 'Close as duplicate')}
              </span>
              <ChevronRight className="size-3.5 text-muted-foreground" />
            </button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
