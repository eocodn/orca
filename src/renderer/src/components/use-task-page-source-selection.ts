import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import { translate } from '@/i18n/i18n'
import { getScreenSubmitShortcutLabel } from '@/lib/screen-submit-shortcut'
import {
  getDefaultTaskRepoSelection,
  getTaskEligibleRepos,
  getTaskProjectPickerGroups,
  normalizeTaskRepoSelection
} from '@/components/task-page-default-repo-selection'
import {
  normalizeVisibleTaskProviders,
  restoreAvailableDefaultTaskProvider,
  resolveVisibleTaskProvider
} from '../../../shared/task-providers'
import { getTaskPresetQuery } from '../../../shared/task-view-preset-query'
import { normalizeGitHubTaskPreset } from './task-page-query-model'
import {
  getSourceOptions,
  getGitHubModeButtons,
  getLinearModeOptions,
  getJiraPresets,
  getGitLabIssueFilters,
  getGitLabMRFilters,
  getLinearViewOptions,
  getLinearGroupOptions,
  getLinearOrderOptions,
  getLinearDisplayProperties
} from './task-page-localized-options'
import type { TaskProvider } from '../../../shared/types'
import type { useTaskPageStoreBindings } from './use-task-page-store-bindings'

function areStringSetsEqual(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  if (a.size !== b.size) {
    return false
  }
  for (const value of a) {
    if (!b.has(value)) {
      return false
    }
  }
  return true
}

type TaskPageStoreBindings = ReturnType<typeof useTaskPageStoreBindings>

export function useTaskPageSourceSelection(store: TaskPageStoreBindings) {
  const {
    settings,
    pageData,
    repos,
    updateSettings,
    linearStatus,
    linearStatusChecked,
    linearStatusContextKey,
    preflightStatus,
    preflightStatusContextKey,
    expectedPreflightContextKey,
    jiraStatus,
    jiraStatusChecked,
    jiraStatusContextKey
  } = store

  const providerRuntimeContextKey = getProviderRuntimeContextKey(settings)
  const providerRuntimeContextKeyRef = useRef(providerRuntimeContextKey)
  providerRuntimeContextKeyRef.current = providerRuntimeContextKey
  const linearStatusCurrent = linearStatusContextKey === providerRuntimeContextKey
  const jiraStatusCurrent = jiraStatusContextKey === providerRuntimeContextKey
  const preflightStatusCurrent = preflightStatusContextKey === expectedPreflightContextKey
  const linearStatusReady = linearStatusCurrent && linearStatusChecked
  const jiraStatusReady = jiraStatusCurrent && jiraStatusChecked
  const linearConnected = linearStatusCurrent && linearStatus.connected
  const jiraConnected = jiraStatusCurrent && jiraStatus.connected
  const submitShortcutLabel = getScreenSubmitShortcutLabel()
  const eligibleRepos = useMemo(() => getTaskEligibleRepos(repos), [repos])

  // Why: initial selection precedence — explicit preselection > persisted defaultRepoSelection > all eligible; preselection wins so "open tasks for this repo" lands single-repo.
  const resolvedInitialSelection = useMemo<ReadonlySet<string>>(() => {
    const preferred = pageData.preselectedRepoId
    if (preferred && eligibleRepos.some((repo) => repo.id === preferred)) {
      return new Set([preferred])
    }
    const persisted = settings?.defaultRepoSelection
    if (Array.isArray(persisted)) {
      const filtered = persisted.filter((id) => eligibleRepos.some((r) => r.id === id))
      if (filtered.length > 0) {
        return normalizeTaskRepoSelection(eligibleRepos, new Set(filtered))
      }
      // Why: empty after filtering (all persisted repos removed) falls through to the automatic default so the page never renders an empty selection.
    }
    return getDefaultTaskRepoSelection(eligibleRepos)
  }, [eligibleRepos, pageData.preselectedRepoId, settings?.defaultRepoSelection])

  const [repoSelection, setRepoSelection] = useState<ReadonlySet<string>>(resolvedInitialSelection)
  const taskPickerGroups = useMemo(
    () => getTaskProjectPickerGroups(eligibleRepos, repoSelection),
    [eligibleRepos, repoSelection]
  )
  const taskPickerRepos = useMemo(
    () => taskPickerGroups.map((group) => group.repo),
    [taskPickerGroups]
  )

  // Why: prune removed repos and preserve sticky-all (selection == all projects stays == all), without recreating the Set each time and churning the fetch effect.
  const prevTaskPickerCountRef = useRef(taskPickerRepos.length)
  useEffect(() => {
    const prevCount = prevTaskPickerCountRef.current
    prevTaskPickerCountRef.current = taskPickerRepos.length
    const eligibleIds = new Set(eligibleRepos.map((r) => r.id))
    const wasAll = repoSelection.size === prevCount && prevCount > 0
    const pruned = new Set<string>()
    for (const id of repoSelection) {
      if (eligibleIds.has(id)) {
        pruned.add(id)
      }
    }
    if (wasAll) {
      const allNow = new Set(taskPickerRepos.map((repo) => repo.id))
      if (!areStringSetsEqual(allNow, repoSelection)) {
        setRepoSelection(allNow)
      }
      return
    }
    if (pruned.size === 0 && eligibleIds.size === 0) {
      return
    }
    const normalized = normalizeTaskRepoSelection(eligibleRepos, pruned)
    if (!areStringSetsEqual(normalized, repoSelection)) {
      setRepoSelection(normalized)
    }
  }, [eligibleRepos, repoSelection, taskPickerRepos])

  const selectedRepos = useMemo(
    () => eligibleRepos.filter((r) => repoSelection.has(r.id)),
    [eligibleRepos, repoSelection]
  )

  // Why: many affordances need *a* repo; use the first selected as default, while cross-repo dialogs still let the user override per-action.
  const primaryRepo = selectedRepos[0] ?? null
  const linearWorkspaces = linearStatus.workspaces ?? []
  const selectedLinearWorkspaceId =
    linearStatus.selectedWorkspaceId ??
    linearStatus.activeWorkspaceId ??
    linearWorkspaces[0]?.id ??
    null
  const selectedLinearWorkspace =
    selectedLinearWorkspaceId && selectedLinearWorkspaceId !== 'all'
      ? (linearWorkspaces.find((workspace) => workspace.id === selectedLinearWorkspaceId) ?? null)
      : null
  const jiraSites = useMemo(() => jiraStatus.sites ?? [], [jiraStatus.sites])
  const selectedJiraSiteId =
    jiraStatus.selectedSiteId ?? jiraStatus.activeSiteId ?? jiraSites[0]?.id ?? null
  const selectedJiraSite =
    selectedJiraSiteId && selectedJiraSiteId !== 'all'
      ? (jiraSites.find((site) => site.id === selectedJiraSiteId) ?? null)
      : null
  const preferredVisibleTaskProviders = useMemo(
    () => normalizeVisibleTaskProviders(settings?.visibleTaskProviders),
    [settings?.visibleTaskProviders]
  )
  const defaultTaskSource = settings?.defaultTaskSource ?? 'github'
  const visibleTaskProviders = useMemo(
    () =>
      restoreAvailableDefaultTaskProvider(
        preferredVisibleTaskProviders,
        {
          gitlabInstalled: preflightStatusCurrent && preflightStatus?.glab?.installed === true,
          linearConnected: linearConnected === true
        },
        defaultTaskSource
      ),
    [
      defaultTaskSource,
      linearConnected,
      preferredVisibleTaskProviders,
      preflightStatusCurrent,
      preflightStatus?.glab?.installed
    ]
  )
  const sourceOptions = getSourceOptions()
  const githubModeButtons = getGitHubModeButtons()
  const linearModeOptions = getLinearModeOptions()
  const jiraPresets = getJiraPresets()
  const gitLabIssueFilters = getGitLabIssueFilters()
  const gitLabMRFilters = getGitLabMRFilters()
  const linearViewOptions = getLinearViewOptions()
  const linearGroupOptions = getLinearGroupOptions()
  const linearOrderOptions = getLinearOrderOptions()
  const linearDisplayPropertyOptions = getLinearDisplayProperties()
  const visibleSourceOptions = useMemo(
    () => sourceOptions.filter((source) => visibleTaskProviders.includes(source.id)),
    [sourceOptions, visibleTaskProviders]
  )
  const hideTaskSource = useCallback(
    (provider: TaskProvider, label: string) => {
      const visibleWithoutProvider = preferredVisibleTaskProviders.filter(
        (visibleProvider) => visibleProvider !== provider
      )
      // Why: an empty provider list normalizes to "all providers", so keep one other source visible or hiding this one has no effect.
      const nextVisibleTaskProviders: TaskProvider[] =
        visibleWithoutProvider.length > 0 ? visibleWithoutProvider : ['github']
      const nextDefaultTaskSource = resolveVisibleTaskProvider(
        defaultTaskSource,
        nextVisibleTaskProviders
      )

      void updateSettings({
        visibleTaskProviders: nextVisibleTaskProviders,
        defaultTaskSource: nextDefaultTaskSource
      }).catch(() => {
        toast.error(
          translate('auto.components.TaskPage.e9139db03f', 'Failed to hide {{value0}}.', {
            value0: label
          })
        )
      })
    },
    [defaultTaskSource, preferredVisibleTaskProviders, updateSettings]
  )

  // Why: seed preset + query synchronously so the first fetch issues one request; a prior post-mount re-seed caused a throwaway empty-query fetch, doubling time-to-first-paint.
  const defaultTaskViewPreset = normalizeGitHubTaskPreset(settings?.defaultTaskViewPreset ?? 'all')
  const initialTaskQuery = getTaskPresetQuery(defaultTaskViewPreset)

  const preferredTaskSource = pageData.taskSource ?? defaultTaskSource
  const [taskSource, setTaskSource] = useState<TaskProvider>(
    resolveVisibleTaskProvider(preferredTaskSource, visibleTaskProviders)
  )

  return {
    providerRuntimeContextKey,
    providerRuntimeContextKeyRef,
    linearStatusCurrent,
    jiraStatusCurrent,
    preflightStatusCurrent,
    linearStatusReady,
    jiraStatusReady,
    linearConnected,
    jiraConnected,
    submitShortcutLabel,
    eligibleRepos,
    resolvedInitialSelection,
    taskPickerGroups,
    taskPickerRepos,
    repoSelection,
    setRepoSelection,
    prevTaskPickerCountRef,
    selectedRepos,
    primaryRepo,
    linearWorkspaces,
    selectedLinearWorkspaceId,
    selectedLinearWorkspace,
    jiraSites,
    selectedJiraSiteId,
    selectedJiraSite,
    preferredVisibleTaskProviders,
    defaultTaskSource,
    visibleTaskProviders,
    sourceOptions,
    githubModeButtons,
    linearModeOptions,
    jiraPresets,
    gitLabIssueFilters,
    gitLabMRFilters,
    linearViewOptions,
    linearGroupOptions,
    linearOrderOptions,
    linearDisplayPropertyOptions,
    visibleSourceOptions,
    hideTaskSource,
    defaultTaskViewPreset,
    initialTaskQuery,
    preferredTaskSource,
    taskSource,
    setTaskSource
  }
}

export type TaskPageSourceSelection = ReturnType<typeof useTaskPageSourceSelection>
