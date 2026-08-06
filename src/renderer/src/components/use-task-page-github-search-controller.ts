import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, MutableRefObject } from 'react'
import { toast } from 'sonner'

import type { PRFilterChange } from '@/components/github/PRFilterDropdowns'
import { translate } from '@/i18n/i18n'
import type { AppState } from '@/store'
import { shouldSuppressEnterSubmit } from '@/lib/new-workspace-enter-guard'
import { getTaskPresetQuery } from '../../../shared/task-view-preset-query'
import { parseTaskQuery, withQualifier } from '../../../shared/task-query'
import type { TaskViewPresetId } from '../../../shared/types'
import type { GitHubModeButton, GitHubTaskKind } from './task-page-localized-options'
import {
  getDefaultPresetForGitHubTaskKind,
  getGitHubTaskKind,
  scopeGitHubTaskSearch
} from './task-page-query-model'

const TASK_SEARCH_DEBOUNCE_MS = 300

type Props = {
  initialTaskQuery: string
  defaultTaskViewPreset: TaskViewPresetId
  taskResumeApplied: boolean
  githubSearchPersistReadyRef: MutableRefObject<boolean>
  setTaskResumeState: AppState['setTaskResumeState']
  updateSettings: AppState['updateSettings']
}

export function useTaskPageGitHubSearchController({
  initialTaskQuery,
  defaultTaskViewPreset,
  taskResumeApplied,
  githubSearchPersistReadyRef,
  setTaskResumeState,
  updateSettings
}: Props) {
  const [githubMode, setGithubMode] = useState<'items' | 'project'>('items')
  const [taskSearchInput, setTaskSearchInput] = useState(initialTaskQuery)
  const [appliedTaskSearch, setAppliedTaskSearch] = useState(initialTaskQuery)
  const taskSearchInputRef = useRef<HTMLInputElement>(null)
  const [activeTaskPreset, setActiveTaskPreset] = useState<TaskViewPresetId | null>(
    defaultTaskViewPreset
  )
  const [tasksLoading, setTasksLoading] = useState(false)
  const [tasksRefreshing, setTasksRefreshing] = useState(false)
  const [tasksFiltering, setTasksFiltering] = useState(false)
  const [tasksError, setTasksError] = useState<string | null>(null)
  const [failedCount, setFailedCount] = useState(0)
  const [githubUnavailable, setGithubUnavailable] = useState(false)
  const [taskRefreshNonce, setTaskRefreshNonce] = useState(0)
  const [retryingSourceKeys, setRetryingSourceKeys] = useState<ReadonlySet<string>>(() => new Set())
  const activeGithubTaskKind = getGitHubTaskKind(activeTaskPreset, appliedTaskSearch)
  const appliedTaskQuery = useMemo(() => parseTaskQuery(appliedTaskSearch), [appliedTaskSearch])

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    const timeout = window.setTimeout(() => {
      const scoped = scopeGitHubTaskSearch(taskSearchInput, activeGithubTaskKind)
      if (scoped !== appliedTaskSearch) {
        setTasksFiltering(true)
      }
      setAppliedTaskSearch(scoped)
    }, TASK_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [activeGithubTaskKind, appliedTaskSearch, taskResumeApplied, taskSearchInput])

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (!githubSearchPersistReadyRef.current) {
      githubSearchPersistReadyRef.current = true
      return
    }
    setTaskResumeState({
      githubItemsPreset: activeTaskPreset,
      githubItemsQuery: appliedTaskSearch.trim()
    })
  }, [
    activeTaskPreset,
    appliedTaskSearch,
    githubSearchPersistReadyRef,
    setTaskResumeState,
    taskResumeApplied
  ])

  const applyPRFilterChange = useCallback(
    (change: PRFilterChange): void => {
      let next = scopeGitHubTaskSearch(taskSearchInput, activeGithubTaskKind)
      if ('author' in change) {
        next = withQualifier(next, 'author', change.author ?? null)
      }
      if ('assignee' in change) {
        next = withQualifier(next, 'assignee', change.assignee ?? null)
      }
      if ('labels' in change) {
        next = withQualifier(next, 'labels', change.labels ?? [])
      }
      if ('state' in change && change.state) {
        next = withQualifier(next, 'state', change.state)
        if (change.state !== 'open') {
          next = withQualifier(next, 'draft', null)
        }
      }
      if ('draft' in change) {
        next = withQualifier(next, 'draft', change.draft ? 'true' : 'false')
      }
      if ('reviewer' in change) {
        const reviewer = change.reviewer ?? null
        if (reviewer === null) {
          next = withQualifier(next, 'reviewRequested', null)
          next = withQualifier(next, 'reviewedBy', null)
        } else if (reviewer.kind === 'requested') {
          next = withQualifier(next, 'reviewedBy', null)
          next = withQualifier(next, 'reviewRequested', reviewer.login)
        } else {
          next = withQualifier(next, 'reviewRequested', null)
          next = withQualifier(next, 'reviewedBy', reviewer.login)
        }
      }
      setTaskSearchInput(next)
      setAppliedTaskSearch(next)
      setActiveTaskPreset(null)
      setTaskResumeState({ githubItemsPreset: null, githubItemsQuery: next })
      setTasksFiltering(true)
      setTaskRefreshNonce((current) => current + 1)
    },
    [activeGithubTaskKind, setTaskResumeState, taskSearchInput]
  )
  const handleApplyTaskSearch = useCallback((): void => {
    const scoped = scopeGitHubTaskSearch(taskSearchInput, activeGithubTaskKind)
    setTaskSearchInput(scoped)
    setAppliedTaskSearch(scoped)
    setActiveTaskPreset(null)
    setTaskResumeState({ githubItemsPreset: null, githubItemsQuery: scoped })
    setTasksFiltering(true)
    setTaskRefreshNonce((current) => current + 1)
  }, [activeGithubTaskKind, setTaskResumeState, taskSearchInput])
  const handleTaskSearchChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>): void => {
      const next = event.target.value
      setTaskSearchInput(next)
      setActiveTaskPreset(null)
      setTasksFiltering(scopeGitHubTaskSearch(next, activeGithubTaskKind) !== appliedTaskSearch)
    },
    [activeGithubTaskKind, appliedTaskSearch]
  )
  const handleSetDefaultTaskPreset = useCallback(
    (presetId: TaskViewPresetId): void => {
      void updateSettings({ defaultTaskViewPreset: presetId }).catch(() => {
        toast.error(
          translate('auto.components.TaskPage.fe380f306c', 'Failed to save default task view.')
        )
      })
    },
    [updateSettings]
  )
  const handleSelectGithubTaskKind = useCallback(
    (kind: GitHubTaskKind): void => {
      const preset = getDefaultPresetForGitHubTaskKind(kind)
      const query = getTaskPresetQuery(preset)
      setTaskSearchInput(query)
      setAppliedTaskSearch(query)
      setActiveTaskPreset(preset)
      setTaskResumeState({ githubItemsPreset: preset, githubItemsQuery: query })
      setTasksFiltering(true)
      setTaskRefreshNonce((current) => current + 1)
    },
    [setTaskResumeState]
  )
  const handleResetGithubTaskSearch = useCallback((): void => {
    handleSelectGithubTaskKind(activeGithubTaskKind)
  }, [activeGithubTaskKind, handleSelectGithubTaskKind])
  const handleTaskSearchKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key !== 'Enter') {
        return
      }
      if (
        shouldSuppressEnterSubmit(
          { isComposing: event.nativeEvent.isComposing, shiftKey: event.shiftKey },
          false
        )
      ) {
        return
      }
      event.preventDefault()
      handleApplyTaskSearch()
    },
    [handleApplyTaskSearch]
  )
  const handleGithubModeChange = useCallback(
    (mode: GitHubModeButton['id']) => {
      if (mode === 'project') {
        setGithubMode('project')
        setTaskResumeState({ githubMode: 'project' })
        return
      }
      setGithubMode('items')
      setTaskResumeState({ githubMode: 'items' })
      handleSelectGithubTaskKind(mode)
    },
    [handleSelectGithubTaskKind, setTaskResumeState]
  )
  const handleGithubPresetSelect = useCallback(
    (preset: { id: TaskViewPresetId; query: string }) => {
      setTaskSearchInput(preset.query)
      setAppliedTaskSearch(preset.query)
      setActiveTaskPreset(preset.id)
      setTaskResumeState({ githubItemsPreset: preset.id, githubItemsQuery: preset.query })
      setTaskRefreshNonce((current) => current + 1)
    },
    [setTaskResumeState]
  )
  const handleRefreshGithubTasks = useCallback((): void => {
    setTasksRefreshing(true)
    setTaskRefreshNonce((current) => current + 1)
  }, [])

  return {
    githubMode,
    setGithubMode,
    taskSearchInput,
    setTaskSearchInput,
    appliedTaskSearch,
    setAppliedTaskSearch,
    taskSearchInputRef,
    activeTaskPreset,
    setActiveTaskPreset,
    activeGithubTaskKind,
    appliedTaskQuery,
    tasksLoading,
    setTasksLoading,
    tasksRefreshing,
    setTasksRefreshing,
    tasksFiltering,
    setTasksFiltering,
    tasksError,
    setTasksError,
    failedCount,
    setFailedCount,
    githubUnavailable,
    setGithubUnavailable,
    taskRefreshNonce,
    setTaskRefreshNonce,
    retryingSourceKeys,
    setRetryingSourceKeys,
    githubTasksBusy: tasksLoading || tasksRefreshing || tasksFiltering,
    applyPRFilterChange,
    handleTaskSearchChange,
    handleSetDefaultTaskPreset,
    handleResetGithubTaskSearch,
    handleTaskSearchKeyDown,
    handleSelectGithubTaskKind,
    handleGithubModeChange,
    handleGithubPresetSelect,
    handleRefreshGithubTasks
  }
}

export type TaskPageGitHubSearchController = ReturnType<typeof useTaskPageGitHubSearchController>
