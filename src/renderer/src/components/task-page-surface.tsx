import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'

import { useAppStore } from '@/store'
import { useTaskPageStoreBindings } from './use-task-page-store-bindings'
import { useTaskPageSourceSelection } from './use-task-page-source-selection'
import { useTaskPageProviderContext } from './use-task-page-provider-context'
import { useTaskPageGitLabData } from './use-task-page-gitlab-data'
import { TaskPageGitLabTodosTable } from './task-page-gitlab-todos-table'
import { TaskPageGitLabItemsTable } from './task-page-gitlab-items-table'
import { TaskPageGitHubItemsTable } from './task-page-github-items-table'
import { TaskPageJiraIssueDialog } from './task-page-jira-issue-dialog'
import { GHAssigneesCell } from './task-page-github-assignees-cell'
import { GHStatusCell } from './task-page-github-status-cell'
import { PRReviewCell } from './task-page-github-review-cell'
import { TaskPageGitHubIssueDialog } from './task-page-github-issue-dialog'
import { TaskPageLinearProjectDialog } from './task-page-linear-project-dialog'
import { TaskPageLinearIssueDialog } from './task-page-linear-issue-dialog'
import { getLinearIssueGridTemplate, getJiraStatusTone } from './task-page-linear-cells'
import { PRChecksCell, PRMergeCell } from './task-page-github-pr-cells'
import { TaskPageLinearCollectionViews } from './task-page-linear-collection-views'
import { TaskPageLinearToolbar } from './task-page-linear-toolbar'
import { TaskPageProviderScopeControls } from './task-page-provider-scope-controls'
import { Button } from '@/components/ui/button'
import { JiraConnectDialog } from '@/components/jira-connect-dialog'
import { LinearApiKeyDialog } from '@/components/linear-api-key-dialog'
import { reconcileLinearTeamSelection } from '@/components/task-page-linear-team-selection'
import {
  getGitHubWorkItemWorkspaceSeed,
  getGitLabWorkItemWorkspaceSeed,
  getJiraIssueWorkspaceSeed,
  getTaskPageRepoSourceContext
} from './task-page-source-context'
import { parseTaskQuery, stripRepoQualifiers, withQualifier } from '../../../shared/task-query'
import {
  buildLinearTeamUrl,
  getLinearOrganizationUrlKeyFromIssueUrl
} from '../../../shared/linear-links'
import type { PRFilterChange } from '@/components/github/PRFilterDropdowns'
import { buildGitHubRepoUrl } from '@/lib/github-links'
import { findGithubWorkItemWorkspaceAttachment } from '@/lib/github-work-item-workspace-attachment'
import { createGitHubWorkItemWorkspaceInBackground } from '@/lib/github-work-item-background-create'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import GitHubItemDialog from '@/components/GitHubItemDialog'
import PullRequestPage from '@/components/PullRequestPage'
import GitLabItemDialog from '@/components/GitLabItemDialog'
import ProjectViewWrapper from '@/components/github-project/ProjectViewWrapper'
import LinearIssueWorkspace from '@/components/LinearIssueWorkspace'
import { TaskPageLinearIssueBody } from './task-page-linear-issue-body'
import { useTaskPageLinearComposerState } from './use-task-page-linear-composer-state'
import { useTaskPageLinearDetailState } from './use-task-page-linear-detail-state'
import { useTaskPageJiraDetailState } from './use-task-page-jira-detail-state'
import { useTaskPageJiraIssueCreationState } from './use-task-page-jira-issue-creation-state'
import { useTaskPageJiraComposerState } from './use-task-page-jira-composer-state'
import { useTaskPageGitHubNewIssueState } from './use-task-page-github-new-issue-state'
import { useTaskPageGitHubIssueCreationState } from './use-task-page-github-issue-creation-state'
import { useTaskPageGitHubPaginationState } from './use-task-page-github-pagination-state'
import { useTaskPageLinearIssueCreationState } from './use-task-page-linear-issue-creation-state'
import { useTaskPageLinearProjectDetailState } from './use-task-page-linear-project-detail-state'
import { useTaskPageLinearProjectCreationState } from './use-task-page-linear-project-creation-state'
import { useTaskPageLinearProjectIssuesState } from './use-task-page-linear-project-issues-state'
import { useTaskPageLinearResumeState } from './use-task-page-linear-resume-state'
import { useTaskPageLinearCustomViewDataState } from './use-task-page-linear-custom-view-data-state'
import { useTaskPageProviderDialogState } from './use-task-page-provider-dialog-state'
import { useTaskPageJiraListDataState } from './use-task-page-jira-list-data-state'
import { cn } from '@/lib/utils'
import {
  getTaskPresetQuery,
  PER_REPO_FETCH_LIMIT,
  CROSS_REPO_DISPLAY_LIMIT
} from '@/lib/new-workspace'
import type { LinkedWorkItemSummary } from '@/lib/new-workspace'
import { buildLinearIssueLinkedWorkItem } from '@/lib/linear-linked-work-item'
import {
  readLinearBoardIssueDragData,
  writeLinearBoardIssueDragData
} from '@/lib/linear-board-drag-payload'
import { getLinearIssueWorkspaceName } from '../../../shared/workspace-name'
import { findTaskPageJiraIssue } from '@/components/task-page-jira-cache-selectors'
import {
  buildTaskPageRepoSourceState,
  deriveTaskPageGitHubWorkItemsFetchOptions,
  reconcileTaskPageLinearIssuesAfterLandingRefresh,
  reconcileTaskPagePagesAfterLandingRefresh,
  reconcileTaskPagePagesWithWorkItemsCache,
  shouldResetTaskPagePaginationAfterLandingRefresh,
  selectTaskPageUnresolvedSourceRepos,
  shouldReplaceTaskPageItemsAfterRefresh,
  type TaskPageRepoSourceState
} from '@/components/task-page-cache-selectors'
import { shouldHideTaskPageListChrome } from '@/components/task-page-list-chrome-visibility'
import {
  getTaskPagePerRepoLimit,
  taskPageToGitHubApiPage
} from '@/components/task-page-work-item-pagination'
import { sortWorkItemsByNumber } from '../../../shared/work-items'
import { resolveLinearIssueAttributeFilterPrimaryTeam } from '@/components/linear-issue-attribute-filter-primary-team'
import {
  buildLinearIssueListReadArgs,
  buildLinearIssueListRequestSignature,
  isLinearIssueSearchActive,
  shouldForceLinearIssueListRead,
  teamDerivedFacetsForPrimaryTeamChange
} from '@/components/task-page-linear-issue-request'
import {
  emptyLinearIssueAttributeFilter,
  linearIssueAttributeFilterSignature,
  type LinearIssueAttributeFilter
} from '../../../shared/linear-issue-attribute-filter'
import {
  resolveNewIssueOpenSeed,
  resolveUserRepoSwitchReset
} from '@/components/task-page-new-issue-draft'
import { getRepoBackedTaskEmptyState } from '@/components/task-page-empty-state'
import type { TaskPageJiraLoadError } from '@/components/task-page-jira-load-state'
import { deriveTaskPagePRCheckSummary } from '@/components/task-page-pr-check-summary'
import type {
  GitHubWorkItem,
  GitLabWorkItem,
  LinearCollectionResult,
  LinearCustomViewSummary,
  JiraIssue,
  JiraProject,
  JiraProjectStatusOrder,
  JiraPriority,
  LinearIssue,
  LinearProjectDetail,
  LinearProjectSummary,
  LinearTeam,
  LinearWorkspaceSelection,
  TaskViewPresetId
} from '../../../shared/types'
import {
  LINEAR_ISSUE_LIST_MAX,
  clampLinearIssueListLimit
} from '../../../shared/linear-issue-read-limits'
import { shouldSuppressEnterSubmit } from '@/lib/new-workspace-enter-guard'
import { useContextualTour } from '@/components/contextual-tours/use-contextual-tour'
import { isScreenSubmitShortcut } from '@/lib/screen-submit-shortcut'
import { linearTeamStates, linearUpdateIssue } from '@/runtime/runtime-linear-client'
import { jiraListProjects, jiraListPriorities } from '@/runtime/runtime-jira-client'
import {
  sortJiraIssues,
  type JiraIssueSortColumn,
  type JiraIssueSortDirection,
  type JiraPrioritiesBySite
} from './jira-issue-sorter'
import { TaskPageJiraListSurface } from './task-page-jira-list-surface'
import { TaskPageJiraToolbar } from './task-page-jira-toolbar'
import { TaskPageGitLabToolbar } from './task-page-gitlab-toolbar'
import { TaskPageLinearIssueHeader } from './task-page-linear-issue-header'
import { TaskPageGitHubScopeToolbar } from './task-page-github-scope-toolbar'
import { TaskPageGitHubTaskToolbar } from './task-page-github-task-toolbar'
import { TaskPageGitHubSourceDivergence } from './task-page-github-source-divergence'
import { TaskPageSourceProviderToolbar } from './task-page-source-provider-toolbar'
import { bindTaskPageJiraItemSourceContext } from './task-page-jira-item-source-context'
import { resolveVisibleTaskProvider } from '../../../shared/task-providers'
import { translate } from '@/i18n/i18n'
import {
  formatRelativeTime,
  getDefaultPresetForGitHubTaskKind,
  getGitHubTaskKind,
  normalizeGitHubTaskPreset,
  scopeGitHubTaskSearch
} from './task-page-query-model'
import { groupLinearIssues, type LinearGroupSection } from './task-page-linear-grouping'
import {
  DEFAULT_LINEAR_DISPLAY_PROPERTIES,
  findLinearWorkflowStateForStatus,
  getLinearStatusSectionState
} from './task-page-linear-model'
import {
  getEffectiveLinearDisplayProperties,
  getLinearIssueListRows,
  getLinearIssuePageState,
  type LinearIssueListRow
} from './task-page-linear-list-model'
import { getJiraProjectSelectionKey } from './task-page-jira-create-model'
import {
  type GitHubTaskKind,
  type GitHubModeButton,
  type GitLabIssueFilter,
  type GitLabTaskFilter,
  type JiraPresetId,
  LinearIcon,
  type LinearDisplayProperty,
  type LinearGroupBy,
  type LinearMode,
  type LinearOrderBy,
  type LinearViewMode
} from '@/components/task-page-localized-options'

const TASK_SEARCH_DEBOUNCE_MS = 300
const LINEAR_ITEM_LIMIT = 36
const PR_CHECKS_EAGER_PREFETCH_LIMIT = 20

const GITHUB_TASK_GRID_CLASS =
  'min-w-[790px] grid-cols-[72px_minmax(320px,1fr)_84px_100px_92px_122px]'
const GITHUB_PR_TASK_GRID_CLASS =
  'min-w-[1020px] grid-cols-[72px_minmax(360px,2fr)_132px_128px_132px_92px_158px]'

type LinearProjectTab = 'overview' | 'issues'

export default function TaskPage(): React.JSX.Element {
  const taskPageStoreBindings = useTaskPageStoreBindings()
  const {
    settings,
    persistedUIReady,
    taskResumeState,
    setTaskResumeState,
    pageData,
    openTaskPage,
    closeTaskPage,
    activeModal,
    repos,
    repoMap,
    allWorktrees,
    openModal,
    updateSettings,
    fetchWorkItemsAcrossRepos,
    fetchPRChecks,
    getCachedWorkItems,
    setIssueSourcePreference,
    workItemsInvalidationNonce,
    linearStatus,
    linearStatusContextKey,
    preflightStatusChecked,
    preflightStatusContextKey,
    selectLinearWorkspace,
    searchLinearIssues,
    listLinearIssues,
    invalidateLinearIssueLists,
    getCachedLinearIssues,
    getCachedLinearTeams,
    listLinearTeams,
    getCachedLinearProjects,
    listLinearProjectsFromStore,
    fetchLinearProject,
    listLinearProjectIssues,
    getCachedLinearCustomViews,
    listLinearCustomViews,
    fetchLinearCustomView,
    listLinearCustomViewIssues,
    listLinearCustomViewProjects,
    patchLinearIssue,
    checkLinearConnection,
    refreshPreflightStatus,
    expectedPreflightContextKey,
    jiraStatus,
    jiraStatusContextKey,
    selectJiraSite,
    searchJiraIssues,
    listJiraIssues,
    checkJiraConnection
  } = taskPageStoreBindings
  const {
    providerRuntimeContextKey,
    providerRuntimeContextKeyRef,
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
    selectedRepos,
    primaryRepo,
    linearWorkspaces,
    selectedLinearWorkspaceId,
    selectedLinearWorkspace,
    jiraSites,
    selectedJiraSiteId,
    selectedJiraSite,
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
  } = useTaskPageSourceSelection(taskPageStoreBindings)
  const {
    getTaskPickerRepoHostLabel,
    linearTaskSourceContext,
    linearListInvalidationVersionForSource,
    jiraTaskSourceContext,
    jiraTaskSourceScopeKey,
    taskSourceAvailabilityNoticeByProvider,
    taskSourceContextSummary,
    taskSourceAvailabilityNotice
  } = useTaskPageProviderContext(taskPageStoreBindings, {
    providerRuntimeContextKey,
    preflightStatusCurrent,
    selectedRepos,
    selectedLinearWorkspaceId,
    selectedLinearWorkspace,
    selectedJiraSiteId,
    selectedJiraSite,
    sourceOptions,
    taskSource
  })
  const githubEmptyState = useMemo(
    () =>
      getRepoBackedTaskEmptyState({
        provider: 'github',
        selectedRepoCount: selectedRepos.length
      }),
    [selectedRepos.length]
  )
  const taskSourceManuallyChangedRef = useRef(false)
  const lastPageTaskSourceRef = useRef(pageData.taskSource)
  const taskResumeAppliedRef = useRef(false)
  const githubSearchPersistReadyRef = useRef(false)
  const linearSearchPersistReadyRef = useRef(false)
  const jiraSearchPersistReadyRef = useRef(false)
  const [taskResumeApplied, setTaskResumeApplied] = useState(false)

  // Why: useState only inits once, so sync taskSource from the store when a sidebar source-icon click changes pageData.taskSource.
  useEffect(() => {
    const pageTaskSourceChanged = lastPageTaskSourceRef.current !== pageData.taskSource
    lastPageTaskSourceRef.current = pageData.taskSource
    if (pageData.taskSource) {
      if (pageTaskSourceChanged) {
        taskSourceManuallyChangedRef.current = false
      } else if (taskSourceManuallyChangedRef.current) {
        return
      }
      setTaskSource(resolveVisibleTaskProvider(pageData.taskSource, visibleTaskProviders))
    }
  }, [pageData.taskSource, visibleTaskProviders])

  useEffect(() => {
    if (taskSourceManuallyChangedRef.current) {
      return
    }
    // Why: GitLab/Linear availability hydrates after mount; restore the saved default once its provider check proves it can be shown.
    if (visibleTaskProviders.includes(preferredTaskSource) && taskSource !== preferredTaskSource) {
      setTaskSource(preferredTaskSource)
    }
  }, [preferredTaskSource, taskSource, visibleTaskProviders])

  useEffect(() => {
    if (!visibleTaskProviders.includes(taskSource)) {
      setTaskSource(resolveVisibleTaskProvider(settings?.defaultTaskSource, visibleTaskProviders))
    }
  }, [settings?.defaultTaskSource, taskSource, visibleTaskProviders])

  // Why: Project mode is a GitHub sub-tab — visible on the GitHub source, but actual entry is gated on a non-null activeProject.
  const projectModeVisible = taskSource === 'github'
  const [githubMode, setGithubMode] = useState<'items' | 'project'>('items')

  const {
    activeGitlabFilter,
    displayedGitLabItems,
    gitlabEmptyState,
    gitlabError,
    gitlabItems,
    gitlabLoading,
    gitlabTodos,
    gitlabTodosLoading,
    gitlabView,
    setGitlabFilter,
    setGitlabRefreshNonce,
    setGitlabView
  } = useTaskPageGitLabData({
    selectedRepos,
    primaryRepo,
    taskSource
  })

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
  // Why: per-repo failure count for the "N of M" banner; IPC rejections use tasksError instead so partial-failure and hard-reject don't double-show.
  const [failedCount, setFailedCount] = useState(0)
  // Why: when every refresh fails (GitHub outage/network/rate limit), attribute it to GitHub instead of showing an empty or stale list as current.
  const [githubUnavailable, setGithubUnavailable] = useState(false)
  const [taskRefreshNonce, setTaskRefreshNonce] = useState(0)
  // Why: lets the fetch effect tell a user refresh-click nonce bump (force=true) from a re-run for another reason (e.g. repo change with nonce > 0).
  const lastFetchedNonceRef = useRef(-1)
  // Why: invalidation-nonce analog of lastFetchedNonceRef; a preference flip must force past fetch-dedupe or the fan-out collapses onto a stale in-flight request from the pre-flip source.
  const lastFetchedInvalidationNonceRef = useRef(0)
  // Why: entering Tasks with fresh cache still verifies remote status once, reconciled into existing rows to avoid a full table shuffle.
  const landingGitHubRefreshKeysRef = useRef<ReadonlySet<string>>(new Set())
  // Why: split the display budget across repos so one provider page maps to one UI page without truncating rows later pages can't return.
  const githubPerRepoPageLimit = getTaskPagePerRepoLimit(
    selectedRepos.length,
    PER_REPO_FETCH_LIMIT,
    CROSS_REPO_DISPLAY_LIMIT
  )
  const {
    countedTotalPages,
    currentPage,
    fetchWorkItemsNextPage,
    githubPageSize,
    loadingTargetPage,
    paginationGenerationRef,
    paginationLoading,
    pages,
    setCountedTotalPages,
    setCurrentPage,
    setLoadingTargetPage,
    setPages,
    setPaginationLoading,
    countWorkItemsAcrossRepos
  } = useTaskPageGitHubPaginationState({
    appliedTaskSearch,
    initialTaskQuery,
    githubPerRepoPageLimit,
    getCachedWorkItems,
    selectedRepos,
    workItemsInvalidationNonce
  })

  const {
    dialogInitialTab,
    dialogRepoPath,
    dialogSourceContext,
    dialogWorkItem,
    gitlabDialogItem,
    gitlabDialogRepo,
    gitlabDialogSourceContext,
    handleDialogReviewRequestsChange,
    openGitHubDetailPage,
    openGitLabDetailPage,
    patchTaskPageWorkItemRows,
    selectedWorkItemsCacheEntries,
    setDialogWorkItem
  } = useTaskPageProviderDialogState({
    appliedTaskSearch,
    githubPerRepoPageLimit,
    pageData,
    primaryRepo,
    repoMap,
    selectedRepos,
    openTaskPage,
    setGithubMode,
    setPages
  })

  // Why: the per-repo issue-source indicator and retry banner both derive from the same workItemsCache entry, so no extra IPC.
  // Why: subscribe only to entries this page renders; the selector returns entry refs so shallow equality filters unrelated cache writes.
  const perRepoSourceState = useMemo<TaskPageRepoSourceState[]>(
    () => buildTaskPageRepoSourceState(selectedRepos, selectedWorkItemsCacheEntries),
    [selectedRepos, selectedWorkItemsCacheEntries]
  )

  // Why: repos that fetched but resolved no GitHub source (#9660) show empty like a genuine zero-result; surface them explicitly with Retry.
  const unresolvedSourceRepos = useMemo(
    () => selectTaskPageUnresolvedSourceRepos(selectedRepos, perRepoSourceState),
    [selectedRepos, perRepoSourceState]
  )

  useEffect(() => {
    if (taskSource !== 'github' || githubMode !== 'items') {
      return
    }
    // Why: inline/dialog edits patch workItemsCache; the paged table renders from a local snapshot, so copy patched rows across.
    setPages((current) =>
      reconcileTaskPagePagesWithWorkItemsCache(current, selectedWorkItemsCacheEntries)
    )
  }, [githubMode, selectedWorkItemsCacheEntries, setPages, taskSource])

  // Why: one-time toast per repo when the 'upstream' preference fell back to origin (ref-gated); deliberately don't auto-reset the preference so re-adding upstream later still applies.
  const fellBackToastedRef = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (taskSource !== 'github') {
      return
    }
    for (const [index, r] of selectedRepos.entries()) {
      const entry = selectedWorkItemsCacheEntries[index]
      if (!entry?.issueSourceFellBack) {
        continue
      }
      if (fellBackToastedRef.current.has(r.id)) {
        continue
      }
      const prSlug = entry.sources?.prs
        ? `${entry.sources.prs.owner}/${entry.sources.prs.repo}`
        : r.displayName
      toast.message(
        translate(
          'auto.components.TaskPage.f4374519ae',
          'Your preferred issue source (upstream) is no longer configured for {{value0}}. Using origin.',
          { value0: prSlug }
        )
      )
      fellBackToastedRef.current.add(r.id)
    }
  }, [selectedRepos, selectedWorkItemsCacheEntries, taskSource])

  // Why: partial-failure retry leaves the cache populated so tasksLoading never flips, giving no feedback; track retry-in-flight per source so only the clicked banner shows "Retrying…".
  const [retryingSourceKeys, setRetryingSourceKeys] = useState<ReadonlySet<string>>(() => new Set())

  const handleRetryIssuesFetch = useCallback(
    (sourceKey: string) => {
      const source = perRepoSourceState.find((s) => s.sourceKey === sourceKey)
      if (!source) {
        return
      }
      // Why: nonce bump reuses the fetch path as force=true so retry doesn't dedupe onto a still-failing in-flight request (refreshes all repos; Retrying… stays scoped to the clicked source).
      setRetryingSourceKeys((prev) => {
        const next = new Set(prev)
        next.add(source.sourceKey)
        return next
      })
      setTaskRefreshNonce((n) => n + 1)
    },
    [perRepoSourceState]
  )
  const handleRefreshGithubTasks = useCallback((): void => {
    setTasksRefreshing(true)
    setTaskRefreshNonce((current) => current + 1)
  }, [])
  const {
    newIssueOpen,
    setNewIssueOpen,
    newIssueTitle,
    setNewIssueTitle,
    newIssueBody,
    setNewIssueBody,
    newIssueLabels,
    setNewIssueLabels,
    newIssueAssignees,
    setNewIssueAssignees,
    newIssueSubmitting,
    setNewIssueSubmitting,
    newIssueRepoId,
    setNewIssueRepoId,
    setNewIssueDraft,
    clearNewIssueDraft,
    newIssueTargetRepo,
    newIssueSourceContext,
    newIssueRuntimeTarget,
    newIssueRepoLabels,
    newIssueRepoAssignees
  } = useTaskPageGitHubNewIssueState({ selectedRepos, repos, settings })

  const {
    selectedLinearIssue,
    selectedLinearIssueCanFloat,
    selectedLinearIssueId,
    clearSelectedLinearIssue,
    linearDetailSourceContext,
    openLinearDetailPage,
    openRelatedLinearIssue
  } = useTaskPageLinearDetailState({ pageData, linearTaskSourceContext, openTaskPage })

  const closeTaskDetailPage = useCallback(() => {
    const state = useAppStore.getState()
    const currentEntry = state.worktreeNavHistory[state.worktreeNavHistoryIndex]
    if (
      typeof currentEntry === 'object' &&
      currentEntry.kind === 'task-detail' &&
      state.worktreeNavHistoryIndex > 0
    ) {
      state.goBackWorktree()
      return
    }
    setDialogWorkItem(null)
    clearSelectedLinearIssue()
    useAppStore.setState((s) => ({
      taskPageData: {
        ...s.taskPageData,
        openGitHubWorkItem: undefined,
        openGitHubSourceContext: undefined,
        openGitHubInitialTab: undefined,
        openGitLabWorkItem: undefined,
        openGitLabSourceContext: undefined,
        openLinearIssue: undefined,
        openLinearSourceContext: undefined,
        openJiraIssue: undefined,
        openJiraSourceContext: undefined
      }
    }))
  }, [clearSelectedLinearIssue, setDialogWorkItem])

  const {
    selectedJiraIssue,
    selectedJiraIssueFallback,
    selectedJiraIssueKey,
    setSelectedJiraIssue,
    setSelectedJiraIssueFallback,
    setSelectedJiraIssueKey,
    jiraDetailSourceContext,
    openJiraDetailPage
  } = useTaskPageJiraDetailState({ pageData, jiraTaskSourceContext, openTaskPage })

  // Linear tab state
  const [linearMode, setLinearMode] = useState<LinearMode>('issues')
  const [linearIssues, setLinearIssues] = useState<LinearIssue[]>([])
  const [linearIssueLimit, setLinearIssueLimit] = useState(LINEAR_ITEM_LIMIT)
  const [linearIssuePage, setLinearIssuePage] = useState(0)
  const [linearIssueLoadingTargetPage, setLinearIssueLoadingTargetPage] = useState<number | null>(
    null
  )
  const [linearIssuesHasMore, setLinearIssuesHasMore] = useState(false)
  const [linearLoading, setLinearLoading] = useState(false)
  const [linearError, setLinearError] = useState<string | null>(null)
  const [linearSearchInput, setLinearSearchInput] = useState('')
  const [appliedLinearSearch, setAppliedLinearSearch] = useState('')
  const [linearAttributeFilter, setLinearAttributeFilter] = useState<LinearIssueAttributeFilter>(
    () => emptyLinearIssueAttributeFilter()
  )
  const linearAttributeFilterSignatureRef = useRef(
    linearIssueAttributeFilterSignature(emptyLinearIssueAttributeFilter())
  )
  const linearPrimaryTeamIdRef = useRef<string | null>(null)
  const previousLinearWorkspaceIdForFiltersRef = useRef<string | null | undefined>(undefined)
  const [linearViewMode, setLinearViewMode] = useState<LinearViewMode>('list')
  const [linearGroupBy, setLinearGroupBy] = useState<LinearGroupBy>('none')
  const [linearOrderBy, setLinearOrderBy] = useState<LinearOrderBy>('priority')
  const [linearDisplayProperties, setLinearDisplayProperties] = useState<
    ReadonlySet<LinearDisplayProperty>
  >(() => new Set(DEFAULT_LINEAR_DISPLAY_PROPERTIES))
  const [linearTeamPropertyTouched, setLinearTeamPropertyTouched] = useState(false)
  const [linearRefreshNonce, setLinearRefreshNonce] = useState(0)
  const [linearProjectSearchInput, setLinearProjectSearchInput] = useState('')
  const [appliedLinearProjectSearch, setAppliedLinearProjectSearch] = useState('')
  const [linearProjectsResult, setLinearProjectsResult] = useState<
    LinearCollectionResult<LinearProjectSummary>
  >({ items: [] })
  const [linearProjectsLoading, setLinearProjectsLoading] = useState(false)
  const [linearProjectsError, setLinearProjectsError] = useState<string | null>(null)
  const [selectedLinearProject, setSelectedLinearProject] = useState<LinearProjectSummary | null>(
    null
  )
  const [selectedLinearProjectDetail, setSelectedLinearProjectDetail] =
    useState<LinearProjectDetail | null>(null)
  const [linearProjectDetailLoading, setLinearProjectDetailLoading] = useState(false)
  const [linearProjectDetailError, setLinearProjectDetailError] = useState<string | null>(null)
  const [linearProjectTab, setLinearProjectTab] = useState<LinearProjectTab>('overview')
  const [linearProjectIssuesResult, setLinearProjectIssuesResult] = useState<
    LinearCollectionResult<LinearIssue>
  >({ items: [] })
  const [linearProjectIssueLimit, setLinearProjectIssueLimit] = useState(LINEAR_ITEM_LIMIT)
  const [linearProjectIssuePage, setLinearProjectIssuePage] = useState(0)
  const [linearProjectIssueLoadingTargetPage, setLinearProjectIssueLoadingTargetPage] = useState<
    number | null
  >(null)
  const [linearProjectIssuesLoading, setLinearProjectIssuesLoading] = useState(false)
  const [linearProjectIssuesError, setLinearProjectIssuesError] = useState<string | null>(null)
  const [linearCustomViewsResult, setLinearCustomViewsResult] = useState<
    LinearCollectionResult<LinearCustomViewSummary>
  >({ items: [] })
  const [linearCustomViewsLoading, setLinearCustomViewsLoading] = useState(false)
  const [linearCustomViewsError, setLinearCustomViewsError] = useState<string | null>(null)
  const [selectedLinearCustomView, setSelectedLinearCustomView] =
    useState<LinearCustomViewSummary | null>(null)
  const [linearProjectParentView, setLinearProjectParentView] =
    useState<LinearCustomViewSummary | null>(null)
  const [linearCustomViewIssuesResult, setLinearCustomViewIssuesResult] = useState<
    LinearCollectionResult<LinearIssue>
  >({ items: [] })
  const [linearCustomViewIssueLimit, setLinearCustomViewIssueLimit] = useState(LINEAR_ITEM_LIMIT)
  const [linearCustomViewIssuePage, setLinearCustomViewIssuePage] = useState(0)
  const [linearCustomViewIssueLoadingTargetPage, setLinearCustomViewIssueLoadingTargetPage] =
    useState<number | null>(null)
  const [linearCustomViewProjectsResult, setLinearCustomViewProjectsResult] = useState<
    LinearCollectionResult<LinearProjectSummary>
  >({ items: [] })
  const [linearCustomViewContentsLoading, setLinearCustomViewContentsLoading] = useState(false)
  const [linearCustomViewContentsError, setLinearCustomViewContentsError] = useState<string | null>(
    null
  )
  const [linearBoardDraggingIssueId, setLinearBoardDraggingIssueId] = useState<string | null>(null)
  const [linearBoardDragOverKey, setLinearBoardDragOverKey] = useState<string | null>(null)
  const [linearBoardUpdatingIssueIds, setLinearBoardUpdatingIssueIds] = useState<
    ReadonlySet<string>
  >(() => new Set())
  const lastLinearRequestRef = useRef<{ nonce: number; signature: string } | null>(null)
  const landingLinearRefreshKeysRef = useRef<ReadonlySet<string>>(new Set())
  const linearContextResumeAttemptedRef = useRef(false)

  const patchScopedLinearIssue = useCallback((issueId: string, patch: Partial<LinearIssue>) => {
    const patchResult = (result: LinearCollectionResult<LinearIssue>) => ({
      ...result,
      items: result.items.map((item) => (item.id === issueId ? { ...item, ...patch } : item))
    })
    setLinearProjectIssuesResult(patchResult)
    setLinearCustomViewIssuesResult(patchResult)
  }, [])

  const selectLinearMode = useCallback(
    (mode: LinearMode) => {
      clearSelectedLinearIssue()
      setSelectedLinearProject(null)
      setSelectedLinearProjectDetail(null)
      setSelectedLinearCustomView(null)
      setLinearProjectParentView(null)
      setLinearProjectIssuesResult({ items: [] })
      setLinearProjectIssueLimit(LINEAR_ITEM_LIMIT)
      setLinearProjectIssuePage(0)
      setLinearProjectIssueLoadingTargetPage(null)
      setLinearCustomViewIssuesResult({ items: [] })
      setLinearCustomViewIssueLimit(LINEAR_ITEM_LIMIT)
      setLinearCustomViewIssuePage(0)
      setLinearCustomViewIssueLoadingTargetPage(null)
      setLinearCustomViewProjectsResult({ items: [] })
      setLinearMode(mode)
      setTaskResumeState({ linearMode: mode, linearContext: undefined })
    },
    [clearSelectedLinearIssue, setTaskResumeState]
  )

  const openLinearProjectContext = useCallback(
    (project: LinearProjectSummary, options?: { parentView?: LinearCustomViewSummary | null }) => {
      if (!project.workspaceId) {
        toast.error(
          translate(
            'auto.components.TaskPage.cba2a2b7fb',
            'Linear project is missing workspace context.'
          )
        )
        return
      }
      const parentView = options?.parentView ?? null
      clearSelectedLinearIssue()
      setLinearProjectParentView(parentView)
      if (parentView) {
        setSelectedLinearCustomView(parentView)
      } else {
        setSelectedLinearCustomView(null)
        setLinearCustomViewProjectsResult({ items: [] })
      }
      setLinearProjectIssuesResult({ items: [] })
      setLinearProjectIssueLimit(LINEAR_ITEM_LIMIT)
      setLinearProjectIssuePage(0)
      setLinearProjectIssueLoadingTargetPage(null)
      setLinearCustomViewIssuesResult({ items: [] })
      setLinearCustomViewIssueLimit(LINEAR_ITEM_LIMIT)
      setLinearCustomViewIssuePage(0)
      setLinearCustomViewIssueLoadingTargetPage(null)
      setSelectedLinearProject(project)
      setLinearProjectTab('overview')
      setLinearMode('projects')
      setTaskResumeState({
        linearMode: 'projects',
        linearContext: { kind: 'project', id: project.id, workspaceId: project.workspaceId }
      })
    },
    [clearSelectedLinearIssue, setTaskResumeState]
  )

  const openLinearCustomViewContext = useCallback(
    (view: LinearCustomViewSummary) => {
      if (!view.workspaceId) {
        toast.error(
          translate(
            'auto.components.TaskPage.669e419d65',
            'Linear view is missing workspace context.'
          )
        )
        return
      }
      clearSelectedLinearIssue()
      setSelectedLinearProject(null)
      setSelectedLinearProjectDetail(null)
      setLinearProjectParentView(null)
      setLinearProjectIssuesResult({ items: [] })
      setLinearProjectIssueLimit(LINEAR_ITEM_LIMIT)
      setLinearProjectIssuePage(0)
      setLinearProjectIssueLoadingTargetPage(null)
      setLinearCustomViewIssuesResult({ items: [] })
      setLinearCustomViewIssueLimit(LINEAR_ITEM_LIMIT)
      setLinearCustomViewIssuePage(0)
      setLinearCustomViewIssueLoadingTargetPage(null)
      setLinearCustomViewProjectsResult({ items: [] })
      setSelectedLinearCustomView(view)
      setLinearMode('views')
      setTaskResumeState({
        linearMode: 'views',
        linearContext: {
          kind: 'view',
          id: view.id,
          workspaceId: view.workspaceId,
          model: view.model
        }
      })
    },
    [clearSelectedLinearIssue, setTaskResumeState]
  )

  // Jira tab state
  const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([])
  const [jiraLoading, setJiraLoading] = useState(false)
  const [jiraError, setJiraError] = useState<TaskPageJiraLoadError | null>(null)
  const [jiraErrorDetailsOpen, setJiraErrorDetailsOpen] = useState(false)
  const [jiraSearchInput, setJiraSearchInput] = useState('')
  const [appliedJiraSearch, setAppliedJiraSearch] = useState('')
  const [activeJiraPreset, setActiveJiraPreset] = useState<JiraPresetId>('assigned')
  const [jiraRefreshNonce, setJiraRefreshNonce] = useState(0)
  const [jiraProjectStatusOrder, setJiraProjectStatusOrder] = useState<{
    order: JiraProjectStatusOrder
    scopeKey: string
  } | null>(null)
  const [jiraOrderBy, setJiraOrderBy] = useState<JiraIssueSortColumn>('updated')
  const [jiraOrderDirection, setJiraOrderDirection] = useState<JiraIssueSortDirection>('desc')
  const [jiraPrioritiesBySite, setJiraPrioritiesBySite] = useState<JiraPrioritiesBySite>(
    () => new Map()
  )
  const jiraPrioritySiteIdsKey = useMemo(() => {
    const siteIds =
      selectedJiraSiteId && selectedJiraSiteId !== 'all'
        ? [selectedJiraSiteId]
        : jiraIssues.flatMap((issue) => (issue.siteId ? [issue.siteId] : []))
    // Why: result refreshes replace the issue array; depend on the represented sites, not identity.
    return JSON.stringify([...new Set(siteIds)].sort())
  }, [jiraIssues, selectedJiraSiteId])

  useEffect(() => {
    if (taskSource !== 'jira' || !jiraConnected || jiraOrderBy !== 'priority') {
      setJiraPrioritiesBySite((current) => (current.size === 0 ? current : new Map()))
      return
    }
    let cancelled = false
    const jiraPrioritySiteIds = JSON.parse(jiraPrioritySiteIdsKey) as string[]
    void Promise.all(
      jiraPrioritySiteIds.map(async (siteId) => {
        try {
          return [
            siteId,
            await jiraListPriorities(jiraTaskSourceContext ?? settings, siteId)
          ] as const
        } catch {
          return [siteId, [] as JiraPriority[]] as const
        }
      })
    ).then((prioritiesBySite) => {
      if (!cancelled) {
        setJiraPrioritiesBySite(new Map(prioritiesBySite))
      }
    })
    return () => {
      cancelled = true
    }
  }, [
    jiraConnected,
    jiraOrderBy,
    jiraPrioritySiteIdsKey,
    jiraTaskSourceContext,
    settings,
    taskSource
  ])

  const handleJiraSort = useCallback(
    (column: JiraIssueSortColumn) => {
      if (jiraOrderBy === column) {
        setJiraOrderDirection((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'))
      } else {
        setJiraOrderBy(column)
        setJiraOrderDirection(column === 'updated' || column === 'status' ? 'desc' : 'asc')
      }
    },
    [jiraOrderBy]
  )

  useEffect(() => {
    if (taskResumeAppliedRef.current || !persistedUIReady || !settings) {
      return
    }

    setTaskSource(
      resolveVisibleTaskProvider(
        pageData.taskSource ?? settings.defaultTaskSource,
        visibleTaskProviders
      )
    )
    setRepoSelection(resolvedInitialSelection)

    const nextGithubMode = taskResumeState?.githubMode ?? 'items'
    setGithubMode(nextGithubMode)

    const preset = taskResumeState?.githubItemsPreset
    if (preset === null) {
      const query = taskResumeState?.githubItemsQuery ?? ''
      setTaskSearchInput(query)
      setAppliedTaskSearch(query)
      setActiveTaskPreset(null)
    } else {
      const presetId = normalizeGitHubTaskPreset(preset ?? settings.defaultTaskViewPreset)
      const query = getTaskPresetQuery(presetId)
      setTaskSearchInput(query)
      setAppliedTaskSearch(query)
      setActiveTaskPreset(presetId)
    }

    const linearQuery = taskResumeState?.linearQuery ?? ''
    setLinearMode(taskResumeState?.linearMode ?? 'issues')
    setLinearSearchInput(linearQuery)
    setAppliedLinearSearch(linearQuery)

    const jiraPreset = taskResumeState?.jiraPreset ?? 'assigned'
    const jiraQuery = taskResumeState?.jiraQuery ?? ''
    setActiveJiraPreset(jiraPreset)
    setJiraSearchInput(jiraQuery)
    setAppliedJiraSearch(jiraQuery)

    // Why: settings/UI hydrate async; apply the restored Tasks context exactly once so later source/filter clicks stay local.
    taskResumeAppliedRef.current = true
    setTaskResumeApplied(true)
  }, [
    persistedUIReady,
    settings,
    pageData.taskSource,
    resolvedInitialSelection,
    taskResumeState,
    visibleTaskProviders
  ])

  useTaskPageLinearResumeState({
    fetchLinearCustomView,
    fetchLinearProject,
    linearConnected,
    linearContextResumeAttemptedRef,
    linearTaskSourceContext,
    setLinearCustomViewsError,
    setLinearCustomViewsLoading,
    setLinearMode,
    setLinearProjectParentView,
    setLinearProjectsError,
    setSelectedLinearCustomView,
    setSelectedLinearProject,
    setSelectedLinearProjectDetail,
    setTaskResumeState,
    taskResumeApplied,
    taskResumeState,
    taskSource
  })

  // Why: fetch the full Linear team list so the selector shows all teams, not just those with issues in the fetch window.
  const [availableTeams, setAvailableTeams] = useState<LinearTeam[]>([])
  const [linearTeamRefreshNonce, setLinearTeamRefreshNonce] = useState(0)

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (taskSource !== 'linear' || !linearConnected) {
      setAvailableTeams([])
      return
    }
    let cancelled = false
    const cachedTeams = getCachedLinearTeams(selectedLinearWorkspaceId, {
      sourceContext: linearTaskSourceContext
    })
    // Why: on a workspace switch, drop the prior workspace's teams during the pending fetch but seed from the workspace-scoped cache.
    setAvailableTeams(cachedTeams ?? [])
    void listLinearTeams(selectedLinearWorkspaceId, { sourceContext: linearTaskSourceContext })
      .then((teams) => {
        if (!cancelled) {
          setAvailableTeams(teams)
        }
      })
      .catch(() => {
        if (!cancelled) {
          console.warn('[TaskPage] Failed to fetch Linear teams')
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    taskSource,
    linearConnected,
    selectedLinearWorkspaceId,
    linearTeamRefreshNonce,
    taskResumeApplied,
    getCachedLinearTeams,
    listLinearTeams,
    linearTaskSourceContext
  ])

  const [availableJiraProjects, setAvailableJiraProjects] = useState<JiraProject[]>([])
  const [jiraProjectsLoading, setJiraProjectsLoading] = useState(false)

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (taskSource !== 'jira' || !jiraConnected) {
      setAvailableJiraProjects([])
      setJiraProjectsLoading(false)
      return
    }
    let cancelled = false
    setAvailableJiraProjects([])
    setJiraProjectsLoading(true)
    void jiraListProjects(jiraTaskSourceContext ?? settings, selectedJiraSiteId)
      .then((projects) => {
        if (!cancelled) {
          setAvailableJiraProjects(projects)
        }
      })
      .catch(() => {
        if (!cancelled) {
          console.warn('[TaskPage] Failed to fetch Jira projects')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setJiraProjectsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    settings,
    taskSource,
    jiraConnected,
    selectedJiraSiteId,
    taskResumeApplied,
    jiraTaskSourceContext
  ])

  const defaultLinearTeamSelection = settings?.defaultLinearTeamSelection
  const [linearTeamSelection, setLinearTeamSelection] = useState<ReadonlySet<string>>(() => {
    if (!defaultLinearTeamSelection) {
      return new Set<string>()
    }
    return new Set(defaultLinearTeamSelection)
  })

  const activeLinearIssues =
    selectedLinearProject && linearProjectTab === 'issues'
      ? linearProjectIssuesResult.items
      : selectedLinearCustomView?.model === 'issue'
        ? linearCustomViewIssuesResult.items
        : linearIssues
  const activeLinearIssueLoading =
    selectedLinearProject && linearProjectTab === 'issues'
      ? linearProjectIssuesLoading
      : selectedLinearCustomView?.model === 'issue'
        ? linearCustomViewContentsLoading
        : linearLoading
  const activeLinearIssueError =
    linearStatus.credentialError ??
    (selectedLinearProject && linearProjectTab === 'issues'
      ? linearProjectIssuesError
      : selectedLinearCustomView?.model === 'issue'
        ? linearCustomViewContentsError
        : linearError)
  const activeLinearIssueCollectionErrors =
    selectedLinearProject && linearProjectTab === 'issues'
      ? linearProjectIssuesResult.errors
      : selectedLinearCustomView?.model === 'issue'
        ? linearCustomViewIssuesResult.errors
        : undefined
  const activeLinearIssueHasCollectionError = (activeLinearIssueCollectionErrors?.length ?? 0) > 0
  const activeLinearIssueContextLabel = selectedLinearProject
    ? `Project: ${selectedLinearProject.name}`
    : selectedLinearCustomView?.model === 'issue'
      ? `View: ${selectedLinearCustomView.name}`
      : null
  const canLoadMorePlainLinearIssues =
    !activeLinearIssueContextLabel &&
    appliedLinearSearch.trim().length === 0 &&
    linearIssuesHasMore &&
    linearIssueLimit < LINEAR_ISSUE_LIST_MAX
  const canLoadMoreLinearProjectIssues =
    selectedLinearProject !== null &&
    linearProjectTab === 'issues' &&
    Boolean(linearProjectIssuesResult.hasMore) &&
    linearProjectIssueLimit < LINEAR_ISSUE_LIST_MAX
  const canLoadMoreLinearCustomViewIssues =
    selectedLinearCustomView?.model === 'issue' &&
    Boolean(linearCustomViewIssuesResult.hasMore) &&
    linearCustomViewIssueLimit < LINEAR_ISSUE_LIST_MAX
  const activeLinearIssuePage =
    selectedLinearProject && linearProjectTab === 'issues'
      ? linearProjectIssuePage
      : selectedLinearCustomView?.model === 'issue'
        ? linearCustomViewIssuePage
        : linearIssuePage
  const activeLinearIssueLoadingTargetPage =
    selectedLinearProject && linearProjectTab === 'issues'
      ? linearProjectIssueLoadingTargetPage
      : selectedLinearCustomView?.model === 'issue'
        ? linearCustomViewIssueLoadingTargetPage
        : linearIssueLoadingTargetPage
  const activeLinearIssueCanLoadMore =
    selectedLinearProject && linearProjectTab === 'issues'
      ? canLoadMoreLinearProjectIssues
      : selectedLinearCustomView?.model === 'issue'
        ? canLoadMoreLinearCustomViewIssues
        : canLoadMorePlainLinearIssues
  const activeLinearIssueCanRequestMore =
    activeLinearIssueCanLoadMore && !activeLinearIssueHasCollectionError
  const activeLinearIssueLimit =
    selectedLinearProject && linearProjectTab === 'issues'
      ? linearProjectIssueLimit
      : selectedLinearCustomView?.model === 'issue'
        ? linearCustomViewIssueLimit
        : linearIssueLimit

  const displayedLinearIssues = useMemo(
    () =>
      activeLinearIssues.map(
        (issue) =>
          findTaskPageLinearIssue(
            linearCacheSnapshot.issueCache,
            linearCacheSnapshot.searchCache,
            linearCacheSnapshot.listCache,
            issue.id
          ) ?? issue
      ),
    [
      activeLinearIssues,
      linearCacheSnapshot.issueCache,
      linearCacheSnapshot.listCache,
      linearCacheSnapshot.searchCache
    ]
  )

  const linearIssueTeams = useMemo(() => {
    const seen = new Set<string>()
    const teams: LinearTeam[] = []
    for (const issue of displayedLinearIssues) {
      if (!issue.team.id || seen.has(issue.team.id)) {
        continue
      }
      seen.add(issue.team.id)
      teams.push({
        id: issue.team.id,
        workspaceId: issue.workspaceId,
        workspaceName: issue.workspaceName,
        name: issue.team.name,
        key: issue.team.key,
        url:
          buildLinearTeamUrl({
            organizationUrlKey: getLinearOrganizationUrlKeyFromIssueUrl(issue.url),
            teamKey: issue.team.key
          }) ?? undefined
      })
    }
    return teams.sort((a, b) => a.name.localeCompare(b.name))
  }, [displayedLinearIssues])

  // Why: the full team fetch is async and briefly empty; keep the selector usable from issue metadata until the list lands.
  const linearTeamOptions = useMemo(() => {
    if (availableTeams.length === 0) {
      return linearIssueTeams
    }
    const issueTeamById = new Map(linearIssueTeams.map((team) => [team.id, team]))
    return availableTeams.map((team) => {
      if (team.url) {
        return team
      }
      return {
        ...team,
        url: issueTeamById.get(team.id)?.url
      }
    })
  }, [availableTeams, linearIssueTeams])

  // Why: team IDs belong to one workspace, so a workspace switch must not leave the list filtered by stale team IDs.
  useEffect(() => {
    if (linearTeamOptions.length === 0) {
      return
    }
    setLinearTeamSelection(
      reconcileLinearTeamSelection(linearTeamOptions, defaultLinearTeamSelection)
    )
  }, [linearTeamOptions, defaultLinearTeamSelection])

  const linearAttributePrimaryTeam = useMemo(
    () =>
      resolveLinearIssueAttributeFilterPrimaryTeam({
        selectedTeamIds: [...linearTeamSelection],
        availableTeams: linearTeamOptions
      }),
    [linearTeamOptions, linearTeamSelection]
  )

  const applyLinearAttributeFilter = useCallback((next: LinearIssueAttributeFilter) => {
    // Why: batch filter + limit/page reset so the fetch effect never issues an old expanded-limit request for the new filter.
    setLinearAttributeFilter(next)
    setLinearIssueLimit(LINEAR_ITEM_LIMIT)
    setLinearIssuePage(0)
    setLinearIssueLoadingTargetPage(null)
  }, [])

  useEffect(() => {
    const workspaceId = selectedLinearWorkspaceId ?? null
    const previous = previousLinearWorkspaceIdForFiltersRef.current
    previousLinearWorkspaceIdForFiltersRef.current = workspaceId
    if (previous === undefined || previous === workspaceId) {
      return
    }
    applyLinearAttributeFilter(emptyLinearIssueAttributeFilter())
  }, [applyLinearAttributeFilter, selectedLinearWorkspaceId])

  useEffect(() => {
    const nextId = linearAttributePrimaryTeam?.id ?? null
    const previousId = linearPrimaryTeamIdRef.current
    linearPrimaryTeamIdRef.current = nextId
    if (previousId === null || previousId === nextId) {
      return
    }
    // Why: team-scoped facets; clearing them is a filter change, so reset limit/page via applyLinearAttributeFilter (R6), not a bare set.
    const next = teamDerivedFacetsForPrimaryTeamChange(linearAttributeFilter)
    if (
      linearIssueAttributeFilterSignature(linearAttributeFilter) ===
      linearIssueAttributeFilterSignature(next)
    ) {
      return
    }
    applyLinearAttributeFilter(next)
  }, [applyLinearAttributeFilter, linearAttributeFilter, linearAttributePrimaryTeam?.id])

  const linearSearchActive = isLinearIssueSearchActive(linearSearchInput, appliedLinearSearch)
  const showLinearAttributeFilters =
    linearMode === 'issues' && !activeLinearIssueContextLabel && !linearSearchActive

  const filteredLinearIssues = useMemo(() => {
    if (activeLinearIssueContextLabel) {
      return displayedLinearIssues
    }
    // Why: team options can arrive after issue rows render; treat an empty selection as "all" until reconciliation sets teams.
    if (displayedLinearIssues.length > 0 && linearTeamSelection.size === 0) {
      return displayedLinearIssues
    }
    return displayedLinearIssues.filter((issue) => linearTeamSelection.has(issue.team.id))
  }, [activeLinearIssueContextLabel, displayedLinearIssues, linearTeamSelection])

  const orderedLinearIssues = useMemo(
    () => [...filteredLinearIssues].sort((a, b) => compareLinearIssues(a, b, linearOrderBy)),
    [filteredLinearIssues, linearOrderBy]
  )
  const linearIssuePageState = useMemo(
    () =>
      getLinearIssuePageState(
        orderedLinearIssues,
        activeLinearIssuePage,
        LINEAR_ITEM_LIMIT,
        activeLinearIssueCanRequestMore
      ),
    [activeLinearIssueCanRequestMore, activeLinearIssuePage, orderedLinearIssues]
  )
  const {
    loadedPages: loadedLinearIssuePages,
    totalPages: linearIssueTotalPages,
    visiblePage: visibleLinearIssuePage,
    issues: pagedLinearIssues
  } = linearIssuePageState
  const showLinearIssuePagination =
    orderedLinearIssues.length > 0 &&
    !activeLinearIssueError &&
    linearIssueTotalPages > 1 &&
    !(activeLinearIssueLoading && activeLinearIssues.length === 0)

  const setActiveLinearIssuePage = useCallback(
    (page: number) => {
      if (selectedLinearProject && linearProjectTab === 'issues') {
        setLinearProjectIssuePage(page)
      } else if (selectedLinearCustomView?.model === 'issue') {
        setLinearCustomViewIssuePage(page)
      } else {
        setLinearIssuePage(page)
      }
    },
    [linearProjectTab, selectedLinearCustomView?.model, selectedLinearProject]
  )

  const setActiveLinearIssueLoadingTargetPage = useCallback(
    (page: number | null) => {
      if (selectedLinearProject && linearProjectTab === 'issues') {
        setLinearProjectIssueLoadingTargetPage(page)
      } else if (selectedLinearCustomView?.model === 'issue') {
        setLinearCustomViewIssueLoadingTargetPage(page)
      } else {
        setLinearIssueLoadingTargetPage(page)
      }
    },
    [linearProjectTab, selectedLinearCustomView?.model, selectedLinearProject]
  )

  const ensureActiveLinearIssueLimit = useCallback(
    (targetLimit: number) => {
      const nextLimit = Math.min(clampLinearIssueListLimit(targetLimit), LINEAR_ISSUE_LIST_MAX)
      if (selectedLinearProject && linearProjectTab === 'issues') {
        setLinearProjectIssueLimit((limit) => Math.max(limit, nextLimit))
      } else if (selectedLinearCustomView?.model === 'issue') {
        setLinearCustomViewIssueLimit((limit) => Math.max(limit, nextLimit))
      } else {
        setLinearIssueLimit((limit) => Math.max(limit, nextLimit))
      }
    },
    [linearProjectTab, selectedLinearCustomView?.model, selectedLinearProject]
  )

  const handleLinearIssuePageChange = useCallback(
    (page: number) => {
      if (page < loadedLinearIssuePages) {
        setActiveLinearIssuePage(page)
        setActiveLinearIssueLoadingTargetPage(null)
        return
      }

      // Why: Linear reads are cached as an expanded prefix; a page jump expands it and commits once enough rows arrive.
      setActiveLinearIssueLoadingTargetPage(page)
      ensureActiveLinearIssueLimit((page + 1) * LINEAR_ITEM_LIMIT)
    },
    [
      ensureActiveLinearIssueLimit,
      loadedLinearIssuePages,
      setActiveLinearIssueLoadingTargetPage,
      setActiveLinearIssuePage
    ]
  )

  const showLinearEmptyFilteredLoadMore =
    orderedLinearIssues.length === 0 && !activeLinearIssueError && activeLinearIssueCanRequestMore
  const handleLinearEmptyFilteredLoadMore = useCallback(() => {
    setActiveLinearIssueLoadingTargetPage(null)
    ensureActiveLinearIssueLimit(activeLinearIssueLimit + LINEAR_ITEM_LIMIT)
  }, [activeLinearIssueLimit, ensureActiveLinearIssueLimit, setActiveLinearIssueLoadingTargetPage])

  useEffect(() => {
    if (activeLinearIssueLoading || activeLinearIssueLoadingTargetPage === null) {
      return
    }

    const maxLoadedPage = Math.max(0, loadedLinearIssuePages - 1)
    const targetPageLoaded = activeLinearIssueLoadingTargetPage <= maxLoadedPage
    const targetPageCannotLoad =
      !activeLinearIssueCanRequestMore || activeLinearIssueLimit >= LINEAR_ISSUE_LIST_MAX
    if (targetPageLoaded || targetPageCannotLoad) {
      setActiveLinearIssuePage(Math.min(activeLinearIssueLoadingTargetPage, maxLoadedPage))
      setActiveLinearIssueLoadingTargetPage(null)
      return
    }

    // Why: local filtering can leave the next page short, so keep expanding the prefix until the page exists or Linear is exhausted.
    ensureActiveLinearIssueLimit(activeLinearIssueLimit + LINEAR_ITEM_LIMIT)
  }, [
    activeLinearIssueCanRequestMore,
    activeLinearIssueHasCollectionError,
    activeLinearIssueLimit,
    activeLinearIssueLoading,
    activeLinearIssueLoadingTargetPage,
    ensureActiveLinearIssueLimit,
    loadedLinearIssuePages,
    setActiveLinearIssueLoadingTargetPage,
    setActiveLinearIssuePage
  ])

  useEffect(() => {
    if (
      activeLinearIssueLoadingTargetPage !== null ||
      activeLinearIssuePage <= visibleLinearIssuePage
    ) {
      return
    }
    setActiveLinearIssuePage(visibleLinearIssuePage)
  }, [
    activeLinearIssueLoadingTargetPage,
    activeLinearIssuePage,
    setActiveLinearIssuePage,
    visibleLinearIssuePage
  ])

  const selectedLinearTeamForExternalLink = useMemo(() => {
    if (linearTeamSelection.size !== 1) {
      return null
    }
    const [teamId] = linearTeamSelection
    return linearTeamOptions.find((team) => team.id === teamId && team.url) ?? null
  }, [linearTeamOptions, linearTeamSelection])

  const effectiveLinearDisplayProperties = useMemo(
    () =>
      getEffectiveLinearDisplayProperties(
        linearDisplayProperties,
        linearGroupBy,
        linearTeamSelection.size,
        linearTeamPropertyTouched
      ),
    [linearDisplayProperties, linearGroupBy, linearTeamPropertyTouched, linearTeamSelection.size]
  )
  const linearIssueGridTemplate = useMemo(
    () => getLinearIssueGridTemplate(effectiveLinearDisplayProperties),
    [effectiveLinearDisplayProperties]
  )
  const linearIssueGridStyle = useMemo(
    () =>
      ({
        '--linear-grid-template': linearIssueGridTemplate
      }) as React.CSSProperties,
    [linearIssueGridTemplate]
  )
  const linearIssueSections = useMemo(
    () => groupLinearIssues(pagedLinearIssues, linearGroupBy, linearOrderBy),
    [pagedLinearIssues, linearGroupBy, linearOrderBy]
  )
  const linearIssueListRows = useMemo<LinearIssueListRow[]>(
    () => getLinearIssueListRows(linearIssueSections, linearGroupBy),
    [linearGroupBy, linearIssueSections]
  )
  const linearBoardSections = useMemo(
    () =>
      groupLinearIssues(
        pagedLinearIssues,
        linearGroupBy === 'none' ? 'status' : linearGroupBy,
        linearOrderBy
      ),
    [pagedLinearIssues, linearGroupBy, linearOrderBy]
  )
  const linearStatusBoardEnabled = linearGroupBy === 'none' || linearGroupBy === 'status'

  const handleLinearBoardCardDragStart = useCallback(
    (issue: LinearIssue, event: React.DragEvent<HTMLDivElement>) => {
      if (!linearStatusBoardEnabled || linearBoardUpdatingIssueIds.has(issue.id)) {
        event.preventDefault()
        return
      }
      if (!writeLinearBoardIssueDragData(event.dataTransfer, issue.id)) {
        event.preventDefault()
        return
      }
      setLinearBoardDraggingIssueId(issue.id)
    },
    [linearBoardUpdatingIssueIds, linearStatusBoardEnabled]
  )

  const handleLinearBoardDragOver = useCallback(
    (section: LinearGroupSection, event: React.DragEvent<HTMLElement>) => {
      if (!linearStatusBoardEnabled || !getLinearStatusSectionState(section)) {
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setLinearBoardDragOverKey(section.key)
    },
    [linearStatusBoardEnabled]
  )

  const handleLinearBoardDrop = useCallback(
    async (section: LinearGroupSection, event: React.DragEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setLinearBoardDragOverKey(null)

      const targetState = getLinearStatusSectionState(section)
      if (!linearStatusBoardEnabled || !targetState) {
        return
      }

      const draggedIssue = readLinearBoardIssueDragData(event.dataTransfer)
      const issueId =
        draggedIssue.status === 'issue'
          ? draggedIssue.issueId
          : draggedIssue.status === 'hidden'
            ? linearBoardDraggingIssueId
            : null
      const issue = filteredLinearIssues.find((item) => item.id === issueId)
      if (
        !issue ||
        linearBoardUpdatingIssueIds.has(issue.id) ||
        (issue.state.name === targetState.name && issue.state.type === targetState.type)
      ) {
        return
      }

      setLinearBoardUpdatingIssueIds((prev) => {
        const next = new Set(prev)
        next.add(issue.id)
        return next
      })

      const previousState = issue.state
      const applyFallbackState = (state: LinearIssue['state']) => {
        setSelectedLinearIssueFallback((prev) =>
          prev?.id === issue.id ? { ...prev, state } : prev
        )
      }

      try {
        const states = await linearTeamStates(
          linearTaskSourceContext ?? settings,
          issue.team.id,
          issue.workspaceId
        )
        const workflowState = findLinearWorkflowStateForStatus(states, targetState)
        if (!workflowState) {
          toast.error(
            translate(
              'auto.components.TaskPage.745ae567d4',
              '"{{value0}}" is not available for {{value1}}',
              { value0: targetState.name, value1: issue.team.name }
            )
          )
          return
        }

        const nextState: LinearIssue['state'] = {
          name: workflowState.name,
          type: workflowState.type,
          color: workflowState.color
        }

        patchLinearIssue(issue.id, { state: nextState }, { sourceContext: linearTaskSourceContext })
        patchScopedLinearIssue(issue.id, { state: nextState })
        applyFallbackState(nextState)

        const result = await linearUpdateIssue(
          linearTaskSourceContext ?? settings,
          issue.id,
          { stateId: workflowState.id },
          issue.workspaceId
        )
        if (result.ok === false) {
          patchLinearIssue(
            issue.id,
            { state: previousState },
            { sourceContext: linearTaskSourceContext }
          )
          patchScopedLinearIssue(issue.id, { state: previousState })
          applyFallbackState(previousState)
          toast.error(
            result.error ??
              translate('auto.components.TaskPage.6775c05483', 'Failed to update Linear state')
          )
          return
        }
        invalidateLinearIssueLists({ sourceContext: linearTaskSourceContext })
        useAppStore.getState().recordFeatureInteraction('linear-tasks')
      } catch {
        patchLinearIssue(
          issue.id,
          { state: previousState },
          { sourceContext: linearTaskSourceContext }
        )
        patchScopedLinearIssue(issue.id, { state: previousState })
        applyFallbackState(previousState)
        toast.error(
          translate('auto.components.TaskPage.6775c05483', 'Failed to update Linear state')
        )
      } finally {
        setLinearBoardUpdatingIssueIds((prev) => {
          const next = new Set(prev)
          next.delete(issue.id)
          return next
        })
      }
    },
    [
      filteredLinearIssues,
      invalidateLinearIssueLists,
      linearBoardDraggingIssueId,
      linearBoardUpdatingIssueIds,
      linearStatusBoardEnabled,
      patchScopedLinearIssue,
      patchLinearIssue,
      linearTaskSourceContext,
      settings
    ]
  )

  const toggleLinearDisplayProperty = useCallback((property: LinearDisplayProperty): void => {
    if (property === 'team') {
      setLinearTeamPropertyTouched(true)
    }
    setLinearDisplayProperties((prev) => {
      const next = new Set(prev)
      if (next.has(property)) {
        next.delete(property)
      } else {
        next.add(property)
      }
      return next
    })
  }, [])

  const displayedJiraIssues = useMemo(
    () =>
      jiraIssues.map(
        (issue) =>
          findTaskPageJiraIssue(
            jiraCacheSnapshot.issueCache,
            jiraCacheSnapshot.searchCache,
            issue.key,
            {
              sourceContext: jiraTaskSourceContext,
              siteId: issue.siteId
            }
          ) ?? issue
      ),
    [jiraIssues, jiraCacheSnapshot.issueCache, jiraCacheSnapshot.searchCache, jiraTaskSourceContext]
  )
  const displayedJiraProjectScope = useMemo(
    () => getSingleJiraProjectScope(displayedJiraIssues),
    [displayedJiraIssues]
  )
  const displayedJiraStatusOrderScopeKey = displayedJiraProjectScope
    ? getTaskPageJiraStatusOrderScopeKey(jiraTaskSourceScopeKey, displayedJiraProjectScope)
    : null
  const displayedJiraStatusOrder =
    jiraProjectStatusOrder && displayedJiraStatusOrderScopeKey === jiraProjectStatusOrder.scopeKey
      ? jiraProjectStatusOrder.order
      : null

  const sortedJiraIssues = useMemo(() => {
    return sortJiraIssues(
      displayedJiraIssues,
      jiraOrderBy,
      jiraOrderDirection,
      jiraPrioritiesBySite
    )
  }, [displayedJiraIssues, jiraOrderBy, jiraOrderDirection, jiraPrioritiesBySite])
  const {
    newLinearProjectOpen,
    setNewLinearProjectOpen,
    newLinearProjectName,
    setNewLinearProjectName,
    newLinearProjectDescription,
    setNewLinearProjectDescription,
    newLinearProjectContent,
    setNewLinearProjectContent,
    setNewLinearProjectTeamId,
    newLinearProjectLeadId,
    setNewLinearProjectLeadId,
    newLinearProjectMemberIds,
    setNewLinearProjectMemberIds,
    newLinearProjectLabelIds,
    setNewLinearProjectLabelIds,
    newLinearProjectPriority,
    setNewLinearProjectPriority,
    newLinearProjectStartDate,
    setNewLinearProjectStartDate,
    newLinearProjectTargetDate,
    setNewLinearProjectTargetDate,
    newLinearProjectSubmitting,
    setNewLinearProjectSubmitting,
    newLinearProjectTargetTeam,
    newLinearProjectMembers,
    newLinearProjectLabels,
    newLinearIssueOpen,
    setNewLinearIssueOpen,
    newLinearIssueTitle,
    setNewLinearIssueTitle,
    newLinearIssueBody,
    setNewLinearIssueBody,
    newLinearIssueTeamId,
    setNewLinearIssueTeamId,
    newLinearIssueSubmitting,
    setNewLinearIssueSubmitting,
    newLinearIssueStateId,
    setNewLinearIssueStateId,
    newLinearIssueAssigneeId,
    setNewLinearIssueAssigneeId,
    newLinearIssuePriority,
    setNewLinearIssuePriority,
    newLinearIssueProjectId,
    setNewLinearIssueProjectId,
    newLinearIssueLabelIds,
    setNewLinearIssueLabelIds,
    newLinearIssueTargetTeam,
    newLinearIssueProjects,
    setNewLinearIssueProjects,
    newLinearIssueProjectsLoading,
    setNewLinearIssueProjectsLoading,
    newLinearStates,
    newLinearMembers,
    newLinearLabels
  } = useTaskPageLinearComposerState({
    availableTeams,
    settings,
    linearConnected,
    selectedLinearWorkspaceId,
    selectedLinearProject,
    linearTaskSourceContext
  })

  const [linearConnectOpen, setLinearConnectOpen] = useState(false)
  const [jiraConnectOpen, setJiraConnectOpen] = useState(false)
  useContextualTour(
    'tasks',
    !dialogWorkItem &&
      !gitlabDialogItem &&
      !selectedLinearIssue &&
      !newIssueOpen &&
      !newLinearProjectOpen &&
      !newLinearIssueOpen &&
      !linearConnectOpen &&
      !jiraConnectOpen &&
      activeModal === 'none',
    'tasks_open'
  )

  const activeGithubTaskKind = getGitHubTaskKind(activeTaskPreset, appliedTaskSearch)
  const appliedTaskQuery = useMemo(() => parseTaskQuery(appliedTaskSearch), [appliedTaskSearch])
  const selectedGitHubRepoExternalLink = useMemo(() => {
    if (selectedRepos.length !== 1) {
      return null
    }
    const [repo] = selectedRepos
    const sourceState = perRepoSourceState.find((state) => state.repoId === repo.id)
    const sources = sourceState?.sources
    const slug =
      activeGithubTaskKind === 'issues'
        ? (sources?.issues ?? sources?.prs)
        : (sources?.prs ?? sources?.issues)
    const url = buildGitHubRepoUrl(slug)
    return url ? { url, label: slug ? `${slug.owner}/${slug.repo}` : repo.displayName } : null
  }, [activeGithubTaskKind, perRepoSourceState, selectedRepos])

  const {
    newJiraIssueOpen,
    setNewJiraIssueOpen,
    newJiraIssueTitle,
    setNewJiraIssueTitle,
    newJiraIssueBody,
    setNewJiraIssueBody,
    setNewJiraIssueProjectId,
    newJiraIssueProjectComboboxOpen,
    newJiraIssueProjectQuery,
    setNewJiraIssueProjectQuery,
    newJiraIssueProjectCommandValue,
    setNewJiraIssueProjectCommandValue,
    newJiraIssueTypeId,
    setNewJiraIssueTypeId,
    newJiraIssueSubmitting,
    setNewJiraIssueSubmitting,
    newJiraIssueProjectSearchInputRef,
    availableJiraIssueTypes,
    jiraIssueTypesLoading,
    jiraCreateFieldsLoading,
    jiraCreateFieldsError,
    newJiraIssueCustomFieldValues,
    setNewJiraIssueCustomFieldValues,
    resetNewJiraIssue,
    includeJiraSiteNameInProjectLabel,
    sortedAvailableJiraProjects,
    filteredNewJiraIssueProjects,
    newJiraIssueTargetProject,
    newJiraIssueTargetProjectSelectionKey,
    newJiraIssueTargetType,
    visibleJiraCreateFields,
    hasMissingJiraCreateField,
    handleNewJiraIssueProjectComboboxOpenChange,
    handleNewJiraIssueProjectSelect,
    handleNewJiraIssueProjectTriggerKeyDown
  } = useTaskPageJiraComposerState({
    availableJiraProjects,
    selectedJiraSiteId,
    settings,
    jiraConnected,
    jiraTaskSourceContext
  })

  const previousProviderRuntimeContextKeyRef = useRef(providerRuntimeContextKey)

  useEffect(() => {
    if (previousProviderRuntimeContextKeyRef.current === providerRuntimeContextKey) {
      return
    }
    previousProviderRuntimeContextKeyRef.current = providerRuntimeContextKey
    if (newLinearIssueOpen) {
      setNewLinearIssueOpen(false)
      setNewLinearIssueTitle('')
      setNewLinearIssueBody('')
      setNewLinearIssueTeamId(null)
      setNewLinearIssueStateId(null)
      setNewLinearIssueAssigneeId(null)
      setNewLinearIssuePriority(0)
      setNewLinearIssueProjectId(null)
      setNewLinearIssueLabelIds([])
      setNewLinearIssueProjects([])
      setNewLinearIssueProjectsLoading(false)
      setNewLinearIssueSubmitting(false)
    }
    if (newJiraIssueOpen) {
      resetNewJiraIssue()
    }
  }, [newJiraIssueOpen, newLinearIssueOpen, providerRuntimeContextKey, resetNewJiraIssue])

  // Why: defense-in-depth — keep stale cache rows from leaking across the issue/PR split tabs.
  const applyTypeFilter = useCallback(
    (items: GitHubWorkItem[]) => {
      return items.filter((item) => {
        return activeGithubTaskKind === 'prs' ? item.type === 'pr' : item.type === 'issue'
      })
    },
    [activeGithubTaskKind]
  )

  const currentPageItems = useMemo(() => pages[currentPage] ?? [], [pages, currentPage])

  const filteredWorkItems = useMemo(
    () => applyTypeFilter(currentPageItems),
    [applyTypeFilter, currentPageItems]
  )
  const showGitHubTaskSkeletons = tasksFiltering || (tasksLoading && filteredWorkItems.length === 0)
  const loadedGitHubAuthorLogins = useMemo(() => {
    const seen = new Set<string>()
    const logins: string[] = []
    for (const page of pages) {
      if (!page) {
        continue
      }
      for (const item of page) {
        if (
          !item.author ||
          (activeGithubTaskKind === 'prs' ? item.type !== 'pr' : item.type !== 'issue')
        ) {
          continue
        }
        const key = item.author.toLowerCase()
        if (seen.has(key)) {
          continue
        }
        seen.add(key)
        logins.push(item.author)
      }
    }
    return logins
  }, [activeGithubTaskKind, pages])
  const primaryGithubFilterSlug = useMemo(() => {
    for (const state of perRepoSourceState) {
      const source = activeGithubTaskKind === 'prs' ? state.sources?.prs : state.sources?.issues
      if (source) {
        return source
      }
    }
    return null
  }, [activeGithubTaskKind, perRepoSourceState])
  const showPRManagementColumns = activeGithubTaskKind === 'prs'
  const githubTaskGridClass = showPRManagementColumns
    ? GITHUB_PR_TASK_GRID_CLASS
    : GITHUB_TASK_GRID_CLASS

  const ensurePRChecksLoaded = useCallback(
    (item: GitHubWorkItem): void => {
      if (item.type !== 'pr' || item.checksSummary) {
        return
      }
      const repo = repoMap.get(item.repoId)
      if (!repo) {
        return
      }
      const requestedHeadSha = item.headSha
      const requestedPRRepo = item.prRepo ?? null
      void fetchPRChecks(
        repo.path,
        item.number,
        item.branchName,
        item.headSha,
        item.prRepo ?? null,
        { repoId: repo.id, sourceContext: getTaskPageRepoSourceContext(repo, 'github') }
      ).then((checks) => {
        patchTaskPageWorkItemRows(
          { id: item.id, repoId: item.repoId },
          { checksSummary: deriveTaskPagePRCheckSummary(checks) },
          (currentItem) =>
            currentItem.type === 'pr' &&
            currentItem.headSha === requestedHeadSha &&
            sameOptionalGitHubOwnerRepo(currentItem.prRepo, requestedPRRepo)
        )
      })
    },
    [fetchPRChecks, patchTaskPageWorkItemRows, repoMap]
  )

  useEffect(() => {
    if (taskSource !== 'github' || githubMode !== 'items' || !showPRManagementColumns) {
      return
    }

    for (const item of filteredWorkItems.slice(0, PR_CHECKS_EAGER_PREFETCH_LIMIT)) {
      ensurePRChecksLoaded(item)
    }
  }, [ensurePRChecksLoaded, filteredWorkItems, githubMode, showPRManagementColumns, taskSource])

  let lastLoadedPageIndex = 0
  for (let index = 0; index < pages.length; index += 1) {
    if (pages[index] !== null) {
      lastLoadedPageIndex = index
    }
  }
  // Why: when counts fail, a full loaded page is enough evidence to expose one more page without faking empty results.
  const lastLoadedPageFull =
    (pages[lastLoadedPageIndex]?.length ?? 0) >= Math.max(1, githubPageSize)
  const fallbackTotalPages = lastLoadedPageFull
    ? Math.max(pages.length, lastLoadedPageIndex + 2)
    : Math.max(1, pages.length)
  const totalPages =
    countedTotalPages && countedTotalPages > 0
      ? Math.max(pages.length, countedTotalPages)
      : fallbackTotalPages

  // Why: load only the clicked page so a high-page jump doesn't exhaust GitHub's Search API rate bucket.
  const handleLoadNextPage = useCallback(
    async (targetPage?: number) => {
      if (paginationLoading || selectedRepos.length === 0) {
        return
      }
      const q = stripRepoQualifiers(appliedTaskSearch.trim())
      const repoArgs = selectedRepos.map((r) => ({
        repoId: r.id,
        path: r.path,
        executionHostId: r.executionHostId,
        sourceContext: getTaskPageRepoSourceContext(r, 'github')
      }))
      const requestGeneration = paginationGenerationRef.current

      const target = targetPage ?? currentPage + 1
      setPaginationLoading(true)
      setLoadingTargetPage(target)
      try {
        const { items } = await fetchWorkItemsNextPage(
          repoArgs,
          githubPerRepoPageLimit,
          githubPageSize,
          q,
          taskPageToGitHubApiPage(target)
        )
        if (paginationGenerationRef.current !== requestGeneration) {
          return
        }
        if (items.length === 0) {
          return
        }
        setPages((previous) => {
          const next = [...previous]
          while (next.length <= target) {
            next.push(null)
          }
          next[target] = items
          return next
        })
        setCurrentPage(target)
      } catch (err) {
        console.error('Failed to load next page:', err)
      } finally {
        if (paginationGenerationRef.current === requestGeneration) {
          setPaginationLoading(false)
          setLoadingTargetPage(null)
        }
      }
    },
    [
      paginationLoading,
      selectedRepos,
      currentPage,
      appliedTaskSearch,
      fetchWorkItemsNextPage,
      githubPageSize,
      githubPerRepoPageLimit
    ]
  )

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
  }, [activeGithubTaskKind, appliedTaskSearch, taskSearchInput, taskResumeApplied])

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (!githubSearchPersistReadyRef.current) {
      githubSearchPersistReadyRef.current = true
      return
    }
    // Why: persist the applied query unconditionally to cover paths that change appliedTaskSearch outside the preset handler.
    setTaskResumeState({
      githubItemsPreset: activeTaskPreset,
      githubItemsQuery: appliedTaskSearch.trim()
    })
  }, [activeTaskPreset, appliedTaskSearch, setTaskResumeState, taskResumeApplied])

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    // Why: both early-return branches must clear retryingSourceKeys — if they fire, neither .then nor .catch runs and Retry stays stuck.
    if (taskSource !== 'github' || githubMode !== 'items') {
      setRetryingSourceKeys(new Set())
      setTasksRefreshing(false)
      setTasksFiltering(false)
      return
    }
    if (selectedRepos.length === 0) {
      setRetryingSourceKeys(new Set())
      setTasksRefreshing(false)
      setTasksFiltering(false)
      return
    } // unreachable — multi-combobox forbids empty

    // Why: strip repo:owner/name qualifiers before fan-out — cross-repo they'd pin every fetch to one repo. See stripRepoQualifiers.
    const q = stripRepoQualifiers(appliedTaskSearch.trim())
    let cancelled = false

    // Why: paint cached rows synchronously before the fan-out so a selection change doesn't leave the prior rows on screen for a frame.
    const preMerged: GitHubWorkItem[] = []
    let anyUncached = false
    let anyRepoCached = false
    for (const r of selectedRepos) {
      const cached = getCachedWorkItems(
        r.id,
        githubPerRepoPageLimit,
        q,
        r.path,
        getTaskPageRepoSourceContext(r, 'github')
      )
      if (cached === null) {
        anyUncached = true
      } else {
        anyRepoCached = true
        preMerged.push(...cached)
      }
    }
    // Why: always replace — an empty preMerged clears the previous query's rows instead of leaving them under the spinner.
    const page0 =
      preMerged.length > 0 ? sortWorkItemsByNumber(preMerged).slice(0, githubPageSize) : []
    setPages([page0])
    setCurrentPage(0)
    setCountedTotalPages(null)
    setTasksError(null)
    setFailedCount(0) // reset so a prior failure banner doesn't linger
    setGithubUnavailable(false)
    setTasksLoading(anyUncached)

    // Preserve the existing nonce-gated force behavior.
    const forceRefresh = taskRefreshNonce !== lastFetchedNonceRef.current
    lastFetchedNonceRef.current = taskRefreshNonce
    // Why: treat a preference-flip nonce bump as a forced refresh so it bypasses the dedupe map and can't reuse pre-flip data.
    const preferenceInvalidated =
      workItemsInvalidationNonce !== lastFetchedInvalidationNonceRef.current
    lastFetchedInvalidationNonceRef.current = workItemsInvalidationNonce
    const forcedFetch = (forceRefresh && taskRefreshNonce > 0) || preferenceInvalidated
    const repoArgs = selectedRepos.map((r) => ({
      repoId: r.id,
      path: r.path,
      executionHostId: r.executionHostId,
      sourceContext: getTaskPageRepoSourceContext(r, 'github')
    }))
    const landingRefreshKey = `${repoArgs.map((r) => `${r.repoId}:${r.path}`).join('|')}::${q}`
    const shouldProbeOnLanding =
      !forcedFetch && anyRepoCached && !landingGitHubRefreshKeysRef.current.has(landingRefreshKey)
    if (shouldProbeOnLanding) {
      landingGitHubRefreshKeysRef.current = new Set([
        ...landingGitHubRefreshKeysRef.current,
        landingRefreshKey
      ])
    }
    // Why: manual refresh keeps cached rows (tasksLoading stays false), so track forced fetch separately for the toolbar spinner.
    setTasksRefreshing(forcedFetch)

    // Why: snapshot retrying keys at dispatch so an earlier settling effect doesn't wipe a newer retry's pending source.
    const dispatchedRetrySourceKeys = retryingSourceKeys
    void fetchWorkItemsAcrossRepos(repoArgs, githubPerRepoPageLimit, githubPageSize, q, {
      ...deriveTaskPageGitHubWorkItemsFetchOptions(forcedFetch, shouldProbeOnLanding)
    })
      .then(({ items, failedCount: failed, githubUnavailable: unavailable }) => {
        // Why: clear only the dispatch-time snapshot keys so an overlapping retry's newer source isn't wiped.
        setRetryingSourceKeys((prev) => {
          if (dispatchedRetrySourceKeys.size === 0) {
            return prev
          }
          const next = new Set(prev)
          for (const key of dispatchedRetrySourceKeys) {
            next.delete(key)
          }
          return next
        })
        if (cancelled) {
          return
        }
        if (shouldProbeOnLanding) {
          const replaceFirstPage = shouldReplaceTaskPageItemsAfterRefresh(page0, items)
          const resetPagination = shouldResetTaskPagePaginationAfterLandingRefresh(page0, items)
          setPages((current) => reconcileTaskPagePagesAfterLandingRefresh(current, items))
          if (replaceFirstPage || resetPagination) {
            setCurrentPage(0)
          }
        } else {
          setPages([items])
          setCurrentPage(0)
        }
        setFailedCount(failed)
        setGithubUnavailable(unavailable)
        setTasksLoading(false)
        setTasksRefreshing(false)
        setTasksFiltering(false)
      })
      .catch((err) => {
        // Why: fetchWorkItemsAcrossRepos swallows per-repo failures, so a reject here is IPC/programmer error — surface it.
        // Why: clear only the dispatch-time snapshot keys so an overlapping retry's newer source isn't wiped.
        setRetryingSourceKeys((prev) => {
          if (dispatchedRetrySourceKeys.size === 0) {
            return prev
          }
          const next = new Set(prev)
          for (const key of dispatchedRetrySourceKeys) {
            next.delete(key)
          }
          return next
        })
        if (cancelled) {
          return
        }
        setTasksError(err instanceof Error ? err.message : 'Failed to load GitHub work.')
        setFailedCount(0) // the per-repo banner would be misleading next to tasksError
        setGithubUnavailable(false)
        setTasksLoading(false)
        setTasksRefreshing(false)
        setTasksFiltering(false)
      })

    // Why: fire-and-forget count query alongside the items fetch; the search API is cached 120s server-side so it adds little cost.
    void countWorkItemsAcrossRepos(
      selectedRepos.map((r) => ({
        repoId: r.id,
        path: r.path,
        executionHostId: r.executionHostId,
        sourceContext: getTaskPageRepoSourceContext(r, 'github')
      })),
      q,
      githubPerRepoPageLimit
    ).then(({ totalPages: countedPages }) => {
      if (!cancelled) {
        setCountedTotalPages(countedPages)
      }
    })

    return () => {
      cancelled = true
    }
    // Why: store selectors are stable (omit from deps); workItemsInvalidationNonce included so a preference flip re-dispatches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedRepos,
    appliedTaskSearch,
    taskRefreshNonce,
    taskSource,
    githubMode,
    workItemsInvalidationNonce,
    taskResumeApplied
  ])

  const applyPRFilterChange = useCallback(
    (change: PRFilterChange): void => {
      let next = scopeGitHubTaskSearch(taskSearchInput, activeGithubTaskKind)
      // Why: withQualifier round-trips through parseTaskQuery so each dropdown's patch preserves prior filters and free-text.
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
        // Why: the two reviewer qualifiers are mutually exclusive — clear the other whenever one is set so the chip matches the query.
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
      // Why: a filter change replaces every row's meaning; show the load skeleton so stale rows don't read as if the filter did nothing.
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
    (event: React.ChangeEvent<HTMLInputElement>): void => {
      const next = event.target.value
      const scoped = scopeGitHubTaskSearch(next, activeGithubTaskKind)
      setTaskSearchInput(next)
      setActiveTaskPreset(null)
      // Why: visible rows are keyed by appliedTaskSearch, not the draft input; hide stale rows once the draft changes the query.
      setTasksFiltering(scoped !== appliedTaskSearch)
    },
    [activeGithubTaskKind, appliedTaskSearch]
  )

  const handleSetDefaultTaskPreset = useCallback(
    (presetId: TaskViewPresetId): void => {
      // Why: the default task view is a durable preference, so persist it instead of only changing page state.
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
      setTaskResumeState({
        githubItemsPreset: preset,
        githubItemsQuery: query
      })
      setTasksFiltering(true)
      setTaskRefreshNonce((current) => current + 1)
    },
    [setTaskResumeState]
  )

  const handleResetGithubTaskSearch = useCallback((): void => {
    handleSelectGithubTaskKind(activeGithubTaskKind)
  }, [activeGithubTaskKind, handleSelectGithubTaskKind])

  const handleTaskSearchKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Enter') {
        // React SyntheticEvent does not expose isComposing; use nativeEvent.
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
      }
    },
    [handleApplyTaskSearch]
  )

  useEffect(() => {
    if (
      taskSource !== 'github' ||
      githubMode !== 'items' ||
      dialogWorkItem ||
      newIssueOpen ||
      newLinearProjectOpen ||
      newLinearIssueOpen ||
      newJiraIssueOpen ||
      activeModal !== 'none'
    ) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      const isMac = navigator.userAgent.includes('Mac')
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey
      if (!modifierPressed || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'f') {
        return
      }

      const input = taskSearchInputRef.current
      if (!input) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target !== input &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target.isContentEditable)
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      input.focus()
      input.select()
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [
    activeModal,
    dialogWorkItem,
    githubMode,
    newIssueOpen,
    newLinearProjectOpen,
    newLinearIssueOpen,
    newJiraIssueOpen,
    taskSource
  ])

  const openComposerForItem = useCallback(
    (item: GitHubWorkItem): void => {
      const linkedWorkItem: LinkedWorkItemSummary = {
        provider: 'github',
        type: item.type,
        number: item.number,
        title: item.title,
        url: item.url,
        ...(item.repoId ? { repoId: item.repoId } : {})
      }
      openModal('new-workspace-composer', {
        linkedWorkItem,
        taskSourceContext: getTaskPageRepoSourceContext(repoMap.get(item.repoId), 'github'),
        prefilledName: getGitHubWorkItemWorkspaceSeed(item),
        initialRepoId: item.repoId,
        telemetrySource: 'sidebar'
      })
    },
    [openModal, repoMap]
  )

  const handleUseWorkItem = useCallback(
    (item: GitHubWorkItem): void => {
      useAppStore.getState().recordFeatureInteraction('github-tasks')
      void createGitHubWorkItemWorkspaceInBackground({
        item,
        repoId: item.repoId,
        taskSourceContext: getTaskPageRepoSourceContext(repoMap.get(item.repoId), 'github'),
        telemetrySource: 'sidebar',
        openModalFallback: () => openComposerForItem(item)
      })
    },
    [openComposerForItem, repoMap]
  )

  const handleOpenOrUseGitHubWorkItem = useCallback(
    (item: GitHubWorkItem): void => {
      const currentAttached = findGithubWorkItemWorkspaceAttachment(
        useAppStore.getState().allWorktrees(),
        item.repoId,
        item.type,
        item.number
      )
      if (!currentAttached) {
        handleUseWorkItem(item)
        return
      }

      const result = activateAndRevealWorktree(currentAttached.id)
      if (result === false) {
        toast.error(
          item.type === 'pr'
            ? translate(
                'auto.components.TaskPage.534a9c6017',
                'Unable to open the workspace attached to this pull request.'
              )
            : translate(
                'auto.components.TaskPage.585dba2989',
                'Unable to open the workspace attached to this issue.'
              )
        )
        return
      }
      useAppStore.getState().recordFeatureInteraction('github-tasks')
    },
    [handleUseWorkItem]
  )

  const openComposerForGitLabItem = useCallback(
    (item: GitLabWorkItem): void => {
      const linkedWorkItem: LinkedWorkItemSummary = {
        provider: 'gitlab',
        type: item.type,
        number: item.number,
        title: item.title,
        url: item.url,
        ...(item.repoId ? { repoId: item.repoId } : {})
      }
      openModal('new-workspace-composer', {
        linkedWorkItem,
        taskSourceContext: getTaskPageRepoSourceContext(
          repoMap.get(item.repoId),
          'gitlab',
          item.projectRef
        ),
        prefilledName: getGitLabWorkItemWorkspaceSeed(item),
        initialRepoId: item.repoId,
        telemetrySource: 'sidebar'
      })
    },
    [openModal, repoMap]
  )

  const handleUseGitLabItem = useCallback(
    (item: GitLabWorkItem): void => {
      useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
      openComposerForGitLabItem(item)
    },
    [openComposerForGitLabItem]
  )

  const handleCreateNewIssue = useTaskPageGitHubIssueCreationState({
    clearNewIssueDraft,
    newIssueAssignees,
    newIssueBody,
    newIssueLabels,
    newIssueRuntimeTarget,
    newIssueSourceContext,
    newIssueSubmitting,
    newIssueTargetRepo,
    newIssueTitle,
    openGitHubDetailPage,
    setDialogWorkItem,
    setNewIssueAssignees,
    setNewIssueBody,
    setNewIssueDraft,
    setNewIssueLabels,
    setNewIssueOpen,
    setNewIssueSubmitting,
    setNewIssueTitle,
    setTaskRefreshNonce
  })
  const handleCreateNewLinearProject = useTaskPageLinearProjectCreationState({
    linearTaskSourceContext,
    newLinearProjectContent,
    newLinearProjectDescription,
    newLinearProjectLabelIds,
    newLinearProjectLeadId,
    newLinearProjectMemberIds,
    newLinearProjectName,
    newLinearProjectPriority,
    newLinearProjectStartDate,
    newLinearProjectSubmitting,
    newLinearProjectTargetDate,
    newLinearProjectTargetTeam,
    openLinearProjectContext,
    settings,
    setAppliedLinearProjectSearch,
    setLinearProjectSearchInput,
    setLinearProjectsResult,
    setLinearRefreshNonce,
    setNewLinearProjectContent,
    setNewLinearProjectDescription,
    setNewLinearProjectLabelIds,
    setNewLinearProjectLeadId,
    setNewLinearProjectMemberIds,
    setNewLinearProjectName,
    setNewLinearProjectOpen,
    setNewLinearProjectPriority,
    setNewLinearProjectStartDate,
    setNewLinearProjectSubmitting,
    setNewLinearProjectTargetDate,
    setSelectedLinearProjectDetail
  })

  const handleCreateNewLinearIssue = useTaskPageLinearIssueCreationState({
    linearTaskSourceContext,
    newLinearIssueAssigneeId,
    newLinearIssueBody,
    newLinearIssueLabelIds,
    newLinearIssuePriority,
    newLinearIssueProjectId,
    newLinearIssueStateId,
    newLinearIssueSubmitting,
    newLinearIssueTargetTeam,
    newLinearIssueTitle,
    newLinearProjectSelected: selectedLinearProject,
    providerRuntimeContextKey,
    providerRuntimeContextKeyRef,
    settings,
    setLinearRefreshNonce,
    setNewLinearIssueAssigneeId,
    setNewLinearIssueBody,
    setNewLinearIssueLabelIds,
    setNewLinearIssueOpen,
    setNewLinearIssuePriority,
    setNewLinearIssueProjectId,
    setNewLinearIssueStateId,
    setNewLinearIssueSubmitting,
    setNewLinearIssueTitle,
    setSelectedLinearIssue
  })

  const handleCreateNewJiraIssue = useTaskPageJiraIssueCreationState({
    hasMissingJiraCreateField,
    jiraCreateFieldsLoading,
    jiraTaskSourceContext,
    newJiraIssueBody,
    newJiraIssueCustomFieldValues,
    newJiraIssueSubmitting,
    newJiraIssueTargetProject,
    newJiraIssueTargetType,
    newJiraIssueTitle,
    providerRuntimeContextKey,
    providerRuntimeContextKeyRef,
    settings,
    setJiraIssues,
    setJiraRefreshNonce,
    setNewJiraIssueBody,
    setNewJiraIssueCustomFieldValues,
    setNewJiraIssueOpen,
    setNewJiraIssueSubmitting,
    setNewJiraIssueTitle,
    setSelectedJiraIssue,
    visibleJiraCreateFields
  })

  const githubTasksBusy = tasksLoading || tasksRefreshing || tasksFiltering

  useEffect(() => {
    // Why: when a modal is open, let it own Esc dismissal.
    if (
      dialogWorkItem ||
      selectedJiraIssue ||
      selectedLinearIssue ||
      newIssueOpen ||
      newLinearIssueOpen ||
      newJiraIssueOpen ||
      activeModal !== 'none'
    ) {
      return
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return
      }

      const target = event.target
      if (!(target instanceof HTMLElement)) {
        return
      }

      // Why: Esc first blurs a focused input so it doesn't accidentally close the whole page; only closes once focus is outside an input.
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      ) {
        event.preventDefault()
        target.blur()
        return
      }

      event.preventDefault()
      closeTaskPage()
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [
    activeModal,
    closeTaskPage,
    dialogWorkItem,
    newIssueOpen,
    newLinearIssueOpen,
    newJiraIssueOpen,
    selectedLinearIssue,
    selectedJiraIssue
  ])

  useEffect(() => {
    if (!preflightStatusCurrent || !preflightStatusChecked) {
      void refreshPreflightStatus()
    }
    if (!linearStatusReady) {
      void checkLinearConnection()
    }
    if (!jiraStatusReady) {
      void checkJiraConnection()
    }
  }, [
    checkJiraConnection,
    checkLinearConnection,
    expectedPreflightContextKey,
    jiraStatusContextKey,
    jiraStatusReady,
    linearStatusContextKey,
    linearStatusReady,
    providerRuntimeContextKey,
    preflightStatusContextKey,
    preflightStatusChecked,
    preflightStatusCurrent,
    refreshPreflightStatus
  ])

  // Why: debounce the Linear search input so we don't fire a request per keystroke (300ms, matching GitHub search).
  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    const timeout = window.setTimeout(() => {
      setAppliedLinearSearch(linearSearchInput)
    }, TASK_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [linearSearchInput, taskResumeApplied])

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (!linearSearchPersistReadyRef.current) {
      linearSearchPersistReadyRef.current = true
      return
    }
    setTaskResumeState({ linearQuery: appliedLinearSearch.trim() })
  }, [appliedLinearSearch, setTaskResumeState, taskResumeApplied])

  useEffect(() => {
    setLinearIssueLimit(LINEAR_ITEM_LIMIT)
    setLinearIssuePage(0)
    setLinearIssueLoadingTargetPage(null)
  }, [
    appliedLinearSearch,
    linearMode,
    selectedLinearCustomView?.id,
    selectedLinearProject?.id,
    selectedLinearWorkspaceId,
    taskSource
  ])

  // Why: fetch Linear issues when the tab is active and connected; empty search uses the `all` list with server-side filters.
  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (taskSource !== 'linear') {
      return
    }
    if (linearMode !== 'issues') {
      return
    }
    if (!linearConnected) {
      return
    }

    let cancelled = false
    setLinearError(null)

    const trimmed = appliedLinearSearch.trim()
    const effectiveLinearIssueLimit = clampLinearIssueListLimit(linearIssueLimit)
    const searchActive = trimmed.length > 0
    const listReadArgs = buildLinearIssueListReadArgs({
      filter: 'all',
      limit: effectiveLinearIssueLimit,
      attributeFilter: linearAttributeFilter,
      searchActive,
      allowAttributeFilter: selectedLinearWorkspaceId !== 'all'
    })
    const readArgs = searchActive
      ? ({ kind: 'search', query: trimmed, limit: LINEAR_ITEM_LIMIT } as const)
      : listReadArgs
    const cachedResult = getCachedLinearIssues(readArgs, { sourceContext: linearTaskSourceContext })
    if (readArgs.kind === 'search') {
      setLinearIssuesHasMore(false)
      if (cachedResult) {
        setLinearIssues(cachedResult as LinearIssue[])
      }
    } else if (cachedResult) {
      const collection = cachedResult as LinearCollectionResult<LinearIssue>
      setLinearIssues(collection.items)
      setLinearIssuesHasMore(
        Boolean(collection.hasMore) && effectiveLinearIssueLimit < LINEAR_ISSUE_LIST_MAX
      )
    }

    const nextFilterSignature = linearIssueAttributeFilterSignature(linearAttributeFilter)
    const previousFilterSignature = linearAttributeFilterSignatureRef.current
    linearAttributeFilterSignatureRef.current = nextFilterSignature
    const filterForce = shouldForceLinearIssueListRead({
      previousFilterSignature,
      nextFilterSignature,
      refreshForced: false
    })

    const requestSignature = buildLinearIssueListRequestSignature({
      sourceContext: linearTaskSourceContext,
      workspaceId: selectedLinearWorkspaceId,
      filter: 'all',
      limit: effectiveLinearIssueLimit,
      attributeFilter: linearAttributeFilter,
      searchQuery: searchActive ? trimmed : undefined
    })
    const previousRequest = lastLinearRequestRef.current
    const forceRefresh =
      filterForce ||
      (linearRefreshNonce > 0 &&
        previousRequest?.nonce !== linearRefreshNonce &&
        previousRequest?.signature === requestSignature)
    lastLinearRequestRef.current = { nonce: linearRefreshNonce, signature: requestSignature }
    const shouldProbeOnLanding =
      !forceRefresh &&
      cachedResult !== null &&
      !landingLinearRefreshKeysRef.current.has(requestSignature)
    if (shouldProbeOnLanding) {
      landingLinearRefreshKeysRef.current = new Set([
        ...landingLinearRefreshKeysRef.current,
        requestSignature
      ])
    }

    // Why: keep cached rows visible on navigation; only explicit refresh or a true cache miss shows the blocking loading state.
    setLinearLoading(forceRefresh || cachedResult === null)

    const request =
      readArgs.kind === 'search'
        ? searchLinearIssues(readArgs.query, LINEAR_ITEM_LIMIT, {
            force: forceRefresh || shouldProbeOnLanding,
            sourceContext: linearTaskSourceContext
          })
        : listLinearIssues(listReadArgs, {
            force: forceRefresh || shouldProbeOnLanding,
            sourceContext: linearTaskSourceContext
          })

    void request
      .then((result) => {
        if (
          cancelled ||
          lastLinearRequestRef.current?.signature !== requestSignature ||
          lastLinearRequestRef.current?.nonce !== linearRefreshNonce
        ) {
          return
        }
        if (readArgs.kind === 'search') {
          const issues = result as LinearIssue[]
          setLinearIssuesHasMore(false)
          if (shouldProbeOnLanding) {
            setLinearIssues((current) =>
              reconcileTaskPageLinearIssuesAfterLandingRefresh(current, issues)
            )
          } else {
            setLinearIssues(issues)
          }
        } else {
          const collection = result as LinearCollectionResult<LinearIssue>
          setLinearIssuesHasMore(
            Boolean(collection.hasMore) && effectiveLinearIssueLimit < LINEAR_ISSUE_LIST_MAX
          )
          setLinearIssues((current) =>
            shouldProbeOnLanding
              ? reconcileTaskPageLinearIssuesAfterLandingRefresh(current, collection.items)
              : collection.items
          )
        }
        setLinearLoading(false)
      })
      .catch((err) => {
        if (
          cancelled ||
          lastLinearRequestRef.current?.signature !== requestSignature ||
          lastLinearRequestRef.current?.nonce !== linearRefreshNonce
        ) {
          return
        }
        setLinearError(err instanceof Error ? err.message : 'Failed to load Linear issues.')
        setLinearLoading(false)
      })

    return () => {
      cancelled = true
    }
    // Why: searchLinearIssues/listLinearIssues are stable selectors; adding them would re-run the effect on unrelated store updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    taskSource,
    linearMode,
    linearConnected,
    selectedLinearWorkspaceId,
    appliedLinearSearch,
    linearIssueLimit,
    linearRefreshNonce,
    linearAttributeFilter,
    linearListInvalidationVersionForSource,
    taskResumeApplied,
    getCachedLinearIssues,
    linearTaskSourceContext
  ])

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    const timeout = window.setTimeout(() => {
      setAppliedLinearProjectSearch(linearProjectSearchInput)
    }, TASK_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [linearProjectSearchInput, taskResumeApplied])

  useEffect(() => {
    if (!taskResumeApplied || taskSource !== 'linear' || linearMode !== 'projects') {
      return
    }
    if (!linearConnected || selectedLinearProject) {
      return
    }
    let cancelled = false
    const query = appliedLinearProjectSearch.trim()
    const cached = getCachedLinearProjects(query || undefined, LINEAR_ITEM_LIMIT, undefined, {
      sourceContext: linearTaskSourceContext
    })
    if (cached) {
      setLinearProjectsResult(cached)
    }
    const force = linearRefreshNonce > 0
    setLinearProjectsLoading(force || cached === null)
    setLinearProjectsError(null)
    void listLinearProjectsFromStore(query || undefined, LINEAR_ITEM_LIMIT, undefined, {
      force,
      sourceContext: linearTaskSourceContext
    })
      .then((result) => {
        if (!cancelled) {
          setLinearProjectsResult(result)
          setLinearProjectsLoading(false)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLinearProjectsError(
            error instanceof Error ? error.message : 'Failed to load projects.'
          )
          setLinearProjectsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    taskResumeApplied,
    taskSource,
    linearMode,
    linearConnected,
    selectedLinearWorkspaceId,
    selectedLinearProject,
    appliedLinearProjectSearch,
    linearRefreshNonce,
    getCachedLinearProjects,
    linearTaskSourceContext
  ])

  useTaskPageLinearProjectDetailState({
    fetchLinearProject,
    linearRefreshNonce,
    linearTaskSourceContext,
    selectedLinearProject,
    setLinearProjectDetailError,
    setLinearProjectDetailLoading,
    setLinearProjectParentView,
    setLinearProjectsError,
    setSelectedLinearProject,
    setSelectedLinearProjectDetail,
    setTaskResumeState
  })

  useTaskPageLinearProjectIssuesState({
    linearProjectIssueLimit,
    linearProjectTab,
    linearRefreshNonce,
    linearTaskSourceContext,
    listLinearProjectIssues,
    selectedLinearProject,
    setLinearProjectIssuesError,
    setLinearProjectIssuesLoading,
    setLinearProjectIssuesResult
  })

  useTaskPageLinearCustomViewDataState({
    getCachedLinearCustomViews,
    linearConnected,
    linearCustomViewIssueLimit,
    linearMode,
    linearRefreshNonce,
    linearTaskSourceContext,
    listLinearCustomViewIssues,
    listLinearCustomViewProjects,
    listLinearCustomViews,
    selectedLinearCustomView,
    selectedLinearWorkspaceId,
    setLinearCustomViewContentsError,
    setLinearCustomViewContentsLoading,
    setLinearCustomViewIssuesResult,
    setLinearCustomViewProjectsResult,
    setLinearCustomViewsError,
    setLinearCustomViewsLoading,
    setLinearCustomViewsResult,
    taskResumeApplied,
    taskSource
  })

  useEffect(() => {
    if (!taskResumeApplied || taskSource !== 'linear') {
      return
    }

    if (!linearConnected) {
      clearSelectedLinearIssue()
      return
    }

    if (filteredLinearIssues.length === 0) {
      if (!selectedLinearIssueCanFloat) {
        clearSelectedLinearIssue()
      }
      return
    }

    // Why: list-first — keep an open inspector only while its issue stays in the filter, not auto-open row 1; user-directed sub-issue nav stays.
    if (
      selectedLinearIssueId &&
      !selectedLinearIssueCanFloat &&
      !filteredLinearIssues.some((issue) => issue.id === selectedLinearIssueId)
    ) {
      clearSelectedLinearIssue()
    }
  }, [
    clearSelectedLinearIssue,
    filteredLinearIssues,
    linearConnected,
    selectedLinearIssueCanFloat,
    selectedLinearIssueId,
    taskResumeApplied,
    taskSource
  ])

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    const timeout = window.setTimeout(() => {
      setAppliedJiraSearch(jiraSearchInput)
    }, TASK_SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timeout)
  }, [jiraSearchInput, taskResumeApplied])

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (!jiraSearchPersistReadyRef.current) {
      jiraSearchPersistReadyRef.current = true
      return
    }
    setTaskResumeState({ jiraQuery: appliedJiraSearch.trim() })
  }, [appliedJiraSearch, setTaskResumeState, taskResumeApplied])

  useTaskPageJiraListDataState({
    activeJiraPreset,
    appliedJiraSearch,
    jiraConnected,
    jiraRefreshNonce,
    selectedJiraSiteId,
    jiraTaskSourceContext,
    jiraTaskSourceScopeKey,
    listJiraIssues,
    searchJiraIssues,
    settings,
    setJiraError,
    setJiraErrorDetailsOpen,
    setJiraIssues,
    setJiraLoading,
    setJiraProjectStatusOrder,
    taskResumeApplied,
    taskSource
  })

  useEffect(() => {
    if (!taskResumeApplied || taskSource !== 'jira') {
      return
    }
    if (!jiraConnected || displayedJiraIssues.length === 0) {
      if (selectedJiraIssueKey !== null) {
        setSelectedJiraIssueKey(null)
      }
      if (selectedJiraIssueFallback !== null) {
        setSelectedJiraIssueFallback(null)
      }
      return
    }
    if (
      selectedJiraIssueKey &&
      !displayedJiraIssues.some((issue) => issue.key === selectedJiraIssueKey)
    ) {
      setSelectedJiraIssueKey(null)
      setSelectedJiraIssueFallback(null)
    }
  }, [
    displayedJiraIssues,
    jiraConnected,
    selectedJiraIssueFallback,
    selectedJiraIssueKey,
    setSelectedJiraIssueFallback,
    setSelectedJiraIssueKey,
    taskResumeApplied,
    taskSource
  ])

  // Why: Linear ids are strings (e.g. "ENG-123") but the provider-generic shape needs a numeric number, so the adapter uses 0 as placeholder.
  const openComposerForLinearItem = useCallback(
    (issue: LinearIssue): void => {
      const linkedWorkItem = buildLinearIssueLinkedWorkItem(issue)
      openModal('new-workspace-composer', {
        linkedWorkItem,
        taskSourceContext: linearTaskSourceContext,
        prefilledName: getLinearIssueWorkspaceName(issue),
        telemetrySource: 'sidebar'
      })
    },
    [linearTaskSourceContext, openModal]
  )

  const handleUseLinearItem = useCallback(
    (issue: LinearIssue): void => {
      // Why: like handleUseWorkItem — open the pre-filled dialog instead of creating the worktree directly, so the user confirms name/agent/setup.
      useAppStore.getState().recordFeatureInteraction('linear-tasks')
      openComposerForLinearItem(issue)
    },
    [openComposerForLinearItem]
  )

  const handleLinearWorkspaceChange = useCallback(
    (workspaceId: LinearWorkspaceSelection): void => {
      clearSelectedLinearIssue()
      setSelectedLinearProject(null)
      setSelectedLinearProjectDetail(null)
      setSelectedLinearCustomView(null)
      setLinearProjectParentView(null)
      setLinearProjectTab('overview')
      setLinearProjectsResult({ items: [] })
      setLinearCustomViewsResult({ items: [] })
      setLinearProjectIssuesResult({ items: [] })
      setLinearCustomViewIssuesResult({ items: [] })
      setLinearCustomViewProjectsResult({ items: [] })
      setLinearProjectDetailError(null)
      setLinearProjectsError(null)
      setLinearCustomViewsError(null)
      setLinearCustomViewContentsError(null)
      setTaskResumeState({
        linearMode,
        linearContext: undefined
      })
      linearContextResumeAttemptedRef.current = false
      setLinearIssues([])
      setLinearError(null)
      setLinearLoading(true)
      void selectLinearWorkspace(workspaceId)
        .then(() => {
          setLinearTeamRefreshNonce((n) => n + 1)
        })
        .catch(() => {
          setLinearLoading(false)
          toast.error(
            translate('auto.components.TaskPage.d0d570b306', 'Failed to switch Linear workspace.')
          )
        })
    },
    [clearSelectedLinearIssue, linearMode, selectLinearWorkspace, setTaskResumeState]
  )

  const handleLinearTeamSelectionChange = useCallback(
    (next: ReadonlySet<string>, persisted: string[] | null): void => {
      setLinearTeamSelection(new Set(next))
      void updateSettings({ defaultLinearTeamSelection: persisted }).catch(() => {
        toast.error(
          translate('auto.components.TaskPage.3f594861a5', 'Failed to save team selection.')
        )
      })
    },
    [updateSettings]
  )

  const handleLinearScopeOpen = useCallback((): void => {
    void checkLinearConnection(true)
    void listLinearTeams(selectedLinearWorkspaceId, { force: true })
      .then((teams) => {
        setAvailableTeams(teams)
      })
      .catch(() => {
        console.warn('[TaskPage] Failed to refresh Linear teams')
      })
  }, [checkLinearConnection, listLinearTeams, selectedLinearWorkspaceId])

  const handleLinearAccessConnected = useCallback((): void => {
    setLinearTeamRefreshNonce((n) => n + 1)
    setLinearRefreshNonce((n) => n + 1)
  }, [])

  const openComposerForJiraItem = useCallback(
    (issue: JiraIssue): void => {
      const taskSourceContext = bindTaskPageJiraItemSourceContext({
        issue,
        sites: jiraSites,
        sourceContext: jiraTaskSourceContext
      })
      if (!taskSourceContext) {
        // Why: composer drops Jira items without matching source context — refuse rather than create unlinked.
        toast.error(
          translate(
            'auto.components.TaskPage.jiraLinkSourceUnavailable',
            'Couldn’t link this Jira issue. Reconnect Jira or pick the matching site, then try again.'
          )
        )
        return
      }
      const linkedWorkItem: LinkedWorkItemSummary = {
        type: 'issue',
        provider: 'jira',
        number: 0,
        title: `${issue.key} ${issue.title}`,
        url: issue.url,
        jiraIdentifier: issue.key
      }
      openModal('new-workspace-composer', {
        linkedWorkItem,
        taskSourceContext,
        prefilledName: getJiraIssueWorkspaceSeed(issue),
        telemetrySource: 'sidebar'
      })
    },
    [jiraSites, jiraTaskSourceContext, openModal]
  )

  const handleUseJiraItem = useCallback(
    (issue: JiraIssue): void => {
      useAppStore.getState().recordFeatureInteraction('jira-tasks')
      openComposerForJiraItem(issue)
    },
    [openComposerForJiraItem]
  )

  const handleCreateLinearItem = useCallback(() => {
    if (linearMode === 'projects' && !selectedLinearProject) {
      setNewLinearProjectName('')
      setNewLinearProjectDescription('')
      setNewLinearProjectContent('')
      setNewLinearProjectTeamId(availableTeams[0]?.id ?? null)
      setNewLinearProjectLeadId(null)
      setNewLinearProjectMemberIds([])
      setNewLinearProjectLabelIds([])
      setNewLinearProjectPriority(0)
      setNewLinearProjectStartDate('')
      setNewLinearProjectTargetDate('')
      setNewLinearProjectOpen(true)
      return
    }
    setNewLinearIssueTitle('')
    setNewLinearIssueBody('')
    const projectTeamId =
      selectedLinearProject?.teams?.[0]?.id ??
      availableTeams.find((team) => team.workspaceId === selectedLinearProject?.workspaceId)?.id
    setNewLinearIssueTeamId(projectTeamId ?? availableTeams[0]?.id ?? null)
    setNewLinearIssueProjectId(selectedLinearProject?.id ?? null)
    setNewLinearIssueOpen(true)
  }, [availableTeams, linearMode, selectedLinearProject])

  const submitLinearSearch = useCallback(() => {
    const trimmed = linearSearchInput.trim()
    setLinearSearchInput(trimmed)
    setAppliedLinearSearch(trimmed)
    setTaskResumeState({ linearQuery: trimmed, linearMode: 'issues' })
    setLinearRefreshNonce((n) => n + 1)
  }, [linearSearchInput, setTaskResumeState])

  const clearLinearSearch = useCallback(() => {
    setLinearSearchInput('')
    setAppliedLinearSearch('')
    setTaskResumeState({ linearQuery: '', linearMode: 'issues' })
    setLinearRefreshNonce((n) => n + 1)
  }, [setTaskResumeState])

  const selectJiraPreset = useCallback(
    (preset: JiraPresetId) => {
      setJiraSearchInput('')
      setAppliedJiraSearch('')
      setActiveJiraPreset(preset)
      setTaskResumeState({ jiraPreset: preset, jiraQuery: '' })
      setJiraRefreshNonce((n) => n + 1)
    },
    [setTaskResumeState]
  )

  const handleCreateJiraIssue = useCallback(() => {
    setNewJiraIssueTitle('')
    setNewJiraIssueBody('')
    setNewJiraIssueProjectId(
      sortedAvailableJiraProjects[0]
        ? getJiraProjectSelectionKey(sortedAvailableJiraProjects[0])
        : null
    )
    setNewJiraIssueProjectQuery('')
    setNewJiraIssueProjectCommandValue('')
    setNewJiraIssueTypeId(null)
    setNewJiraIssueOpen(true)
  }, [sortedAvailableJiraProjects])

  const submitJiraSearch = useCallback(() => {
    const trimmed = jiraSearchInput.trim()
    setJiraSearchInput(trimmed)
    setAppliedJiraSearch(trimmed)
    setTaskResumeState({ jiraQuery: trimmed })
    setJiraRefreshNonce((n) => n + 1)
  }, [jiraSearchInput, setTaskResumeState])

  const clearJiraSearch = useCallback(() => {
    setJiraSearchInput('')
    setAppliedJiraSearch('')
    setTaskResumeState({ jiraQuery: '' })
    setJiraRefreshNonce((n) => n + 1)
  }, [setTaskResumeState])

  const handleGitlabFilterChange = useCallback(
    (filter: GitLabIssueFilter | GitLabTaskFilter) => {
      setGitlabFilter(filter)
      setGitlabRefreshNonce((n) => n + 1)
    },
    [setGitlabFilter, setGitlabRefreshNonce]
  )

  const handleTaskRepoSelectionChange = useCallback(
    (next: ReadonlySet<string>) => {
      const normalized = normalizeTaskRepoSelection(eligibleRepos, next)
      setRepoSelection(normalized)
      void updateSettings({ defaultRepoSelection: [...normalized] }).catch(() => {
        toast.error(
          translate('auto.components.TaskPage.dfd72673e7', 'Failed to save project selection.')
        )
      })
    },
    [eligibleRepos, setRepoSelection, updateSettings]
  )

  const handleTaskSelectAll = useCallback(() => {
    const allIds = new Set(taskPickerRepos.map((repo) => repo.id))
    setRepoSelection(allIds)
    void updateSettings({ defaultRepoSelection: null }).catch(() => {
      toast.error(
        translate('auto.components.TaskPage.dfd72673e7', 'Failed to save project selection.')
      )
    })
  }, [setRepoSelection, taskPickerRepos, updateSettings])

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

  const openSelectedGithubRepo = useCallback(() => {
    if (!selectedGitHubRepoExternalLink?.url) {
      return
    }
    void window.api.shell.openUrl(selectedGitHubRepoExternalLink.url)
  }, [selectedGitHubRepoExternalLink])

  const handleGithubPresetSelect = useCallback(
    (preset: { id: TaskViewPresetId; query: string }) => {
      setTaskSearchInput(preset.query)
      setAppliedTaskSearch(preset.query)
      setActiveTaskPreset(preset.id)
      setTaskResumeState({
        githubItemsPreset: preset.id,
        githubItemsQuery: preset.query
      })
      setTaskRefreshNonce((current) => current + 1)
    },
    [setTaskResumeState]
  )

  const handleCreateGithubIssueFromToolbar = useCallback(() => {
    const seed = resolveNewIssueOpenSeed({
      draft: useAppStore.getState().newIssueDraft,
      selectedRepoIds: selectedRepos.map((repo) => repo.id)
    })
    setNewIssueTitle(seed.title)
    setNewIssueBody(seed.body)
    setNewIssueLabels(seed.labels)
    setNewIssueAssignees(seed.assignees)
    setNewIssueRepoId(seed.repoId)
    setNewIssueOpen(true)
  }, [selectedRepos])

  const handleTaskSourceChange = useCallback(
    (nextSource: TaskProvider): void => {
      taskSourceManuallyChangedRef.current = true
      openTaskPage({ taskSource: nextSource }, { recordTasksInteraction: false })
      void updateSettings({ defaultTaskSource: nextSource }).catch(() => {
        toast.error(
          translate('auto.components.TaskPage.609532fae7', 'Failed to save default task source.')
        )
      })
    },
    [openTaskPage, updateSettings]
  )

  const taskPageListChromeHidden = shouldHideTaskPageListChrome({
    taskSource,
    hasGitHubDetail: Boolean(dialogWorkItem),
    hasGitLabDetail: Boolean(gitlabDialogItem),
    hasJiraDetail: Boolean(selectedJiraIssue),
    hasLinearIssueDetail: Boolean(selectedLinearIssue),
    hasLinearProjectContext: Boolean(selectedLinearProject),
    hasLinearViewContext: Boolean(selectedLinearCustomView)
  })

  return (
    <div className="relative flex h-full min-h-0 flex-1 overflow-hidden bg-background text-foreground">
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Why: pt-1.5 (6px) aligns this 32px icon cluster's center with the sidebar Tasks row, 22px below the titlebar. */}
        <div className="mx-auto flex min-h-0 min-w-0 w-full flex-1 flex-col px-5 pt-1.5 pb-4 md:px-8 md:pt-1.5 md:pb-5">
          <div
            className={cn('flex-none flex flex-col gap-2', taskPageListChromeHidden && 'hidden')}
          >
            <section className="flex flex-col gap-2">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <TaskPageSourceProviderToolbar
                    taskSource={taskSource}
                    visibleSourceOptions={visibleSourceOptions}
                    taskSourceAvailabilityNoticeByProvider={taskSourceAvailabilityNoticeByProvider}
                    taskSourceContextSummary={taskSourceContextSummary}
                    onClose={closeTaskPage}
                    onSourceChange={handleTaskSourceChange}
                  />
                  <TaskPageProviderScopeControls
                    showLinearScope={taskSource === 'linear' && linearConnected}
                    linearScopeProps={{
                      workspaces: linearWorkspaces,
                      selectedWorkspaceId: selectedLinearWorkspaceId,
                      teams: linearTeamOptions,
                      selectedTeamIds: linearTeamSelection,
                      teamSelectionIsStickyAll: defaultLinearTeamSelection == null,
                      onWorkspaceChange: handleLinearWorkspaceChange,
                      onTeamSelectionChange: handleLinearTeamSelectionChange,
                      onAddTeamAccess: () => setLinearConnectOpen(true),
                      onOpen: handleLinearScopeOpen
                    }}
                    selectedLinearTeamForExternalLink={selectedLinearTeamForExternalLink}
                    showJiraSiteSelector={taskSource === 'jira' && jiraConnected}
                    jiraSites={jiraSites}
                    selectedJiraSiteId={selectedJiraSiteId}
                    onJiraSiteChange={(value) => {
                      setSelectedJiraIssueKey(null)
                      setSelectedJiraIssueFallback(null)
                      setJiraIssues([])
                      setJiraError(null)
                      setJiraLoading(true)
                      void selectJiraSite(value).catch(() => {
                        toast.error(
                          translate(
                            'auto.components.TaskPage.d09b7631b7',
                            'Failed to switch Jira site.'
                          )
                        )
                      })
                    }}
                    taskSourceAvailabilityNotice={taskSourceAvailabilityNotice}
                  />
                </div>

                {taskSource === 'github' ? (
                  <TaskPageGitHubScopeToolbar
                    projectModeVisible={projectModeVisible}
                    githubModeButtons={githubModeButtons}
                    githubMode={githubMode}
                    activeGithubTaskKind={activeGithubTaskKind}
                    onModeChange={handleGithubModeChange}
                    groups={taskPickerGroups}
                    selected={repoSelection}
                    getRepoHostLabel={getTaskPickerRepoHostLabel}
                    onRepoSelectionChange={handleTaskRepoSelectionChange}
                    onSelectAll={handleTaskSelectAll}
                    selectedGitHubRepoExternalLink={selectedGitHubRepoExternalLink}
                    onOpenExternal={openSelectedGithubRepo}
                  />
                ) : null}

                {taskSource === 'github' && githubMode === 'items' ? (
                  <TaskPageGitHubTaskToolbar
                    activeGithubTaskKind={activeGithubTaskKind}
                    activeTaskPreset={activeTaskPreset}
                    onPresetSelect={handleGithubPresetSelect}
                    onSetDefaultTaskPreset={handleSetDefaultTaskPreset}
                    parsedTaskQuery={appliedTaskQuery}
                    loadedGitHubAuthorLogins={loadedGitHubAuthorLogins}
                    primaryGithubFilterSlug={primaryGithubFilterSlug}
                    settings={settings}
                    onPRFilterChange={applyPRFilterChange}
                    taskSearchInputRef={taskSearchInputRef}
                    taskSearchInput={taskSearchInput}
                    appliedTaskSearch={appliedTaskSearch}
                    onSearchChange={handleTaskSearchChange}
                    onSearchKeyDown={handleTaskSearchKeyDown}
                    onResetSearch={handleResetGithubTaskSearch}
                    newIssueTargetRepo={Boolean(newIssueTargetRepo)}
                    onCreateIssue={handleCreateGithubIssueFromToolbar}
                    githubTasksBusy={githubTasksBusy}
                    onRefresh={handleRefreshGithubTasks}
                  >
                    <TaskPageGitHubSourceDivergence
                      selectedRepos={selectedRepos}
                      perRepoSourceState={perRepoSourceState}
                      onIssueSourcePreferenceChange={setIssueSourcePreference}
                    />
                  </TaskPageGitHubTaskToolbar>
                ) : taskSource === 'linear' && linearConnected ? (
                  <TaskPageLinearToolbar
                    linearModeOptions={linearModeOptions}
                    linearMode={linearMode}
                    onModeChange={selectLinearMode}
                    onCreate={handleCreateLinearItem}
                    onRefresh={() => setLinearRefreshNonce((n) => n + 1)}
                    availableTeams={availableTeams}
                    selectedLinearProject={selectedLinearProject}
                    linearLoading={linearLoading}
                    linearProjectsLoading={linearProjectsLoading}
                    linearProjectDetailLoading={linearProjectDetailLoading}
                    linearCustomViewsLoading={linearCustomViewsLoading}
                    linearCustomViewContentsLoading={linearCustomViewContentsLoading}
                    showAttributeFilters={showLinearAttributeFilters}
                    attributeFilter={linearAttributeFilter}
                    onAttributeFilterChange={applyLinearAttributeFilter}
                    workspaceId={selectedLinearWorkspaceId ?? null}
                    isAllWorkspaces={selectedLinearWorkspaceId === 'all'}
                    primaryTeam={linearAttributePrimaryTeam}
                    selectedTeamIds={[...linearTeamSelection]}
                    settings={linearTaskSourceContext ?? settings}
                    linearSearchInput={linearSearchInput}
                    onLinearSearchChange={setLinearSearchInput}
                    onLinearSearchSubmit={submitLinearSearch}
                    onLinearSearchClear={clearLinearSearch}
                    linearProjectSearchInput={linearProjectSearchInput}
                    onLinearProjectSearchChange={setLinearProjectSearchInput}
                    onLinearProjectSearchClear={() => {
                      setLinearProjectSearchInput('')
                      setAppliedLinearProjectSearch('')
                      setLinearRefreshNonce((n) => n + 1)
                    }}
                  />
                ) : taskSource === 'jira' && jiraConnected ? (
                  <TaskPageJiraToolbar
                    jiraPresets={jiraPresets}
                    activeJiraPreset={activeJiraPreset}
                    onPresetChange={selectJiraPreset}
                    onCreate={handleCreateJiraIssue}
                    sortedAvailableJiraProjects={sortedAvailableJiraProjects}
                    jiraProjectsLoading={jiraProjectsLoading}
                    onRefresh={() => setJiraRefreshNonce((n) => n + 1)}
                    jiraLoading={jiraLoading}
                    jiraSearchInput={jiraSearchInput}
                    onSearchChange={setJiraSearchInput}
                    onSearchSubmit={submitJiraSearch}
                    onSearchClear={clearJiraSearch}
                  />
                ) : taskSource === 'gitlab' ? (
                  <TaskPageGitLabToolbar
                    gitlabView={gitlabView}
                    onViewChange={setGitlabView}
                    gitLabIssueFilters={gitLabIssueFilters}
                    gitLabMRFilters={gitLabMRFilters}
                    activeGitlabFilter={activeGitlabFilter}
                    onFilterChange={handleGitlabFilterChange}
                    groups={taskPickerGroups}
                    selected={repoSelection}
                    getRepoHostLabel={getTaskPickerRepoHostLabel}
                    onRepoSelectionChange={handleTaskRepoSelectionChange}
                    onSelectAll={handleTaskSelectAll}
                    gitlabLoading={gitlabLoading}
                    gitlabTodosLoading={gitlabTodosLoading}
                    onRefresh={() => setGitlabRefreshNonce((n) => n + 1)}
                  />
                ) : null}
              </div>
            </section>
          </div>

          {taskSource === 'github' && dialogWorkItem ? (
            dialogWorkItem.type === 'pr' ? (
              <PullRequestPage
                workItem={dialogWorkItem}
                initialTab={dialogInitialTab}
                repoPath={dialogRepoPath}
                repoId={dialogWorkItem.repoId}
                sourceContext={dialogSourceContext}
                backLabel="Pull requests"
                onUse={(item) => {
                  setDialogWorkItem(null)
                  handleUseWorkItem(item)
                }}
                onReviewRequestsChange={handleDialogReviewRequestsChange}
                onClose={closeTaskDetailPage}
              />
            ) : (
              <GitHubItemDialog
                workItem={dialogWorkItem}
                initialTab={dialogInitialTab}
                repoPath={dialogRepoPath}
                repoId={dialogWorkItem.repoId}
                sourceContext={dialogSourceContext}
                backLabel="GitHub list"
                onUse={(item) => {
                  setDialogWorkItem(null)
                  handleUseWorkItem(item)
                }}
                onReviewRequestsChange={handleDialogReviewRequestsChange}
                onClose={closeTaskDetailPage}
              />
            )
          ) : taskSource === 'github' && githubMode === 'project' ? (
            <div className="mt-3 flex min-h-0 min-w-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-muted/50 shadow-sm">
              <ProjectViewWrapper selectedRepoIds={repoSelection} />
            </div>
          ) : taskSource === 'github' ? (
            <TaskPageGitHubItemsTable
              tasksError={tasksError}
              githubUnavailable={githubUnavailable}
              failedCount={failedCount}
              selectedRepoCount={selectedRepos.length}
              perRepoSourceState={perRepoSourceState}
              unresolvedSourceRepos={unresolvedSourceRepos}
              retryingSourceKeys={retryingSourceKeys}
              tasksLoading={tasksLoading}
              handleRetryIssuesFetch={handleRetryIssuesFetch}
              showGitHubTaskSkeletons={showGitHubTaskSkeletons}
              filteredWorkItems={filteredWorkItems}
              githubEmptyState={githubEmptyState}
              githubTaskGridClass={githubTaskGridClass}
              activeGithubTaskKind={activeGithubTaskKind}
              showPRManagementColumns={showPRManagementColumns}
              rows={{
                filteredWorkItems,
                repoMap,
                allWorktrees,
                selectedRepoCount: selectedRepos.length,
                showPRManagementColumns,
                githubTaskGridClass,
                formatRelativeTime,
                openGitHubDetailPage,
                ensurePRChecksLoaded,
                handleOpenOrUseGitHubWorkItem,
                handleUseWorkItem,
                onRefresh: () => setTaskRefreshNonce((current) => current + 1),
                GHAssigneesCell,
                PRReviewCell,
                PRChecksCell,
                PRMergeCell,
                GHStatusCell
              }}
              currentPage={currentPage}
              totalPages={totalPages}
              loadingTargetPage={loadingTargetPage}
              pages={pages}
              setCurrentPage={setCurrentPage}
              handleLoadNextPage={handleLoadNextPage}
            />
          ) : taskSource === 'gitlab' && gitlabView === 'todos' ? (
            <TaskPageGitLabTodosTable
              gitlabTodos={gitlabTodos}
              gitlabTodosLoading={gitlabTodosLoading}
              primaryRepo={primaryRepo}
            />
          ) : taskSource === 'gitlab' ? (
            <TaskPageGitLabItemsTable
              gitlabError={gitlabError}
              gitlabLoading={gitlabLoading}
              gitlabItems={gitlabItems}
              displayedGitLabItems={displayedGitLabItems}
              gitlabEmptyState={gitlabEmptyState}
              openGitLabDetailPage={openGitLabDetailPage}
              handleUseGitLabItem={handleUseGitLabItem}
            />
          ) : taskSource === 'jira' ? (
            <TaskPageJiraListSurface
              jiraStatusReady={jiraStatusReady}
              jiraConnected={jiraConnected}
              jiraCredentialError={jiraStatus.credentialError}
              onConnect={() => setJiraConnectOpen(true)}
              onHide={() => hideTaskSource('jira', 'Jira')}
              displayedJiraIssueCount={displayedJiraIssues.length}
              jiraOrderDirection={jiraOrderDirection}
              jiraOrderBy={jiraOrderBy}
              onSort={handleJiraSort}
              jiraError={jiraError}
              jiraErrorDetailsOpen={jiraErrorDetailsOpen}
              onJiraErrorDetailsOpenChange={setJiraErrorDetailsOpen}
              jiraLoading={jiraLoading}
              jiraIssues={jiraIssues}
              jiraSearchInput={jiraSearchInput}
              sortedJiraIssues={sortedJiraIssues}
              formatUpdatedAt={formatRelativeTime}
              getStatusTone={getJiraStatusTone}
              onOpenIssue={openJiraDetailPage}
              onStartWorkspace={handleUseJiraItem}
              selectedIssue={selectedJiraIssue}
              showSiteContext={selectedJiraSiteId === 'all'}
              statusDirection={jiraOrderBy === 'status' ? jiraOrderDirection : 'asc'}
              statusOrder={displayedJiraStatusOrder}
              onUse={handleUseJiraItem}
              onClose={closeTaskDetailPage}
              sourceContext={jiraDetailSourceContext}
            />
          ) : taskSource === 'linear' && selectedLinearIssue ? (
            <LinearIssueWorkspace
              issue={selectedLinearIssue}
              variant="page"
              backLabel={activeLinearIssueContextLabel ?? 'Linear list'}
              onUse={handleUseLinearItem}
              onOpenIssue={openRelatedLinearIssue}
              onClose={closeTaskDetailPage}
              sourceContext={linearDetailSourceContext}
            />
          ) : !linearStatusReady ? (
            <div className="mt-4 flex items-center justify-center py-14">
              <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : !linearConnected ? (
            <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
              <LinearIcon className="mb-4 size-8 text-muted-foreground/60" />
              <p className="text-base font-medium text-foreground">
                {translate('auto.components.TaskPage.6d56559467', 'Connect your Linear account')}
              </p>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                {translate(
                  'auto.components.TaskPage.228b25028f',
                  'Browse and start work on your assigned Linear issues directly from here.'
                )}
              </p>
              <Button
                className="mt-5"
                onClick={() => {
                  setLinearConnectOpen(true)
                }}
              >
                {translate('auto.components.TaskPage.851017590d', 'Add Linear access')}
              </Button>
            </div>
          ) : (selectedLinearProject && linearProjectTab === 'overview') ||
            (linearMode === 'projects' && !selectedLinearProject) ||
            (linearMode === 'views' && !selectedLinearCustomView) ||
            (selectedLinearCustomView?.model === 'project' && !selectedLinearProject) ? (
            <TaskPageLinearCollectionViews
              selectedLinearProject={selectedLinearProject}
              selectedLinearProjectDetail={selectedLinearProjectDetail}
              linearProjectDetailLoading={linearProjectDetailLoading}
              linearProjectDetailError={linearProjectDetailError}
              linearProjectTab={linearProjectTab}
              linearProjectParentView={linearProjectParentView}
              linearMode={linearMode}
              linearProjectsResult={linearProjectsResult}
              linearProjectsLoading={linearProjectsLoading}
              linearProjectsError={linearProjectsError}
              linearCustomViewsResult={linearCustomViewsResult}
              linearCustomViewsLoading={linearCustomViewsLoading}
              linearCustomViewsError={linearCustomViewsError}
              selectedLinearCustomView={selectedLinearCustomView}
              linearCustomViewProjectsResult={linearCustomViewProjectsResult}
              linearCustomViewContentsLoading={linearCustomViewContentsLoading}
              linearCustomViewContentsError={linearCustomViewContentsError}
              selectedLinearWorkspaceId={selectedLinearWorkspaceId}
              setSelectedLinearProject={setSelectedLinearProject}
              setSelectedLinearProjectDetail={setSelectedLinearProjectDetail}
              setLinearProjectTab={setLinearProjectTab}
              setLinearMode={setLinearMode}
              setSelectedLinearCustomView={setSelectedLinearCustomView}
              setLinearProjectParentView={setLinearProjectParentView}
              setTaskResumeState={setTaskResumeState}
              onRefresh={() => setLinearRefreshNonce((n) => n + 1)}
              openLinearProjectContext={openLinearProjectContext}
              openLinearCustomViewContext={openLinearCustomViewContext}
            />
          ) : (
            <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
              <TaskPageLinearIssueHeader
                activeLinearIssueContextLabel={activeLinearIssueContextLabel}
                onBack={() => {
                  if (selectedLinearProject) {
                    setLinearProjectTab('overview')
                    return
                  }
                  setSelectedLinearCustomView(null)
                  setLinearProjectParentView(null)
                  setTaskResumeState({ linearContext: undefined })
                }}
                linearViewOptions={linearViewOptions}
                linearViewMode={linearViewMode}
                onViewModeChange={setLinearViewMode}
                linearGroupOptions={linearGroupOptions}
                linearGroupBy={linearGroupBy}
                onGroupByChange={setLinearGroupBy}
                linearOrderOptions={linearOrderOptions}
                linearOrderBy={linearOrderBy}
                onOrderByChange={setLinearOrderBy}
                linearDisplayPropertyOptions={linearDisplayPropertyOptions}
                effectiveLinearDisplayProperties={effectiveLinearDisplayProperties}
                onToggleDisplayProperty={toggleLinearDisplayProperty}
                shownIssueCount={pagedLinearIssues.length}
              />

              <TaskPageLinearIssueBody
                linearViewMode={linearViewMode}
                linearGroupBy={linearGroupBy}
                linearIssueGridStyle={linearIssueGridStyle}
                effectiveLinearDisplayProperties={effectiveLinearDisplayProperties}
                activeLinearIssueError={activeLinearIssueError}
                activeLinearIssueLoading={activeLinearIssueLoading}
                activeLinearIssues={activeLinearIssues}
                activeLinearIssueHasCollectionError={activeLinearIssueHasCollectionError}
                activeLinearIssueContextLabel={activeLinearIssueContextLabel}
                linearSearchActive={linearSearchActive}
                linearAttributeFilter={linearAttributeFilter}
                filteredLinearIssues={filteredLinearIssues}
                linearIssuesHasMore={linearIssuesHasMore}
                onFetchMore={() => {
                  setLinearIssueLimit((limit) =>
                    Math.min(
                      clampLinearIssueListLimit(limit + LINEAR_ITEM_LIMIT),
                      LINEAR_ISSUE_LIST_MAX
                    )
                  )
                }}
                boardProps={{
                  sections: linearBoardSections,
                  effectiveDisplayProperties: effectiveLinearDisplayProperties,
                  selectedIssueId: selectedLinearIssueId,
                  selectedWorkspaceId: selectedLinearWorkspaceId,
                  statusBoardEnabled: linearStatusBoardEnabled,
                  dragOverKey: linearBoardDragOverKey,
                  draggingIssueId: linearBoardDraggingIssueId,
                  updatingIssueIds: linearBoardUpdatingIssueIds,
                  sourceContext: linearTaskSourceContext,
                  onDragStart: handleLinearBoardCardDragStart,
                  onDragOver: handleLinearBoardDragOver,
                  onDrop: (section, event) => void handleLinearBoardDrop(section, event),
                  onDragEnd: () => {
                    setLinearBoardDraggingIssueId(null)
                    setLinearBoardDragOverKey(null)
                  },
                  onOpenIssue: openLinearDetailPage,
                  onUseIssue: handleUseLinearItem
                }}
                listProps={{
                  rows: linearIssueListRows,
                  effectiveDisplayProperties: effectiveLinearDisplayProperties,
                  gridStyle: linearIssueGridStyle,
                  selectedIssueId: selectedLinearIssueId,
                  selectedWorkspaceId: selectedLinearWorkspaceId,
                  sourceContext: linearTaskSourceContext,
                  onOpenIssue: openLinearDetailPage,
                  onUseIssue: handleUseLinearItem
                }}
                collectionErrors={
                  selectedLinearProject && linearProjectTab === 'issues'
                    ? linearProjectIssuesResult.errors
                    : selectedLinearCustomView?.model === 'issue'
                      ? linearCustomViewIssuesResult.errors
                      : undefined
                }
                collectionCount={
                  selectedLinearProject && linearProjectTab === 'issues'
                    ? linearProjectIssuesResult.items.length
                    : selectedLinearCustomView?.model === 'issue'
                      ? linearCustomViewIssuesResult.items.length
                      : linearIssues.length
                }
                collectionLabel={
                  selectedLinearProject && linearProjectTab === 'issues'
                    ? translate('auto.components.TaskPage.67662ade50', 'project issues')
                    : selectedLinearCustomView?.model === 'issue'
                      ? translate('auto.components.TaskPage.be8cf68d9f', 'view issues')
                      : translate('auto.components.TaskPage.d1e243795c', 'issues')
                }
                showLinearEmptyFilteredLoadMore={showLinearEmptyFilteredLoadMore}
                onLoadMore={handleLinearEmptyFilteredLoadMore}
                showLinearIssuePagination={showLinearIssuePagination}
                visibleLinearIssuePage={visibleLinearIssuePage}
                linearIssueTotalPages={linearIssueTotalPages}
                activeLinearIssueLoadingTargetPage={activeLinearIssueLoadingTargetPage}
                onPageChange={handleLinearIssuePageChange}
              />
            </div>
          )}
        </div>
      </div>

      <TaskPageGitHubIssueDialog
        context={{
          newIssueOpen,
          setNewIssueOpen,
          newIssueSubmitting,
          isScreenSubmitShortcut,
          handleCreateNewIssue,
          newIssueTargetRepo,
          newIssueSourcePreferenceChange: setIssueSourcePreference,
          perRepoSourceState,
          selectedRepos,
          newIssueRepoId,
          onRepoChange: (repoId) => {
            setNewIssueRepoId(repoId)
            const reset = resolveUserRepoSwitchReset()
            setNewIssueLabels(reset.labels)
            setNewIssueAssignees(reset.assignees)
          },
          newIssueTitle,
          setNewIssueTitle,
          newIssueBody,
          setNewIssueBody,
          newIssueRepoLabels,
          newIssueLabels,
          setNewIssueLabels,
          newIssueRepoAssignees,
          newIssueAssignees,
          setNewIssueAssignees,
          submitShortcutLabel
        }}
      />
      <TaskPageLinearProjectDialog
        context={{
          newLinearProjectOpen,
          setNewLinearProjectOpen,
          newLinearProjectSubmitting,
          isScreenSubmitShortcut,
          handleCreateNewLinearProject,
          availableTeams,
          newLinearProjectTargetTeam,
          setNewLinearProjectTeamId,
          newLinearProjectName,
          setNewLinearProjectName,
          newLinearProjectDescription,
          setNewLinearProjectDescription,
          newLinearProjectPriority,
          setNewLinearProjectPriority,
          newLinearProjectMembers,
          newLinearProjectLeadId,
          setNewLinearProjectLeadId,
          newLinearProjectMemberIds,
          setNewLinearProjectMemberIds,
          newLinearProjectLabels,
          newLinearProjectLabelIds,
          setNewLinearProjectLabelIds,
          newLinearProjectStartDate,
          setNewLinearProjectStartDate,
          newLinearProjectTargetDate,
          setNewLinearProjectTargetDate,
          newLinearProjectContent,
          setNewLinearProjectContent,
          submitShortcutLabel
        }}
      />
      <TaskPageLinearIssueDialog
        context={{
          newLinearIssueOpen,
          setNewLinearIssueOpen,
          newLinearIssueSubmitting,
          isScreenSubmitShortcut,
          handleCreateNewLinearIssue,
          availableTeams,
          newLinearIssueTargetTeam,
          newLinearIssueTeamId,
          setNewLinearIssueTeamId,
          newLinearIssueTitle,
          setNewLinearIssueTitle,
          newLinearIssueBody,
          setNewLinearIssueBody,
          newLinearStates,
          newLinearIssueStateId,
          setNewLinearIssueStateId,
          newLinearMembers,
          newLinearIssueAssigneeId,
          setNewLinearIssueAssigneeId,
          newLinearIssuePriority,
          setNewLinearIssuePriority,
          newLinearIssueProjects,
          newLinearIssueProjectsLoading,
          newLinearIssueProjectId,
          setNewLinearIssueProjectId,
          newLinearLabels,
          newLinearIssueLabelIds,
          setNewLinearIssueLabelIds,
          submitShortcutLabel
        }}
      />
      <TaskPageJiraIssueDialog
        context={{
          newJiraIssueOpen,
          setNewJiraIssueOpen,
          newJiraIssueSubmitting,
          isScreenSubmitShortcut,
          handleCreateNewJiraIssue,
          newJiraIssueTargetProject,
          newJiraIssueProjectComboboxOpen,
          handleNewJiraIssueProjectComboboxOpenChange,
          sortedAvailableJiraProjects,
          includeJiraSiteNameInProjectLabel,
          handleNewJiraIssueProjectTriggerKeyDown,
          newJiraIssueProjectCommandValue,
          setNewJiraIssueProjectCommandValue,
          newJiraIssueProjectSearchInputRef,
          newJiraIssueProjectQuery,
          setNewJiraIssueProjectQuery,
          filteredNewJiraIssueProjects,
          newJiraIssueTargetProjectSelectionKey,
          handleNewJiraIssueProjectSelect,
          newJiraIssueTargetType,
          jiraIssueTypesLoading,
          availableJiraIssueTypes,
          newJiraIssueTypeId,
          setNewJiraIssueTypeId,
          newJiraIssueTitle,
          setNewJiraIssueTitle,
          newJiraIssueBody,
          setNewJiraIssueBody,
          visibleJiraCreateFields,
          newJiraIssueCustomFieldValues,
          setNewJiraIssueCustomFieldValues,
          submitShortcutLabel,
          hasMissingJiraCreateField,
          jiraCreateFieldsLoading,
          jiraCreateFieldsError
        }}
      />
      <GitLabItemDialog
        item={gitlabDialogItem}
        // Why: repoPath comes from the clicked item's own repo, not primaryRepo — the GitLab fetch is now multi-repo.
        repoPath={gitlabDialogRepo?.path ?? null}
        repoId={gitlabDialogItem?.repoId ?? null}
        sourceContext={gitlabDialogSourceContext}
        onCreateWorkspace={(item) => {
          setGitlabDialogItem(null)
          handleUseGitLabItem(item)
        }}
        onClose={() => setGitlabDialogItem(null)}
      />
      <LinearApiKeyDialog
        open={linearConnectOpen}
        onOpenChange={setLinearConnectOpen}
        workspace={selectedLinearWorkspace}
        connectLabel={selectedLinearWorkspace ? 'Update access' : 'Add Linear access'}
        onConnected={handleLinearAccessConnected}
      />

      <JiraConnectDialog open={jiraConnectOpen} onOpenChange={setJiraConnectOpen} />
    </div>
  )
}
