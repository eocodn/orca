import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import { useRepoLabels, useRepoAssignees, useImmediateMutation } from '@/hooks/useIssueMetadata'
import { useRepoLabelsBySlug, useRepoAssigneesBySlug } from '@/hooks/useGitHubSlugMetadata'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import {
  buildTaskPageGitHubCloseUpdate,
  getTaskPageGitHubDuplicateCandidates,
  getTaskPageGitHubDuplicateTargetErrorMessage,
  validateTaskPageGitHubDuplicateTarget,
  type TaskPageGitHubCloseAction
} from '@/components/task-page-github-status-actions'
import { parseOwnerRepoFromItemUrl } from '@/components/github-work-item-display'
import { translate } from '@/i18n/i18n'
import { getGitHubRepositoryLabelsUrl, type GitHubItemDialogProjectOrigin } from './github-item-dialog-model'
import { runIssueUpdate } from './github-item-dialog-mutations'
import { GitHubItemEditStatusPopover } from './github-item-dialog-edit-status'
import {
  GitHubItemEditToolbar,
  GitHubItemEditTopColumns
} from './github-item-dialog-edit-layout'
import { getTaskSourceRuntimeSettings, type TaskSourceContext } from '../../../shared/task-source-context'
import type { GitHubWorkItem } from '../../../shared/types'

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

  const renderIssueStatusPopover = (variant: 'sidebar' | 'pill'): React.JSX.Element => (
    <GitHubItemEditStatusPopover
      variant={variant}
      item={item}
      localState={localState}
      isPending={isPending}
      statusPopoverOpen={statusPopoverOpen}
      duplicatePickerOpen={duplicatePickerOpen}
      duplicateSearch={duplicateSearch}
      duplicateError={duplicateError}
      duplicatePickerTitle={duplicatePickerTitle}
      directDuplicateTarget={directDuplicateTarget}
      filteredDuplicateCandidates={filteredDuplicateCandidates}
      handleStatusPopoverOpenChange={handleStatusPopoverOpenChange}
      setDuplicatePickerOpen={setDuplicatePickerOpen}
      setDuplicateSearch={setDuplicateSearch}
      setDuplicateError={setDuplicateError}
      handleDuplicateSearchSubmit={handleDuplicateSearchSubmit}
      closeAsDuplicate={closeAsDuplicate}
      handleStateChange={handleStateChange}
    />
  )
  if (item.type === 'pr') {
    return null
  }

  if (layout === 'top-columns') {
    // Why: lay property fields as top columns so the description isn't squeezed by a right rail.
    return (
      <GitHubItemEditTopColumns
        item={item}
        localState={localState}
        localLabels={localLabels}
        localAssignees={localAssignees}
        attachedWorkspaceLabel={attachedWorkspaceLabel}
        hasAttachedWorkspace={hasAttachedWorkspace}
        isPending={isPending}
        repoLabels={repoLabels}
        repoAssignees={repoAssignees}
        repositoryLabelsUrl={repositoryLabelsUrl}
        labelPopoverOpen={labelPopoverOpen}
        assigneePopoverOpen={assigneePopoverOpen}
        setLabelPopoverOpen={setLabelPopoverOpen}
        setAssigneePopoverOpen={setAssigneePopoverOpen}
        handleLabelToggle={handleLabelToggle}
        handleAssigneeToggle={handleAssigneeToggle}
        handleOpenOrUseWorkspace={handleOpenOrUseWorkspace}
        onUse={onUse}
        renderIssueStatusPopover={renderIssueStatusPopover}
      />
    )
  }
  return (
    <GitHubItemEditToolbar
      item={item}
      localState={localState}
      localLabels={localLabels}
      localAssignees={localAssignees}
      attachedWorkspaceLabel={attachedWorkspaceLabel}
      hasAttachedWorkspace={hasAttachedWorkspace}
      isPending={isPending}
      repoLabels={repoLabels}
      repoAssignees={repoAssignees}
      repositoryLabelsUrl={repositoryLabelsUrl}
      labelPopoverOpen={labelPopoverOpen}
      assigneePopoverOpen={assigneePopoverOpen}
      setLabelPopoverOpen={setLabelPopoverOpen}
      setAssigneePopoverOpen={setAssigneePopoverOpen}
      handleLabelToggle={handleLabelToggle}
      handleAssigneeToggle={handleAssigneeToggle}
      handleOpenOrUseWorkspace={handleOpenOrUseWorkspace}
      onUse={onUse}
      renderIssueStatusPopover={renderIssueStatusPopover}
    />
  )
}
