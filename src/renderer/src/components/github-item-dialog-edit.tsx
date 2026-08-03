import React, { useCallback, useMemo, useState } from 'react'
import {
  ArrowRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDot,
  CircleDashed,
  ExternalLink,
  FolderKanban,
  LoaderCircle,
  Pencil,
  Settings,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useShallow } from 'zustand/react/shallow'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { useRepoLabels, useRepoAssignees, useImmediateMutation } from '@/hooks/useIssueMetadata'
import { useRepoLabelsBySlug, useRepoAssigneesBySlug } from '@/hooks/useGitHubSlugMetadata'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import { getTaskPageGitHubDuplicateCandidates, getTaskPageGitHubDuplicateTargetErrorMessage, validateTaskPageGitHubDuplicateTarget } from '@/components/task-page-github-status-actions'
import { buildTaskPageGitHubCloseUpdate, type TaskPageGitHubCloseAction } from '@/components/task-page-github-status-actions'
import { parseOwnerRepoFromItemUrl } from '@/components/github-work-item-display'
import { getGithubWorkItemWorkspaceAttachmentLabel } from '@/lib/github-work-item-workspace-attachment'
import { translate } from '@/i18n/i18n'
import { getGitHubRepositoryLabelsUrl, type GitHubItemDialogProjectOrigin } from './github-item-dialog-model'
import { runIssueUpdate, runPullRequestStateUpdate, runWorkItemBodyUpdate } from './github-item-dialog-mutations'
import { addIssueCommentForRepo } from './github-item-dialog-cache'
import { PRAssigneesPanel } from './github-item-dialog-reviewers'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { GitHubAssignableUser, GitHubOwnerRepo, GitHubWorkItem } from '../../../shared/types'

export function GitHubLabelsSettingsLink({
  url,
  separated,
  onOpen
}: {
  url: string | null
  separated?: boolean
  onOpen?: () => void
}): React.JSX.Element | null {
  if (!url) {
    return null
  }

  return (
    <div className={cn(separated && 'mt-1 border-t border-border/60 pt-1')}>
      <button
        type="button"
        onClick={() => {
          onOpen?.()
          void window.api.shell.openUrl(url)
        }}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      >
        <Settings className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 text-left">
          {translate('auto.components.GitHubItemDialog.2aa9acdf34', 'Edit labels on GitHub')}
        </span>
        <ExternalLink className="size-3 shrink-0 opacity-70" />
      </button>
    </div>
  )
}

export function GHEditSection({
  item,
  repoPath,
  repoId,
  sourceContext,
  projectOrigin,
  localState,
  localLabels,
  onStateChange,
  onLabelsChange,
  onMutated,
  assignees,
  onUse,
  onOpenOrUse,
  attachedWorkspaceLabel,
  layout = 'horizontal'
}: {
  item: GitHubWorkItem
  repoPath: string | null
  repoId: string | null
  sourceContext?: TaskSourceContext | null
  projectOrigin: GitHubItemDialogProjectOrigin | undefined
  localState: GitHubWorkItem['state']
  localLabels: string[]
  onStateChange: (state: GitHubWorkItem['state']) => void
  onLabelsChange: (labels: string[]) => void
  /** Why: lets the parent invalidate its details cache after a mutation, else a reopen within FRESH_MS paints pre-mutation data. */
  onMutated: () => void
  assignees: string[]
  onUse: (item: GitHubWorkItem) => void
  onOpenOrUse?: (item: GitHubWorkItem) => void
  attachedWorkspaceLabel?: string | null
  /** `horizontal`: compact pill strip for the non-issue drawer/header; `top-columns`: labeled columns above the issue page body. */
  layout?: 'horizontal' | 'top-columns'
}): React.JSX.Element | null {
  const [labelPopoverOpen, setLabelPopoverOpen] = useState(false)
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false)
  const [statusPopoverOpen, setStatusPopoverOpen] = useState(false)
  const [duplicatePickerOpen, setDuplicatePickerOpen] = useState(false)
  const [duplicateSearch, setDuplicateSearch] = useState('')
  const [duplicateError, setDuplicateError] = useState<string | null>(null)
  const [localAssignees, setLocalAssignees] = useState<string[]>(assignees)
  const editedAssigneesItemKeyRef = useRef<string | null>(null)
  const assigneesItemKey = `${item.repoId}\0${item.id}`
  const patchWorkItem = useAppStore((s) => s.patchWorkItem)
  const patchProjectRowContent = useAppStore((s) => s.patchProjectRowContent)
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
  // Why: from a Project view, keep projectViewCache in sync too — patchWorkItem only walks workItemsCache, so the table would render stale without this. See docs/design/github-project-view-tasks.md §Dialog editing from Project rows.
  const patchProjectRowIfNeeded = useCallback(
    (patch: Parameters<typeof patchProjectRowContent>[2]) => {
      if (!projectOrigin) {
        return
      }
      patchProjectRowContent(projectOrigin.cacheKey, projectOrigin.projectItemId, patch)
    },
    [projectOrigin, patchProjectRowContent]
  )

  // Why: with projectOrigin set, read labels/assignees from the row's repo, not the workspace path, or popovers list a different repo than writes target.
  const slugOwner = projectOrigin?.owner ?? null
  const slugRepo = projectOrigin?.repo ?? null
  const repoLabelsByPath = useRepoLabels(
    projectOrigin ? null : repoPath,
    projectOrigin ? null : repoId,
    sourceSettings
  )
  const repoLabelsBySlug = useRepoLabelsBySlug(
    slugOwner,
    slugRepo,
    sourceSettings,
    projectOrigin?.host
  )
  const repoLabels = projectOrigin ? repoLabelsBySlug : repoLabelsByPath
  const repositoryLabelsUrl = useMemo(() => getGitHubRepositoryLabelsUrl(item.url), [item.url])
  const repoAssigneesByPath = useRepoAssignees(
    projectOrigin ? null : repoPath,
    projectOrigin ? null : repoId,
    sourceSettings
  )
  const repoAssigneesBySlug = useRepoAssigneesBySlug(
    slugOwner,
    slugRepo,
    assignees,
    sourceSettings,
    projectOrigin?.host
  )
  const repoAssignees = projectOrigin ? repoAssigneesBySlug : repoAssigneesByPath
  const hasAttachedWorkspace =
    attachedWorkspaceLabel !== null && attachedWorkspaceLabel !== undefined
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
  const duplicatePickerTitle = useMemo(() => {
    if (projectOrigin) {
      return `${projectOrigin.owner}/${projectOrigin.repo}`
    }
    const parsed = parseOwnerRepoFromItemUrl(item.url)
    return parsed
      ? `${parsed.owner}/${parsed.repo}`
      : translate('auto.components.TaskPage.repository', 'Repository')
  }, [item.url, projectOrigin])
  const handleOpenOrUseWorkspace = useCallback((): void => {
    if (onOpenOrUse) {
      onOpenOrUse(item)
      return
    }
    onUse(item)
  }, [item, onOpenOrUse, onUse])

  // Why: sync local assignees on item change / detail resolve, but skip if the user made an optimistic edit so we don't clobber in-flight changes.
  useEffect(() => {
    if (editedAssigneesItemKeyRef.current === assigneesItemKey) {
      return
    }
    setLocalAssignees(assignees)
  }, [assigneesItemKey, assignees])

  const handleStateChange = useCallback(
    (newState: 'open' | 'closed', closeAction?: TaskPageGitHubCloseAction) => {
      if (newState === localState) {
        return
      }
      const prevState = localState
      run('state', {
        mutate: () =>
          runIssueUpdate({
            repoId: item.repoId,
            repoPath,
            sourceContext,
            projectOrigin,
            number: item.number,
            updates:
              newState === 'closed' && closeAction
                ? buildTaskPageGitHubCloseUpdate(closeAction)
                : { state: newState }
          }),
        onOptimistic: () => {
          onStateChange(newState)
          patchWorkItem(item.id, { state: newState }, item.repoId, { sourceContext })
          patchProjectRowIfNeeded({ state: newState })
        },
        onRevert: () => {
          onStateChange(prevState)
          patchWorkItem(item.id, { state: prevState }, item.repoId, { sourceContext })
          patchProjectRowIfNeeded({ state: prevState })
        },
        onSuccess: () => {
          useAppStore.getState().recordFeatureInteraction('github-tasks')
          patchWorkItem(item.id, { state: newState }, item.repoId, { sourceContext })
          patchProjectRowIfNeeded({ state: newState })
          onMutated()
        },
        onError: (err) => toast.error(err)
      })
    },
    [
      item.id,
      item.number,
      item.repoId,
      localState,
      repoPath,
      sourceContext,
      projectOrigin,
      patchWorkItem,
      patchProjectRowIfNeeded,
      run,
      onStateChange,
      onMutated
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
      setStatusPopoverOpen(false)
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

  const handleStatusPopoverOpenChange = useCallback((nextOpen: boolean) => {
    setStatusPopoverOpen(nextOpen)
    if (!nextOpen) {
      setDuplicatePickerOpen(false)
      setDuplicateSearch('')
      setDuplicateError(null)
    }
  }, [])

  const handleLabelToggle = useCallback(
    (label: string) => {
      const isAdding = !localLabels.includes(label)
      const prevLabels = localLabels
      const newLabels = isAdding ? [...prevLabels, label] : prevLabels.filter((l) => l !== label)

      if (isAdding) {
        run('labels', {
          mutate: () =>
            runIssueUpdate({
              repoId: item.repoId,
              repoPath,
              sourceContext,
              projectOrigin,
              number: item.number,
              updates: { addLabels: [label] }
            }),
          onOptimistic: () => {
            onLabelsChange(newLabels)
            patchWorkItem(item.id, { labels: newLabels }, item.repoId, { sourceContext })
            patchProjectRowIfNeeded({ labels: newLabels })
          },
          onSuccess: () => {
            useAppStore.getState().recordFeatureInteraction('github-tasks')
            onMutated()
          },
          onRevert: () => {
            onLabelsChange(prevLabels)
            patchWorkItem(item.id, { labels: prevLabels }, item.repoId, { sourceContext })
            patchProjectRowIfNeeded({ labels: prevLabels })
          },
          onError: (err) => toast.error(err)
        })
      } else {
        run('labels', {
          mutate: () =>
            runIssueUpdate({
              repoId: item.repoId,
              repoPath,
              sourceContext,
              projectOrigin,
              number: item.number,
              updates: { removeLabels: [label] }
            }),
          onOptimistic: () => {
            onLabelsChange(newLabels)
            patchWorkItem(item.id, { labels: newLabels }, item.repoId, { sourceContext })
            patchProjectRowIfNeeded({ labels: newLabels })
          },
          onRevert: () => {
            onLabelsChange(prevLabels)
            patchWorkItem(item.id, { labels: prevLabels }, item.repoId, { sourceContext })
            patchProjectRowIfNeeded({ labels: prevLabels })
          },
          onSuccess: () => {
            useAppStore.getState().recordFeatureInteraction('github-tasks')
            onMutated()
          },
          onError: (err) => toast.error(err)
        })
      }
    },
    [
      item.id,
      item.number,
      item.repoId,
      localLabels,
      repoPath,
      sourceContext,
      projectOrigin,
      patchWorkItem,
      patchProjectRowIfNeeded,
      run,
      onLabelsChange,
      onMutated
    ]
  )

  const handleAssigneeToggle = useCallback(
    (login: string) => {
      const isAssigned = localAssignees.includes(login)
      const prevAssignees = localAssignees
      const newAssignees = isAssigned
        ? prevAssignees.filter((l) => l !== login)
        : [...prevAssignees, login]

      // Why: scope the optimistic guard to this repo item so switching items doesn't suppress the next item's assignee sync.
      editedAssigneesItemKeyRef.current = assigneesItemKey
      if (isAssigned) {
        run('assignees', {
          mutate: () =>
            runIssueUpdate({
              repoId: item.repoId,
              repoPath,
              sourceContext,
              projectOrigin,
              number: item.number,
              updates: { removeAssignees: [login] }
            }),
          onOptimistic: () => {
            setLocalAssignees(newAssignees)
            patchProjectRowIfNeeded({ assignees: newAssignees })
          },
          onRevert: () => {
            setLocalAssignees(prevAssignees)
            patchProjectRowIfNeeded({ assignees: prevAssignees })
          },
          onSuccess: () => {
            useAppStore.getState().recordFeatureInteraction('github-tasks')
            onMutated()
          },
          onError: (err) => toast.error(err)
        })
      } else {
        run('assignees', {
          mutate: () =>
            runIssueUpdate({
              repoId: item.repoId,
              repoPath,
              sourceContext,
              projectOrigin,
              number: item.number,
              updates: { addAssignees: [login] }
            }),
          onOptimistic: () => {
            setLocalAssignees(newAssignees)
            patchProjectRowIfNeeded({ assignees: newAssignees })
          },
          onSuccess: () => {
            useAppStore.getState().recordFeatureInteraction('github-tasks')
            onMutated()
          },
          onRevert: () => {
            setLocalAssignees(prevAssignees)
            patchProjectRowIfNeeded({ assignees: prevAssignees })
          },
          onError: (err) => toast.error(err)
        })
      }
    },
    [
      item.number,
      item.repoId,
      assigneesItemKey,
      repoPath,
      sourceContext,
      projectOrigin,
      localAssignees,
      patchProjectRowIfNeeded,
      run,
      onMutated
    ]
  )

  const renderIssueStatusPopover = (variant: 'sidebar' | 'pill'): React.JSX.Element => {
    const isSidebar = variant === 'sidebar'
    return (
      <Popover open={statusPopoverOpen} onOpenChange={handleStatusPopoverOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isPending('state')}
            className={cn(
              isSidebar
                ? 'inline-flex w-full items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[12px] font-medium transition hover:brightness-125 hover:ring-1 hover:ring-white/10 disabled:opacity-50'
                : 'group/status inline-flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition hover:brightness-125 hover:ring-1 hover:ring-white/10 disabled:opacity-50',
              localState === 'closed'
                ? getStateTone({ ...item, state: localState })
                : 'border-border/60 bg-muted/20 text-foreground hover:bg-accent/60'
            )}
          >
            <span className="inline-flex items-center gap-1.5">
              {localState === 'closed' ? (
                <CircleDashed className={isSidebar ? 'size-3.5' : 'size-3'} />
              ) : (
                <CircleDot className={cn(isSidebar ? 'size-3.5' : 'size-3', 'text-emerald-500')} />
              )}
              {getStateLabel({ ...item, state: localState })}
            </span>
            <ChevronDown className={isSidebar ? 'size-3 opacity-60' : 'size-2.5 opacity-50'} />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className={cn(duplicatePickerOpen ? 'w-[360px]' : 'w-56', 'p-1')}
          align="start"
        >
          {duplicatePickerOpen ? (
            <div>
              <div className="flex items-center gap-2 px-1 py-1.5">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="size-7"
                  onClick={() => {
                    setDuplicatePickerOpen(false)
                    setDuplicateSearch('')
                    setDuplicateError(null)
                  }}
                  aria-label={translate('auto.components.TaskPage.backToCloseReasons', 'Back')}
                >
                  <ChevronLeft className="size-4" />
                </Button>
                <span className="min-w-0 truncate text-[12px] font-semibold">
                  {duplicatePickerTitle}
                </span>
              </div>
              <div className="relative px-1 pb-2">
                <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                <Input
                  autoFocus
                  value={duplicateSearch}
                  onChange={(event) => {
                    setDuplicateSearch(event.target.value)
                    setDuplicateError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleDuplicateSearchSubmit()
                    }
                  }}
                  placeholder={translate('auto.components.TaskPage.searchIssues', 'Search issues')}
                  className="h-9 pl-8 text-[12px]"
                  aria-invalid={duplicateError ? true : undefined}
                />
              </div>
              {duplicateError ? (
                <p className="px-2 pb-2 text-[11px] text-destructive">{duplicateError}</p>
              ) : null}
              <div className="scrollbar-sleek max-h-72 overflow-y-auto pr-1">
                {directDuplicateTarget ? (
                  <button
                    type="button"
                    onClick={() => closeAsDuplicate(directDuplicateTarget)}
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left hover:bg-accent"
                  >
                    <Copy className="size-4 text-primary" />
                    <span className="min-w-0 flex-1 text-[12px] font-medium">
                      {translate(
                        'auto.components.TaskPage.useIssueNumber',
                        'Use issue #{{value0}}',
                        {
                          value0: directDuplicateTarget
                        }
                      )}
                    </span>
                  </button>
                ) : null}
                {filteredDuplicateCandidates.map((candidate) => (
                  <button
                    key={`${candidate.repoId}:${candidate.number}`}
                    type="button"
                    onClick={() => closeAsDuplicate(candidate.number)}
                    className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left hover:bg-accent"
                  >
                    {candidate.state === 'closed' ? (
                      <CircleDashed className="mt-0.5 size-4 shrink-0 text-primary" />
                    ) : (
                      <CircleDot className="mt-0.5 size-4 shrink-0 text-emerald-500" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-medium leading-snug">
                        {candidate.title}
                      </span>
                    </span>
                    <span className="shrink-0 text-[12px] text-muted-foreground">
                      #{candidate.number}
                    </span>
                  </button>
                ))}
                {!directDuplicateTarget && filteredDuplicateCandidates.length === 0 ? (
                  <p className="px-2 py-3 text-[12px] text-muted-foreground">
                    {translate(
                      'auto.components.TaskPage.noMatchingIssuesLoaded',
                      'No matching issues loaded.'
                    )}
                  </p>
                ) : null}
              </div>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => {
                  handleStateChange('open')
                  setStatusPopoverOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent',
                  localState === 'open' && 'bg-accent/50'
                )}
              >
                <CircleDot className="size-4 text-muted-foreground" />
                {translate('auto.components.GitHubItemDialog.dc1ca081a8', 'Open')}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleStateChange('closed', { stateReason: 'completed' })
                  setStatusPopoverOpen(false)
                }}
                className={cn(
                  'flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-[12px] hover:bg-accent',
                  localState === 'closed' && 'bg-accent/50'
                )}
              >
                <Check className="size-4 text-muted-foreground" />
                {translate('auto.components.TaskPage.closeAsCompleted', 'Close as completed')}
              </button>
              <button
                type="button"
                onClick={() => {
                  handleStateChange('closed', { stateReason: 'not_planned' })
                  setStatusPopoverOpen(false)
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

  if (item.type === 'pr') {
    return null
  }

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

  if (layout === 'top-columns') {
    // Why: lay property fields as top columns so the description isn't squeezed by a right rail.
    return (
      <aside className="grid grid-cols-2 gap-x-6 gap-y-5 text-[13px] sm:grid-cols-4">
        {/* State */}
        <section className="min-w-0">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            {translate('auto.components.GitHubItemDialog.00ccdf9b5a', 'Status')}
          </div>
          {renderIssueStatusPopover('sidebar')}
        </section>

        {/* Assignees */}
        <section className="min-w-0">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            <span>{translate('auto.components.GitHubItemDialog.83ac703dda', 'Assignees')}</span>
            <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={isPending('assignees') || repoAssignees.loading}
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
              <PopoverContent
                className="popover-scroll-content scrollbar-sleek w-60 p-1"
                align="end"
              >
                {repoAssignees.error ? (
                  <div className="px-2 py-3 text-center text-[12px] text-destructive">
                    {repoAssignees.error}
                  </div>
                ) : (
                  <div>
                    {repoAssignees.data.map((user) => (
                      <button
                        key={user.login}
                        type="button"
                        onClick={() => handleAssigneeToggle(user.login)}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent"
                      >
                        <span
                          className={cn(
                            'flex size-3.5 items-center justify-center rounded-sm border',
                            localAssignees.includes(user.login)
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input'
                          )}
                        >
                          {localAssignees.includes(user.login) && checkIcon}
                        </span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate">{user.login}</span>
                          {user.name && (
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {user.name}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
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
              {localAssignees.map((login) => {
                const user = repoAssignees.data.find((u) => u.login === login)
                return (
                  <li key={login} className="flex min-w-0 items-center gap-2">
                    {user?.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt=""
                        className="size-5 shrink-0 rounded-full border border-border/40 object-cover"
                      />
                    ) : (
                      <div className="size-5 shrink-0 rounded-full bg-muted" />
                    )}
                    <span className="min-w-0 truncate text-[12px] font-medium text-foreground">
                      {login}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Labels */}
        <section className="min-w-0">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            <span>{translate('auto.components.GitHubItemDialog.217e55d87c', 'Labels')}</span>
            <Popover open={labelPopoverOpen} onOpenChange={setLabelPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={isPending('labels') || repoLabels.loading}
                  aria-label={translate(
                    'auto.components.GitHubItemDialog.4ba0132f37',
                    'Edit labels'
                  )}
                  className="rounded p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {isPending('labels') ? (
                    <LoaderCircle className="size-3 animate-spin" />
                  ) : (
                    <Pencil className="size-3" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="popover-scroll-content scrollbar-sleek w-60 p-1"
                align="end"
              >
                {repoLabels.error ? (
                  <div className="px-2 py-3 text-center text-[12px] text-destructive">
                    {repoLabels.error}
                  </div>
                ) : null}
                {!repoLabels.error ? (
                  <div>
                    {repoLabels.data.map((label) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => handleLabelToggle(label)}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent"
                      >
                        <span
                          className={cn(
                            'flex size-3.5 items-center justify-center rounded-sm border',
                            localLabels.includes(label)
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input'
                          )}
                        >
                          {localLabels.includes(label) && checkIcon}
                        </span>
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <GitHubLabelsSettingsLink
                  url={repositoryLabelsUrl}
                  separated={!repoLabels.error && repoLabels.data.length > 0}
                  onOpen={() => setLabelPopoverOpen(false)}
                />
              </PopoverContent>
            </Popover>
          </div>
          {localLabels.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">
              {translate('auto.components.GitHubItemDialog.886a64b081', 'None yet')}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {localLabels.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0">
          {/* Why: property columns are metadata only; the primary open/start CTA lives solely in the issue header. */}
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            {translate('auto.components.GitHubItemDialog.2e4d806c92', 'Workspace')}
          </div>
          {attachedWorkspaceLabel ? (
            <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
              <FolderKanban className="size-3.5 shrink-0" />
              <span className="truncate">{attachedWorkspaceLabel}</span>
            </div>
          ) : (
            <div className="text-[12px] text-muted-foreground">
              {translate('auto.components.GitHubItemDialog.886a64b081', 'None yet')}
            </div>
          )}
        </section>
      </aside>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-2.5">
      {/* State */}
      {renderIssueStatusPopover('pill')}

      {/* Labels */}
      <Popover open={labelPopoverOpen} onOpenChange={setLabelPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isPending('labels') || repoLabels.loading}
            className="group/labels inline-flex items-center gap-1 rounded-full border border-border/30 bg-muted/20 px-2 py-0.5 text-[11px] transition hover:brightness-125 hover:ring-1 hover:ring-white/10 disabled:opacity-50"
          >
            {localLabels.length === 0 ? (
              <span className="text-muted-foreground">
                {translate('auto.components.GitHubItemDialog.f41ec96c13', '+ Label')}
              </span>
            ) : (
              localLabels.map((name) => (
                <span key={name} className="text-[10px] text-muted-foreground">
                  {name}
                </span>
              ))
            )}
            {isPending('labels') ? (
              <LoaderCircle className="size-3 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDown className="size-2.5 opacity-50" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="popover-scroll-content scrollbar-sleek w-52 p-1" align="start">
          {repoLabels.error ? (
            <div className="px-2 py-3 text-center text-[12px] text-destructive">
              {repoLabels.error}
            </div>
          ) : null}
          {!repoLabels.error ? (
            <div>
              {repoLabels.data.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleLabelToggle(label)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent"
                >
                  <span
                    className={cn(
                      'flex size-3.5 items-center justify-center rounded-sm border',
                      localLabels.includes(label)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input'
                    )}
                  >
                    {localLabels.includes(label) && checkIcon}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          <GitHubLabelsSettingsLink
            url={repositoryLabelsUrl}
            separated={!repoLabels.error && repoLabels.data.length > 0}
            onOpen={() => setLabelPopoverOpen(false)}
          />
        </PopoverContent>
      </Popover>

      {/* Assignees */}
      <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isPending('assignees') || repoAssignees.loading}
            className="group/assignees inline-flex items-center gap-1 rounded-full border border-border/30 bg-muted/20 px-2 py-0.5 text-[11px] transition hover:brightness-125 hover:ring-1 hover:ring-white/10 disabled:opacity-50"
          >
            {localAssignees.length === 0 ? (
              <span className="text-muted-foreground">
                {translate('auto.components.GitHubItemDialog.c6f37a563d', '+ Assignee')}
              </span>
            ) : (
              localAssignees.map((login) => (
                <span key={login} className="text-[10px] text-muted-foreground">
                  {login}
                </span>
              ))
            )}
            {isPending('assignees') ? (
              <LoaderCircle className="size-3 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDown className="size-2.5 opacity-50" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="popover-scroll-content scrollbar-sleek w-52 p-1" align="start">
          {repoAssignees.error ? (
            <div className="px-2 py-3 text-center text-[12px] text-destructive">
              {repoAssignees.error}
            </div>
          ) : (
            <div>
              {repoAssignees.data.map((user) => (
                <button
                  key={user.login}
                  type="button"
                  onClick={() => handleAssigneeToggle(user.login)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent"
                >
                  <span
                    className={cn(
                      'flex size-3.5 items-center justify-center rounded-sm border',
                      localAssignees.includes(user.login)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input'
                    )}
                  >
                    {localAssignees.includes(user.login) && checkIcon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{user.login}</span>
                    {user.name && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {user.name}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {attachedWorkspaceLabel ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            <FolderKanban className="size-3 shrink-0" />
            <span className="truncate">{attachedWorkspaceLabel}</span>
          </span>
        ) : null}
        {hasAttachedWorkspace ? (
          <DropdownMenu modal={false}>
            <ButtonGroup>
              <Button
                type="button"
                size="sm"
                onClick={handleOpenOrUseWorkspace}
                className="gap-2"
                aria-label={translate(
                  'auto.components.GitHubItemDialog.84855fedd0',
                  'Open workspace attached to issue'
                )}
              >
                {translate('auto.components.GitHubItemDialog.726db41722', 'Open workspace')}
                <ArrowRight className="size-4" />
              </Button>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  aria-label={translate(
                    'auto.components.GitHubItemDialog.fe6ff12dc2',
                    'More issue workspace actions'
                  )}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </ButtonGroup>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onUse(item)}>
                <Plus className="size-4" />
                {translate('auto.components.GitHubItemDialog.36182aa57f', 'Start new workspace')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={() => onUse(item)}
            className="gap-2"
            aria-label={translate(
              'auto.components.GitHubItemDialog.0ab4664a8b',
              'Start workspace from issue'
            )}
          >
            {translate('auto.components.GitHubItemDialog.0ab4664a8b', 'Start workspace from issue')}
            <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

export function GHCommentComposer({
  className,
  repoPath,
  repoId,
  sourceContext,
  issueNumber,
  itemType,
  prRepo,
  onCommentAdded
}: {
  className?: string
  repoPath: string
  repoId?: string | null
  sourceContext?: TaskSourceContext | null
  issueNumber: number
  itemType: 'issue' | 'pr'
  prRepo?: GitHubOwnerRepo | null
  onCommentAdded: (comment: PRComment) => void
}): React.JSX.Element {
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const mountedRef = useMountedRef()

  const handleSubmit = useCallback(async () => {
    const bodyState = getCommentBodySubmitState(body)
    if (bodyState.status === 'empty') {
      return
    }
    if (bodyState.status === 'too-large-leading-whitespace') {
      toast.error(
        translate(
          'auto.components.GitHubItemDialog.commentTooLarge',
          'Comment is too large to submit safely.'
        )
      )
      return
    }
    setSubmitting(true)
    try {
      const result = await addIssueCommentForRepo({
        repoPath,
        repoId: repoId ?? undefined,
        sourceContext,
        number: issueNumber,
        body: bodyState.body,
        type: itemType,
        prRepo
      })
      if (!mountedRef.current) {
        return
      }
      if (result.ok) {
        setBody('')
        // Why: use GitHub's returned comment so the optimistic row shows the real login/avatar immediately.
        onCommentAdded(result.comment)
      } else {
        toast.error(
          result.error ??
            translate('auto.components.GitHubItemDialog.082515176a', 'Failed to add comment')
        )
      }
    } catch (err) {
      if (mountedRef.current) {
        toast.error(
          err instanceof Error
            ? err.message
            : translate('auto.components.GitHubItemDialog.082515176a', 'Failed to add comment')
        )
      }
    } finally {
      if (mountedRef.current) {
        setSubmitting(false)
      }
    }
  }, [
    body,
    mountedRef,
    repoPath,
    repoId,
    sourceContext,
    issueNumber,
    itemType,
    prRepo,
    onCommentAdded
  ])
  const canSubmitComment = hasBoundedCommentBodyText(body)

  return (
    <div className={cn('relative', className)}>
      <GitHubMarkdownComposer
        value={body}
        onChange={setBody}
        placeholder={translate('auto.components.GitHubItemDialog.c5c117270e', 'Add a comment…')}
        disabled={submitting}
        minHeightClassName="min-h-28 pb-14 pr-14"
        className="w-full"
        onSubmitShortcut={() => void handleSubmit()}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            size="icon-sm"
            onClick={handleSubmit}
            disabled={!canSubmitComment || submitting}
            className="absolute bottom-3 right-3 shadow-sm"
            aria-label={translate('auto.components.GitHubItemDialog.0a73f59e85', 'Send comment')}
          >
            {submitting ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {translate('auto.components.GitHubItemDialog.0a73f59e85', 'Send comment')}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

// Why: recover the PR-source slug the dialog lacks from workItemsCache, scoped to this repoPath so a sibling repo sharing the issue-source (e.g. two forks) can't mislabel the chip; hide when unknown rather than guess (design doc §1).
