import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  AlertCircle,
  ArrowDownUp,
  ArrowRight,
  ChevronDown,
  ChevronLeft,
  ExternalLink,
  Eye,
  List,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X
} from 'lucide-react'
import { toast } from 'sonner'

import { useAppStore } from '@/store'
import { useTaskPageStoreBindings } from './use-task-page-store-bindings'
import { useTaskPageSourceSelection } from './use-task-page-source-selection'
import { useTaskPageProviderContext } from './use-task-page-provider-context'
import { useTaskPageGitLabData } from './use-task-page-gitlab-data'
import { TaskPageJiraErrorBanner } from './task-page-jira-error-banner'
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
import {
  LinearStateCell,
  getLinearIssueGridTemplate,
  getJiraStatusTone
} from './task-page-linear-cells'
import { PRChecksCell, PRMergeCell } from './task-page-github-pr-cells'
import { TaskPageLinearCollectionViews } from './task-page-linear-collection-views'
import { TaskPageLinearIssueList } from './task-page-linear-issue-list'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import TaskProjectSourceCombobox from '@/components/task-project-source-combobox'
import { JiraConnectDialog } from '@/components/jira-connect-dialog'
import { LinearApiKeyDialog } from '@/components/linear-api-key-dialog'
import { LinearScopeSelector } from '@/components/linear-scope-selector'
import RepoBadgeLabel from '@/components/repo/RepoBadgeLabel'
import IssueSourceIndicator, { sameGitHubOwnerRepo } from '@/components/github/IssueSourceIndicator'
import IssueSourceSelector, { issueSourceChipClass } from '@/components/github/IssueSourceSelector'
import { LinearPriorityIcon } from '@/components/linear-priority-icon'
import { reconcileLinearTeamSelection } from '@/components/task-page-linear-team-selection'
import {
  getGitHubWorkItemWorkspaceSeed,
  getGitLabWorkItemWorkspaceSeed,
  getJiraIssueWorkspaceSeed,
  getTaskPageRepoCacheInput,
  getTaskPageRepoSourceContext
} from './task-page-source-context'
import { filterJiraProjectPickerProjects } from '@/components/jira-project-picker-filter'
import { parseTaskQuery, stripRepoQualifiers, withQualifier } from '../../../shared/task-query'
import {
  buildLinearTeamUrl,
  getLinearOrganizationUrlKeyFromIssueUrl
} from '../../../shared/linear-links'
import PRFilterDropdowns, { type PRFilterChange } from '@/components/github/PRFilterDropdowns'
import { buildGitHubRepoUrl } from '@/lib/github-links'
import { findGithubWorkItemWorkspaceAttachment } from '@/lib/github-work-item-workspace-attachment'
import { createGitHubWorkItemWorkspaceInBackground } from '@/lib/github-work-item-background-create'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import GitHubItemDialog, { type ItemDialogTab } from '@/components/GitHubItemDialog'
import PullRequestPage from '@/components/PullRequestPage'
import GitLabItemDialog from '@/components/GitLabItemDialog'
import ProjectViewWrapper from '@/components/github-project/ProjectViewWrapper'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import LinearIssueWorkspace from '@/components/LinearIssueWorkspace'
import { LinearCollectionNotice } from '@/components/linear-project-view-surfaces'
import JiraIssueWorkspace from '@/components/JiraIssueWorkspace'
import { TaskPageJiraIssueList } from '@/components/task-page-jira-issue-list'
import {
  getSingleJiraProjectScope,
  getTaskPageJiraStatusOrderScopeKey,
  loadTaskPageJiraProjectStatusOrder
} from '@/components/task-page-jira-status-order'
import { JiraIcon } from '@/components/icons/JiraIcon'
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
import { getTaskSourceRuntimeSettings } from '../../../shared/task-source-context'
import { getLinearIssueWorkspaceName } from '../../../shared/workspace-name'
import {
  buildTaskPageRepoSourceState,
  deriveTaskPageGitHubWorkItemsFetchOptions,
  findTaskPageDialogWorkItem,
  findTaskPageLinearIssue,
  reconcileTaskPageLinearIssuesAfterLandingRefresh,
  reconcileTaskPagePagesAfterLandingRefresh,
  reconcileTaskPagePagesWithWorkItemsCache,
  shouldResetTaskPagePaginationAfterLandingRefresh,
  selectTaskPageUnresolvedSourceRepos,
  selectTaskPageWorkItemsCacheEntries,
  shouldReplaceTaskPageItemsAfterRefresh,
  type TaskPageRepoSourceState
} from '@/components/task-page-cache-selectors'
import { shouldHideTaskPageListChrome } from '@/components/task-page-list-chrome-visibility'
import {
  getTaskPagePerRepoLimit,
  taskPageToGitHubApiPage
} from '@/components/task-page-work-item-pagination'
import { sortWorkItemsByNumber } from '../../../shared/work-items'
import LinearIssueAttributeFilterDropdowns from '@/components/linear-issue-attribute-filter-dropdowns'
import { resolveLinearIssueAttributeFilterPrimaryTeam } from '@/components/linear-issue-attribute-filter-primary-team'
import {
  buildLinearIssueListReadArgs,
  buildLinearIssueListRequestSignature,
  isLinearIssueSearchActive,
  shouldForceLinearIssueListRead,
  teamDerivedFacetsForPrimaryTeamChange
} from '@/components/task-page-linear-issue-request'
import {
  resolveLinearIssueEmptyKind,
  shouldOfferLinearIssueFetchMore
} from '@/components/task-page-linear-issue-empty-state'
import {
  emptyLinearIssueAttributeFilter,
  linearIssueAttributeFilterSignature,
  type LinearIssueAttributeFilter
} from '../../../shared/linear-issue-attribute-filter'
import {
  isNewIssueDraftContentful,
  resolveNewIssueOpenSeed,
  resolveUserRepoSwitchReset,
  resolveVanishedNewIssueRepoReset
} from '@/components/task-page-new-issue-draft'
import { findTaskPageJiraIssue } from '@/components/task-page-jira-cache-selectors'
import { getRepoBackedTaskEmptyState } from '@/components/task-page-empty-state'
import {
  createTaskPageJiraLoadFailureState,
  type TaskPageJiraLoadError
} from '@/components/task-page-jira-load-state'
import { deriveTaskPagePRCheckSummary } from '@/components/task-page-pr-check-summary'
import type {
  GitHubOwnerRepo,
  GitHubAssignableUser,
  GitHubWorkItem,
  GitLabWorkItem,
  JiraCreateField,
  LinearCollectionResult,
  LinearCustomViewModel,
  LinearCustomViewSummary,
  JiraIssue,
  JiraIssueType,
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
import {
  useRepoAssignees,
  useRepoLabels,
  useTeamStates,
  useTeamMembers,
  useTeamLabels
} from '@/hooks/useIssueMetadata'
import {
  linearCreateProject,
  linearCreateIssue,
  linearGetIssue,
  linearTeamStates,
  linearUpdateIssue,
  linearListProjects
} from '@/runtime/runtime-linear-client'
import {
  jiraCreateIssue,
  jiraGetIssue,
  jiraListCreateFields,
  jiraListIssueTypes,
  jiraListProjects,
  jiraListPriorities
} from '@/runtime/runtime-jira-client'
import {
  sortJiraIssues,
  type JiraIssueSortColumn,
  type JiraIssueSortDirection,
  type JiraPrioritiesBySite
} from './jira-issue-sorter'
import { TaskPageJiraSortControls } from './task-page-jira-sort-controls'
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
  getLinearStatusSectionState,
  mergeLinearCollectionResults
} from './task-page-linear-model'
import {
  getEffectiveLinearDisplayProperties,
  getLinearIssueListRows,
  getLinearIssuePageState,
  type LinearIssueListRow
} from './task-page-linear-list-model'
import { PaginationBar } from './task-page-pagination'
import {
  buildJiraCreateCustomFields,
  compareJiraProjectsByDisplayLabel,
  getJiraProjectSelectionKey,
  isVisibleJiraCreateField
} from './task-page-jira-create-model'
import {
  getGitHubTaskKindPresets,
  type GitHubTaskKind,
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
const JIRA_ITEM_LIMIT = 50
const PR_CHECKS_EAGER_PREFETCH_LIMIT = 20

const GITHUB_TASK_GRID_CLASS =
  'min-w-[790px] grid-cols-[72px_minmax(320px,1fr)_84px_100px_92px_122px]'
const GITHUB_PR_TASK_GRID_CLASS =
  'min-w-[1020px] grid-cols-[72px_minmax(360px,2fr)_132px_128px_132px_92px_158px]'

type LinearProjectTab = 'overview' | 'issues'

const LINEAR_CUSTOM_VIEW_MODELS = ['issue', 'project'] satisfies readonly LinearCustomViewModel[]

function sameOptionalGitHubOwnerRepo(
  left: GitHubOwnerRepo | null | undefined,
  right: GitHubOwnerRepo | null | undefined
): boolean {
  const leftValue = left ?? null
  const rightValue = right ?? null
  return leftValue === null && rightValue === null
    ? true
    : sameGitHubOwnerRepo(leftValue, rightValue)
}

const hasDivergentSources = (
  s: TaskPageRepoSourceState
): s is TaskPageRepoSourceState & {
  sources: { issues: GitHubOwnerRepo; prs: GitHubOwnerRepo }
} => !!s.sources?.issues && !!s.sources.prs && !sameGitHubOwnerRepo(s.sources.issues, s.sources.prs)

// Why: gate on raw origin/upstream candidate divergence, not effective sources, so the toggle keeps rendering after the user picks 'upstream'.
const hasUpstreamCandidateDivergence = (
  s: TaskPageRepoSourceState
): s is TaskPageRepoSourceState & {
  sources: { originCandidate: GitHubOwnerRepo; upstreamCandidate: GitHubOwnerRepo }
} =>
  !!s.sources?.originCandidate &&
  !!s.sources.upstreamCandidate &&
  !sameGitHubOwnerRepo(s.sources.originCandidate, s.sources.upstreamCandidate)

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

  const [gitlabDialogItem, setGitlabDialogItem] = useState<GitLabWorkItem | null>(null)
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
  const paginationGenerationRef = useRef(0)
  // Why: entering Tasks with fresh cache still verifies remote status once, reconciled into existing rows to avoid a full table shuffle.
  const landingGitHubRefreshKeysRef = useRef<ReadonlySet<string>>(new Set())
  // Why: split the display budget across repos so one provider page maps to one UI page without truncating rows later pages can't return.
  const githubPerRepoPageLimit = getTaskPagePerRepoLimit(
    selectedRepos.length,
    PER_REPO_FETCH_LIMIT,
    CROSS_REPO_DISPLAY_LIMIT
  )
  const githubPageSize = githubPerRepoPageLimit * Math.max(1, selectedRepos.length)
  // Why: null entries are pages not fetched yet; numbered provider pages let a high-page click load directly without reading intermediate pages.
  const [pages, setPages] = useState<(GitHubWorkItem[] | null)[]>(() => {
    const trimmed = initialTaskQuery.trim()
    const merged: GitHubWorkItem[] = []
    for (const r of selectedRepos) {
      const cached = getCachedWorkItems(
        r.id,
        githubPerRepoPageLimit,
        trimmed,
        r.path,
        getTaskPageRepoSourceContext(r, 'github')
      )
      if (cached) {
        merged.push(...cached)
      }
    }
    if (merged.length === 0) {
      return [[]]
    }
    const page0 = sortWorkItemsByNumber(merged).slice(0, githubPageSize)
    return [page0]
  })
  const [currentPage, setCurrentPage] = useState(0)
  const [paginationLoading, setPaginationLoading] = useState(false)
  const [loadingTargetPage, setLoadingTargetPage] = useState<number | null>(null)
  const [countedTotalPages, setCountedTotalPages] = useState<number | null>(null)
  const fetchWorkItemsNextPage = useAppStore((s) => s.fetchWorkItemsNextPage)
  const countWorkItemsAcrossRepos = useAppStore((s) => s.countWorkItemsAcrossRepos)

  useEffect(() => {
    paginationGenerationRef.current += 1
    setPaginationLoading(false)
    setLoadingTargetPage(null)
  }, [selectedRepos, appliedTaskSearch, workItemsInvalidationNonce])

  // Why: the dialog's "Use" button routes through the same direct-launch flow as the row-level "Use" CTA so behavior is consistent regardless of entry point.
  const githubTaskDrawerWorkItem = useAppStore((s) => s.githubTaskDrawerWorkItem)
  const setGithubTaskDrawerWorkItem = useAppStore((s) => s.setGithubTaskDrawerWorkItem)
  const [dialogInitialTab, setDialogInitialTab] = useState<ItemDialogTab>('conversation')
  const dialogWorkItemKey = githubTaskDrawerWorkItem
    ? { id: githubTaskDrawerWorkItem.id, repoId: githubTaskDrawerWorkItem.repoId }
    : null

  const appliedWorkItemsCacheQuery = useMemo(
    () => stripRepoQualifiers(appliedTaskSearch.trim()),
    [appliedTaskSearch]
  )
  const selectedWorkItemsCacheEntries = useAppStore(
    useShallow((s) =>
      selectTaskPageWorkItemsCacheEntries(
        s.workItemsCache,
        selectedRepos.map(getTaskPageRepoCacheInput),
        githubPerRepoPageLimit,
        appliedWorkItemsCacheQuery
      )
    )
  )

  // Why: derive the dialog item from the cache for optimistic patches, falling back to the click-time snapshot for new stubs; key by repoId so same-number issues across repos resolve to the clicked row.
  const cachedDialogWorkItem = useAppStore((s) =>
    findTaskPageDialogWorkItem(s.workItemsCache, dialogWorkItemKey)
  )
  const dialogWorkItem = dialogWorkItemKey
    ? (cachedDialogWorkItem ?? githubTaskDrawerWorkItem)
    : null
  const dialogRepoPath = dialogWorkItem ? (repoMap.get(dialogWorkItem.repoId)?.path ?? null) : null
  const dialogSourceContext = useMemo(() => {
    if (!dialogWorkItem) {
      return null
    }
    if (
      pageData.openGitHubSourceContext?.provider === 'github' &&
      pageData.openGitHubWorkItem?.id === dialogWorkItem.id &&
      pageData.openGitHubWorkItem.repoId === dialogWorkItem.repoId
    ) {
      return pageData.openGitHubSourceContext
    }
    return getTaskPageRepoSourceContext(repoMap.get(dialogWorkItem.repoId), 'github')
  }, [dialogWorkItem, pageData.openGitHubSourceContext, pageData.openGitHubWorkItem, repoMap])
  const gitlabDialogRepo = useMemo(
    () =>
      gitlabDialogItem
        ? (selectedRepos.find((r) => r.id === gitlabDialogItem.repoId) ?? primaryRepo)
        : null,
    [gitlabDialogItem, primaryRepo, selectedRepos]
  )
  const gitlabDialogSourceContext = useMemo(() => {
    if (!gitlabDialogItem) {
      return null
    }
    if (
      pageData.openGitLabSourceContext?.provider === 'gitlab' &&
      pageData.openGitLabWorkItem?.id === gitlabDialogItem.id &&
      pageData.openGitLabWorkItem.repoId === gitlabDialogItem.repoId
    ) {
      return pageData.openGitLabSourceContext
    }
    return getTaskPageRepoSourceContext(gitlabDialogRepo, 'gitlab', gitlabDialogItem.projectRef)
  }, [
    gitlabDialogItem,
    gitlabDialogRepo,
    pageData.openGitLabSourceContext,
    pageData.openGitLabWorkItem
  ])

  const setDialogWorkItem = useCallback(
    (item: GitHubWorkItem | null, initialTab: ItemDialogTab = 'conversation') => {
      setDialogInitialTab(item ? initialTab : 'conversation')
      setGithubTaskDrawerWorkItem(item)
    },
    [setGithubTaskDrawerWorkItem]
  )

  useEffect(() => {
    if (!pageData.openGitHubWorkItem) {
      setDialogWorkItem(null)
      return
    }
    setGithubMode('items')
    setDialogWorkItem(pageData.openGitHubWorkItem, pageData.openGitHubInitialTab)
  }, [pageData.openGitHubInitialTab, pageData.openGitHubWorkItem, setDialogWorkItem])

  useEffect(() => {
    setGitlabDialogItem(pageData.openGitLabWorkItem ?? null)
  }, [pageData.openGitLabWorkItem])

  const openGitHubDetailPage = useCallback(
    (item: GitHubWorkItem, initialTab: ItemDialogTab = 'conversation') => {
      openTaskPage(
        {
          taskSource: 'github',
          preselectedRepoId: item.repoId,
          openGitHubWorkItem: item,
          openGitHubSourceContext: getTaskPageRepoSourceContext(repoMap.get(item.repoId), 'github'),
          openGitHubInitialTab: initialTab
        },
        { recordTasksInteraction: false }
      )
    },
    [openTaskPage, repoMap]
  )

  const openGitLabDetailPage = useCallback(
    (item: GitLabWorkItem) => {
      openTaskPage(
        {
          taskSource: 'gitlab',
          preselectedRepoId: item.repoId,
          openGitLabWorkItem: item,
          openGitLabSourceContext: getTaskPageRepoSourceContext(
            repoMap.get(item.repoId),
            'gitlab',
            item.projectRef
          )
        },
        { recordTasksInteraction: false }
      )
    },
    [openTaskPage, repoMap]
  )

  const patchTaskPageWorkItemRows = useCallback(
    (
      itemKey: { id: string; repoId: string },
      patch: Partial<GitHubWorkItem>,
      shouldPatch?: (item: GitHubWorkItem) => boolean
    ): void => {
      setPages((current) => {
        let changed = false
        const nextPages = current.map((page) => {
          if (!page) {
            return page
          }
          let pageChanged = false
          const nextPage = page.map((item) => {
            if (item.id !== itemKey.id || item.repoId !== itemKey.repoId) {
              return item
            }
            if (shouldPatch && !shouldPatch(item)) {
              return item
            }
            pageChanged = true
            changed = true
            return { ...item, ...patch }
          })
          return pageChanged ? nextPage : page
        })
        return changed ? nextPages : current
      })
    },
    []
  )
  const handleDialogReviewRequestsChange = useCallback(
    (itemKey: { id: string; repoId: string }, reviewRequests: GitHubAssignableUser[]): void => {
      patchTaskPageWorkItemRows(itemKey, { reviewRequests })
    },
    [patchTaskPageWorkItemRows]
  )

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
  }, [githubMode, selectedWorkItemsCacheEntries, taskSource])

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
  const [newIssueOpen, setNewIssueOpen] = useState(false)
  const [newIssueTitle, setNewIssueTitle] = useState('')
  const [newIssueBody, setNewIssueBody] = useState('')
  const [newIssueLabels, setNewIssueLabels] = useState<string[]>([])
  const [newIssueAssignees, setNewIssueAssignees] = useState<GitHubAssignableUser[]>([])
  const [newIssueSubmitting, setNewIssueSubmitting] = useState(false)
  const [newIssueRepoId, setNewIssueRepoId] = useState<string | null>(null)
  // Why: session-only draft recovers an in-progress issue across dismissal/remount; read imperatively (not subscribed) so per-keystroke writes don't re-render all of TaskPage.
  const setNewIssueDraft = useAppStore((s) => s.setNewIssueDraft)
  const clearNewIssueDraft = useAppStore((s) => s.clearNewIssueDraft)

  // Why: fall back to the first selected repo if the chosen id drops from the selection mid-dialog, so submit always has a valid target.
  const newIssueTargetRepo = useMemo(
    () => selectedRepos.find((r) => r.id === newIssueRepoId) ?? selectedRepos[0] ?? null,
    [selectedRepos, newIssueRepoId]
  )
  const newIssueSourceContext = useMemo(
    () => getTaskPageRepoSourceContext(newIssueTargetRepo, 'github'),
    [newIssueTargetRepo]
  )
  const newIssueRuntimeTarget = useMemo(() => {
    if (!newIssueTargetRepo?.id) {
      return null
    }
    const repoOwnerSettings = getSettingsForRepoRuntimeOwner(
      { repos: [newIssueTargetRepo], settings },
      newIssueTargetRepo.id
    )
    const targetSettings =
      newIssueSourceContext?.provider === 'github'
        ? {
            ...repoOwnerSettings,
            ...getTaskSourceRuntimeSettings(newIssueSourceContext)
          }
        : repoOwnerSettings
    const target = getActiveRuntimeTarget(targetSettings)
    if (target.kind !== 'environment') {
      return null
    }
    return repos.some((repo) => repo.id === newIssueTargetRepo.id) ? target : null
  }, [newIssueSourceContext, newIssueTargetRepo, repos, settings])
  const newIssueRepoLabels = useRepoLabels(
    newIssueOpen ? (newIssueTargetRepo?.path ?? null) : null,
    newIssueOpen ? (newIssueTargetRepo?.id ?? null) : null,
    { runtimeEnvironmentId: newIssueOpen ? (newIssueRuntimeTarget?.environmentId ?? null) : null }
  )
  const newIssueRepoAssignees = useRepoAssignees(
    newIssueOpen ? (newIssueTargetRepo?.path ?? null) : null,
    newIssueOpen ? (newIssueTargetRepo?.id ?? null) : null,
    { runtimeEnvironmentId: newIssueOpen ? (newIssueRuntimeTarget?.environmentId ?? null) : null }
  )

  // Why: only handles the "chosen repo vanished" case; a reactive clear keyed on target id can't tell a restore from a user switch and would wipe the recovery draft.
  useEffect(() => {
    const reset = resolveVanishedNewIssueRepoReset(
      newIssueRepoId,
      selectedRepos.map((r) => r.id)
    )
    if (!reset) {
      return
    }
    setNewIssueLabels([])
    setNewIssueAssignees([])
    setNewIssueRepoId(reset.repoId)
  }, [newIssueRepoId, selectedRepos])

  // Why: content-gated mirror of live fields into the session draft while the modal is open, so dismissal doesn't lose input.
  useEffect(() => {
    if (!newIssueOpen) {
      return
    }
    if (
      isNewIssueDraftContentful({
        title: newIssueTitle,
        body: newIssueBody,
        labels: newIssueLabels,
        assignees: newIssueAssignees
      })
    ) {
      setNewIssueDraft({
        title: newIssueTitle,
        body: newIssueBody,
        labels: newIssueLabels,
        assignees: newIssueAssignees,
        repoId: newIssueRepoId
      })
    } else {
      clearNewIssueDraft()
    }
  }, [
    newIssueOpen,
    newIssueTitle,
    newIssueBody,
    newIssueLabels,
    newIssueAssignees,
    newIssueRepoId,
    setNewIssueDraft,
    clearNewIssueDraft
  ])

  const [selectedLinearIssueId, setSelectedLinearIssueId] = useState<string | null>(null)
  const [selectedLinearIssueFallback, setSelectedLinearIssueFallback] =
    useState<LinearIssue | null>(null)
  const [selectedLinearIssueCanFloat, setSelectedLinearIssueCanFloat] = useState(false)

  // Why: subscribe to just the Linear caches so list and inline detail reflect optimistic cell edits without a second cache.
  const linearCacheSnapshot = useAppStore(
    useShallow((s) => ({
      issueCache: s.linearIssueCache,
      searchCache: s.linearSearchCache,
      listCache: s.linearListCache
    }))
  )
  const cachedSelectedLinearIssue = findTaskPageLinearIssue(
    linearCacheSnapshot.issueCache,
    linearCacheSnapshot.searchCache,
    linearCacheSnapshot.listCache,
    selectedLinearIssueId
  )
  const selectedLinearIssue = selectedLinearIssueId
    ? (cachedSelectedLinearIssue ?? selectedLinearIssueFallback)
    : null
  const linearDetailSourceContext = useMemo(() => {
    if (
      selectedLinearIssue &&
      pageData.openLinearSourceContext?.provider === 'linear' &&
      pageData.openLinearIssue?.id === selectedLinearIssue.id
    ) {
      return pageData.openLinearSourceContext
    }
    return linearTaskSourceContext
  }, [
    linearTaskSourceContext,
    pageData.openLinearIssue,
    pageData.openLinearSourceContext,
    selectedLinearIssue
  ])

  const setSelectedLinearIssue = useCallback(
    (issue: LinearIssue | null, options?: { allowOutsideList?: boolean }) => {
      setSelectedLinearIssueCanFloat(Boolean(issue && options?.allowOutsideList))
      setSelectedLinearIssueId(issue?.id ?? null)
      setSelectedLinearIssueFallback(issue)
    },
    []
  )

  const clearSelectedLinearIssue = useCallback(() => {
    setSelectedLinearIssueCanFloat(false)
    setSelectedLinearIssueId(null)
    setSelectedLinearIssueFallback(null)
  }, [])

  useEffect(() => {
    if (!pageData.openLinearIssue) {
      clearSelectedLinearIssue()
      return
    }
    setSelectedLinearIssue(pageData.openLinearIssue, { allowOutsideList: true })
  }, [clearSelectedLinearIssue, pageData.openLinearIssue, setSelectedLinearIssue])

  const openLinearDetailPage = useCallback(
    (issue: LinearIssue) => {
      openTaskPage(
        {
          taskSource: 'linear',
          openLinearIssue: issue,
          openLinearSourceContext: linearTaskSourceContext
        },
        { recordTasksInteraction: false }
      )
    },
    [linearTaskSourceContext, openTaskPage]
  )

  const openRelatedLinearIssue = useCallback(
    (issue: LinearIssue) => {
      openLinearDetailPage(issue)
    },
    [openLinearDetailPage]
  )

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

  const [selectedJiraIssueKey, setSelectedJiraIssueKey] = useState<string | null>(null)
  const [selectedJiraIssueFallback, setSelectedJiraIssueFallback] = useState<JiraIssue | null>(null)
  const jiraCacheSnapshot = useAppStore(
    useShallow((s) => ({
      issueCache: s.jiraIssueCache,
      searchCache: s.jiraSearchCache
    }))
  )
  const cachedSelectedJiraIssue = findTaskPageJiraIssue(
    jiraCacheSnapshot.issueCache,
    jiraCacheSnapshot.searchCache,
    selectedJiraIssueKey,
    {
      sourceContext: jiraTaskSourceContext,
      siteId: selectedJiraIssueFallback?.siteId ?? pageData.openJiraIssue?.siteId ?? null
    }
  )
  const selectedJiraIssue = selectedJiraIssueKey
    ? (cachedSelectedJiraIssue ?? selectedJiraIssueFallback)
    : null
  const jiraDetailSourceContext = useMemo(() => {
    if (
      selectedJiraIssue &&
      pageData.openJiraSourceContext?.provider === 'jira' &&
      pageData.openJiraIssue?.key === selectedJiraIssue.key &&
      pageData.openJiraIssue.siteId === selectedJiraIssue.siteId
    ) {
      return pageData.openJiraSourceContext
    }
    return jiraTaskSourceContext
  }, [
    jiraTaskSourceContext,
    pageData.openJiraIssue,
    pageData.openJiraSourceContext,
    selectedJiraIssue
  ])

  const setSelectedJiraIssue = useCallback((issue: JiraIssue | null) => {
    setSelectedJiraIssueKey(issue?.key ?? null)
    setSelectedJiraIssueFallback(issue)
  }, [])

  useEffect(() => {
    setSelectedJiraIssue(pageData.openJiraIssue ?? null)
  }, [pageData.openJiraIssue, setSelectedJiraIssue])

  const openJiraDetailPage = useCallback(
    (issue: JiraIssue) => {
      openTaskPage(
        {
          taskSource: 'jira',
          openJiraIssue: issue,
          openJiraSourceContext: jiraTaskSourceContext
        },
        { recordTasksInteraction: false }
      )
    },
    [jiraTaskSourceContext, openTaskPage]
  )

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

  useEffect(() => {
    const context = taskResumeState?.linearContext
    if (
      linearContextResumeAttemptedRef.current ||
      !taskResumeApplied ||
      taskSource !== 'linear' ||
      !linearConnected ||
      !context
    ) {
      return
    }
    linearContextResumeAttemptedRef.current = true
    let cancelled = false

    if (context.kind === 'project') {
      void fetchLinearProject(context.id, context.workspaceId, {
        force: true,
        sourceContext: linearTaskSourceContext
      })
        .then((project) => {
          if (cancelled) {
            return
          }
          if (!project) {
            setSelectedLinearProject(null)
            setSelectedLinearProjectDetail(null)
            setLinearProjectParentView(null)
            setLinearProjectsError('Saved Linear project was not found.')
            setTaskResumeState({ linearContext: undefined })
            return
          }
          setSelectedLinearProject(project)
          setSelectedLinearProjectDetail(project)
          setLinearMode('projects')
        })
        .catch(() => {
          if (!cancelled) {
            setSelectedLinearProject(null)
            setSelectedLinearProjectDetail(null)
            setLinearProjectParentView(null)
            setLinearProjectsError('Failed to restore saved Linear project.')
            setTaskResumeState({ linearContext: undefined })
          }
        })
      return () => {
        cancelled = true
      }
    }

    if (context.kind === 'view' && context.model) {
      setLinearMode('views')
      setLinearCustomViewsLoading(true)
      setLinearCustomViewsError(null)
      void fetchLinearCustomView(context.id, context.workspaceId, context.model, {
        force: true,
        sourceContext: linearTaskSourceContext
      })
        .then((restoredView) => {
          if (cancelled) {
            return
          }
          setLinearCustomViewsLoading(false)
          if (!restoredView) {
            setSelectedLinearCustomView(null)
            setLinearCustomViewsError('Saved Linear view was not found.')
            setTaskResumeState({ linearContext: undefined })
            return
          }
          setSelectedLinearCustomView(restoredView)
        })
        .catch(() => {
          if (!cancelled) {
            setSelectedLinearCustomView(null)
            setLinearCustomViewsLoading(false)
            setLinearCustomViewsError('Failed to restore saved Linear view.')
            setTaskResumeState({ linearContext: undefined })
          }
        })
      return () => {
        cancelled = true
      }
    }
    return undefined
  }, [
    fetchLinearCustomView,
    fetchLinearProject,
    listLinearCustomViews,
    linearConnected,
    linearTaskSourceContext,
    setTaskResumeState,
    taskResumeApplied,
    taskResumeState?.linearContext,
    taskSource
  ])

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
  // New Linear project dialog state
  const [newLinearProjectOpen, setNewLinearProjectOpen] = useState(false)
  const [newLinearProjectName, setNewLinearProjectName] = useState('')
  const [newLinearProjectDescription, setNewLinearProjectDescription] = useState('')
  const [newLinearProjectContent, setNewLinearProjectContent] = useState('')
  const [newLinearProjectTeamId, setNewLinearProjectTeamId] = useState<string | null>(null)
  const [newLinearProjectLeadId, setNewLinearProjectLeadId] = useState<string | null>(null)
  const [newLinearProjectMemberIds, setNewLinearProjectMemberIds] = useState<string[]>([])
  const [newLinearProjectLabelIds, setNewLinearProjectLabelIds] = useState<string[]>([])
  const [newLinearProjectPriority, setNewLinearProjectPriority] = useState<number>(0)
  const [newLinearProjectStartDate, setNewLinearProjectStartDate] = useState('')
  const [newLinearProjectTargetDate, setNewLinearProjectTargetDate] = useState('')
  const [newLinearProjectSubmitting, setNewLinearProjectSubmitting] = useState(false)

  const newLinearProjectTargetTeam = useMemo(
    () => availableTeams.find((t) => t.id === newLinearProjectTeamId) ?? availableTeams[0] ?? null,
    [availableTeams, newLinearProjectTeamId]
  )
  const newLinearProjectMembers = useTeamMembers(
    newLinearProjectOpen ? (newLinearProjectTargetTeam?.id ?? null) : null,
    settings,
    newLinearProjectTargetTeam?.workspaceId
  )
  const newLinearProjectLabels = useTeamLabels(
    newLinearProjectOpen ? (newLinearProjectTargetTeam?.id ?? null) : null,
    settings,
    newLinearProjectTargetTeam?.workspaceId
  )

  useEffect(() => {
    setNewLinearProjectLeadId(null)
    setNewLinearProjectMemberIds([])
    setNewLinearProjectLabelIds([])
  }, [newLinearProjectTargetTeam?.id, newLinearProjectTargetTeam?.workspaceId])

  // New Linear issue dialog state
  const [newLinearIssueOpen, setNewLinearIssueOpen] = useState(false)
  const [newLinearIssueTitle, setNewLinearIssueTitle] = useState('')
  const [newLinearIssueBody, setNewLinearIssueBody] = useState('')
  const [newLinearIssueTeamId, setNewLinearIssueTeamId] = useState<string | null>(null)
  const [newLinearIssueSubmitting, setNewLinearIssueSubmitting] = useState(false)

  const [newLinearIssueStateId, setNewLinearIssueStateId] = useState<string | null>(null)
  const [newLinearIssueAssigneeId, setNewLinearIssueAssigneeId] = useState<string | null>(null)
  const [newLinearIssuePriority, setNewLinearIssuePriority] = useState<number>(0)
  const [newLinearIssueProjectId, setNewLinearIssueProjectId] = useState<string | null>(null)
  const [newLinearIssueLabelIds, setNewLinearIssueLabelIds] = useState<string[]>([])

  const newLinearIssueTargetTeam = useMemo(
    () => availableTeams.find((t) => t.id === newLinearIssueTeamId) ?? availableTeams[0] ?? null,
    [availableTeams, newLinearIssueTeamId]
  )

  const [newLinearIssueProjects, setNewLinearIssueProjects] = useState<LinearProjectSummary[]>([])
  const [newLinearIssueProjectsLoading, setNewLinearIssueProjectsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    if (!newLinearIssueOpen || !linearConnected || !newLinearIssueTargetTeam) {
      setNewLinearIssueProjects([])
      setNewLinearIssueProjectsLoading(false)
      return
    }
    setNewLinearIssueProjectsLoading(true)
    const targetWorkspaceId =
      newLinearIssueTargetTeam.workspaceId ||
      (selectedLinearWorkspaceId !== 'all' ? selectedLinearWorkspaceId : null)
    linearListProjects(linearTaskSourceContext ?? settings, undefined, 100, targetWorkspaceId)
      .then((p) => {
        if (!cancelled) {
          setNewLinearIssueProjects(p.items)
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) {
          setNewLinearIssueProjectsLoading(false)
        }
      })
    return () => {
      // Why: project lists are workspace-scoped; stale responses must not populate the composer after a team/workspace switch.
      cancelled = true
    }
  }, [
    linearConnected,
    newLinearIssueOpen,
    newLinearIssueTargetTeam,
    linearTaskSourceContext,
    settings,
    selectedLinearWorkspaceId
  ])

  useEffect(() => {
    // Why: the selected team can change indirectly when the Linear teams/workspace list refreshes, even if the picker value didn't.
    setNewLinearIssueStateId(null)
    setNewLinearIssueAssigneeId(null)
    setNewLinearIssuePriority(0)
    if (
      selectedLinearProject &&
      selectedLinearProject.workspaceId === newLinearIssueTargetTeam?.workspaceId
    ) {
      setNewLinearIssueProjectId(selectedLinearProject.id)
    } else {
      setNewLinearIssueProjectId(null)
    }
    setNewLinearIssueLabelIds([])
  }, [newLinearIssueTargetTeam?.id, newLinearIssueTargetTeam?.workspaceId, selectedLinearProject])

  const newLinearStates = useTeamStates(
    linearConnected ? newLinearIssueTargetTeam?.id || null : null,
    settings,
    newLinearIssueTargetTeam?.workspaceId
  )
  const newLinearMembers = useTeamMembers(
    linearConnected ? newLinearIssueTargetTeam?.id || null : null,
    settings,
    newLinearIssueTargetTeam?.workspaceId
  )
  const newLinearLabels = useTeamLabels(
    linearConnected ? newLinearIssueTargetTeam?.id || null : null,
    settings,
    newLinearIssueTargetTeam?.workspaceId
  )

  useEffect(() => {
    if (newLinearStates.data.length > 0 && !newLinearIssueStateId) {
      const defaultState =
        newLinearStates.data.find((s) => s.type === 'unstarted') || newLinearStates.data[0]
      if (defaultState) {
        setNewLinearIssueStateId(defaultState.id)
      }
    }
  }, [newLinearStates.data, newLinearIssueStateId])

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

  const [newJiraIssueOpen, setNewJiraIssueOpen] = useState(false)
  const [newJiraIssueTitle, setNewJiraIssueTitle] = useState('')
  const [newJiraIssueBody, setNewJiraIssueBody] = useState('')
  const [newJiraIssueProjectId, setNewJiraIssueProjectId] = useState<string | null>(null)
  const [newJiraIssueProjectComboboxOpen, setNewJiraIssueProjectComboboxOpen] = useState(false)
  const [newJiraIssueProjectQuery, setNewJiraIssueProjectQuery] = useState('')
  const [newJiraIssueProjectCommandValue, setNewJiraIssueProjectCommandValue] = useState('')
  const [newJiraIssueTypeId, setNewJiraIssueTypeId] = useState<string | null>(null)
  const [newJiraIssueSubmitting, setNewJiraIssueSubmitting] = useState(false)
  const newJiraIssueProjectSearchInputRef = useRef<HTMLInputElement | null>(null)
  const [availableJiraIssueTypes, setAvailableJiraIssueTypes] = useState<JiraIssueType[]>([])
  const [jiraIssueTypesLoading, setJiraIssueTypesLoading] = useState(false)
  const [jiraCreateFields, setJiraCreateFields] = useState<JiraCreateField[]>([])
  const [jiraCreateFieldsLoading, setJiraCreateFieldsLoading] = useState(false)
  const [jiraCreateFieldsError, setJiraCreateFieldsError] = useState<string | null>(null)
  const [newJiraIssueCustomFieldValues, setNewJiraIssueCustomFieldValues] = useState<
    Record<string, string>
  >({})
  const includeJiraSiteNameInProjectLabel = selectedJiraSiteId === 'all'
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
      setNewJiraIssueOpen(false)
      setNewJiraIssueTitle('')
      setNewJiraIssueBody('')
      setNewJiraIssueProjectId(null)
      setNewJiraIssueProjectComboboxOpen(false)
      setNewJiraIssueProjectQuery('')
      setNewJiraIssueProjectCommandValue('')
      setNewJiraIssueTypeId(null)
      setAvailableJiraIssueTypes([])
      setJiraIssueTypesLoading(false)
      setJiraCreateFields([])
      setJiraCreateFieldsLoading(false)
      setJiraCreateFieldsError(null)
      setNewJiraIssueCustomFieldValues({})
      setNewJiraIssueSubmitting(false)
    }
  }, [newJiraIssueOpen, newLinearIssueOpen, providerRuntimeContextKey])

  const sortedAvailableJiraProjects = useMemo(
    () =>
      [...availableJiraProjects].sort((a, b) =>
        compareJiraProjectsByDisplayLabel(a, b, includeJiraSiteNameInProjectLabel)
      ),
    [availableJiraProjects, includeJiraSiteNameInProjectLabel]
  )

  const filteredNewJiraIssueProjects = useMemo(() => {
    return filterJiraProjectPickerProjects({
      projects: sortedAvailableJiraProjects,
      query: newJiraIssueProjectQuery,
      includeSiteName: includeJiraSiteNameInProjectLabel
    })
  }, [includeJiraSiteNameInProjectLabel, newJiraIssueProjectQuery, sortedAvailableJiraProjects])

  const newJiraIssueTargetProject = useMemo(
    () =>
      sortedAvailableJiraProjects.find(
        (project) => getJiraProjectSelectionKey(project) === newJiraIssueProjectId
      ) ??
      sortedAvailableJiraProjects[0] ??
      null,
    [newJiraIssueProjectId, sortedAvailableJiraProjects]
  )

  const newJiraIssueTargetProjectSelectionKey = newJiraIssueTargetProject
    ? getJiraProjectSelectionKey(newJiraIssueTargetProject)
    : ''

  const newJiraIssueTargetType = useMemo(
    () =>
      availableJiraIssueTypes.find((issueType) => issueType.id === newJiraIssueTypeId) ??
      availableJiraIssueTypes[0] ??
      null,
    [availableJiraIssueTypes, newJiraIssueTypeId]
  )

  const visibleJiraCreateFields = useMemo(
    () => jiraCreateFields.filter(isVisibleJiraCreateField),
    [jiraCreateFields]
  )

  const hasMissingJiraCreateField = useMemo(
    () =>
      visibleJiraCreateFields.some(
        (field) => !(newJiraIssueCustomFieldValues[field.key] ?? '').trim()
      ),
    [newJiraIssueCustomFieldValues, visibleJiraCreateFields]
  )

  useEffect(() => {
    if (!newJiraIssueProjectComboboxOpen) {
      return
    }
    const frame = requestAnimationFrame(() => {
      const input = newJiraIssueProjectSearchInputRef.current
      if (!input) {
        return
      }
      input.focus()
      const end = input.value.length
      input.setSelectionRange(end, end)
    })
    return () => cancelAnimationFrame(frame)
  }, [newJiraIssueProjectComboboxOpen])

  const handleNewJiraIssueProjectComboboxOpenChange = useCallback(
    (open: boolean) => {
      setNewJiraIssueProjectComboboxOpen(open)
      if (open) {
        setNewJiraIssueProjectCommandValue(newJiraIssueTargetProjectSelectionKey)
        return
      }
      setNewJiraIssueProjectQuery('')
    },
    [newJiraIssueTargetProjectSelectionKey]
  )

  const handleNewJiraIssueProjectSelect = useCallback((selectionKey: string) => {
    setNewJiraIssueProjectId(selectionKey)
    setNewJiraIssueTypeId(null)
    setNewJiraIssueProjectCommandValue(selectionKey)
    setNewJiraIssueProjectComboboxOpen(false)
    setNewJiraIssueProjectQuery('')
  }, [])

  const handleNewJiraIssueProjectTriggerKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (newJiraIssueProjectComboboxOpen) {
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        setNewJiraIssueProjectCommandValue(newJiraIssueTargetProjectSelectionKey)
        setNewJiraIssueProjectComboboxOpen(true)
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }
      if (event.key.length === 1 && /\S/.test(event.key)) {
        event.preventDefault()
        setNewJiraIssueProjectCommandValue(newJiraIssueTargetProjectSelectionKey)
        setNewJiraIssueProjectQuery(event.key)
        setNewJiraIssueProjectComboboxOpen(true)
      }
    },
    [newJiraIssueProjectComboboxOpen, newJiraIssueTargetProjectSelectionKey]
  )

  useEffect(() => {
    if (!newJiraIssueOpen || !jiraConnected || !newJiraIssueTargetProject) {
      setAvailableJiraIssueTypes([])
      setJiraIssueTypesLoading(false)
      return
    }
    let cancelled = false
    setAvailableJiraIssueTypes([])
    setJiraIssueTypesLoading(true)
    void jiraListIssueTypes(
      jiraTaskSourceContext ?? settings,
      newJiraIssueTargetProject.id,
      newJiraIssueTargetProject.siteId
    )
      .then((issueTypes) => {
        if (cancelled) {
          return
        }
        setAvailableJiraIssueTypes(issueTypes)
        setNewJiraIssueTypeId(issueTypes[0]?.id ?? null)
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(
            translate('auto.components.TaskPage.af2a8371de', 'Failed to load Jira issue types.')
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setJiraIssueTypesLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [settings, jiraConnected, newJiraIssueOpen, newJiraIssueTargetProject, jiraTaskSourceContext])

  useEffect(() => {
    if (
      !newJiraIssueOpen ||
      !jiraConnected ||
      !newJiraIssueTargetProject ||
      !newJiraIssueTargetType
    ) {
      setJiraCreateFields([])
      setJiraCreateFieldsLoading(false)
      setJiraCreateFieldsError(null)
      setNewJiraIssueCustomFieldValues({})
      return
    }
    let cancelled = false
    setJiraCreateFields([])
    setJiraCreateFieldsLoading(true)
    setJiraCreateFieldsError(null)
    setNewJiraIssueCustomFieldValues({})
    void jiraListCreateFields(
      jiraTaskSourceContext ?? settings,
      newJiraIssueTargetProject.id,
      newJiraIssueTargetType.id,
      newJiraIssueTargetProject.siteId
    )
      .then((fields) => {
        if (!cancelled) {
          setJiraCreateFields(fields)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setJiraCreateFieldsError('Failed to load required Jira fields.')
        }
      })
      .finally(() => {
        if (!cancelled) {
          setJiraCreateFieldsLoading(false)
        }
      })
    return () => {
      // Why: create fields are scoped to project + issue type; ignore late responses after switching either selector.
      cancelled = true
    }
  }, [
    settings,
    jiraConnected,
    newJiraIssueOpen,
    newJiraIssueTargetProject,
    newJiraIssueTargetType,
    jiraTaskSourceContext
  ])

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

  const handleCreateNewIssue = useCallback(async (): Promise<void> => {
    if (!newIssueTargetRepo) {
      return
    }
    const title = newIssueTitle.trim()
    if (!title || newIssueSubmitting) {
      return
    }
    setNewIssueSubmitting(true)
    try {
      const result = newIssueRuntimeTarget
        ? await callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.createIssue>>>(
            newIssueRuntimeTarget,
            'github.createIssue',
            {
              repo:
                newIssueSourceContext?.provider === 'github'
                  ? (newIssueSourceContext.repoId ?? newIssueTargetRepo.id)
                  : newIssueTargetRepo.id,
              title,
              body: newIssueBody,
              labels: newIssueLabels,
              assignees: newIssueAssignees.map((assignee) => assignee.login)
            },
            // Why: oversized-body recovery can need two 30s writes after GitHub rejects the initial create.
            { timeoutMs: 65_000 }
          )
        : await window.api.gh.createIssue({
            repoPath: newIssueTargetRepo.path,
            repoId: newIssueTargetRepo.id,
            sourceContext: newIssueSourceContext,
            title,
            body: newIssueBody,
            labels: newIssueLabels,
            assignees: newIssueAssignees.map((assignee) => assignee.login)
          })
      if (!result.ok) {
        toast.error(
          result.error ||
            translate('auto.components.TaskPage.7437e340b4', 'Failed to create issue.')
        )
        return
      }
      const createdIssueToast = translate(
        'auto.components.TaskPage.3f9604efc7',
        'Opened issue #{{value0}}',
        { value0: result.number }
      )
      const createdIssueToastOptions = {
        action: result.url
          ? {
              label: translate('auto.components.TaskPage.9c57663908', 'View'),
              onClick: () => window.open(result.url, '_blank')
            }
          : undefined
      }
      if (result.bodySaveWarning) {
        toast.warning(createdIssueToast, {
          ...createdIssueToastOptions,
          description: result.bodySaveWarning
        })
      } else {
        toast.success(createdIssueToast, createdIssueToastOptions)
      }
      setNewIssueOpen(false)
      if (result.bodySaveWarning) {
        // Why: keep the unsaved body for recovery but clear the title so reopening can't one-click repeat the create.
        setNewIssueTitle('')
        setNewIssueDraft({ title: '' })
      } else {
        setNewIssueTitle('')
        setNewIssueBody('')
        setNewIssueLabels([])
        setNewIssueAssignees([])
        // Why: only a complete success discards the recovery draft; a partial body save keeps the text for recovery.
        clearNewIssueDraft()
      }
      // Why: bump the nonce so the list refetches and shows the new issue.
      setTaskRefreshNonce((current) => current + 1)

      // Why: auto-open the new issue with an optimistic stub for immediate content, then refine with the full workItem fetch.
      const stub: GitHubWorkItem = {
        id: `issue:${String(result.number)}`,
        repoId: newIssueTargetRepo.id,
        type: 'issue',
        number: result.number,
        title,
        state: 'open',
        url: result.url,
        labels: newIssueLabels,
        assignees: newIssueAssignees,
        updatedAt: new Date().toISOString(),
        author: null
      }
      openGitHubDetailPage(stub)
      const stubRepoId = newIssueTargetRepo.id
      const fullIssuePromise = newIssueRuntimeTarget
        ? callRuntimeRpc<Awaited<ReturnType<typeof window.api.gh.workItem>>>(
            newIssueRuntimeTarget,
            'github.workItem',
            {
              repo:
                newIssueSourceContext?.provider === 'github'
                  ? (newIssueSourceContext.repoId ?? newIssueTargetRepo.id)
                  : newIssueTargetRepo.id,
              number: result.number,
              type: 'issue'
            },
            { timeoutMs: 30_000 }
          )
        : window.api.gh.workItem({
            repoPath: newIssueTargetRepo.path,
            repoId: newIssueTargetRepo.id,
            sourceContext: newIssueSourceContext,
            number: result.number,
            type: 'issue'
          })
      void fullIssuePromise
        .then((full) => {
          if (full) {
            // Why: cast through unknown — spreading the discriminated union loses the discriminant, so { ...full, repoId } won't typecheck.
            const withRepoId = { ...full, repoId: stubRepoId } as unknown as GitHubWorkItem
            setDialogWorkItem(withRepoId)
          }
        })
        .catch(() => {})
    } finally {
      setNewIssueSubmitting(false)
    }
  }, [
    newIssueBody,
    newIssueAssignees,
    newIssueLabels,
    newIssueRuntimeTarget,
    newIssueSourceContext,
    newIssueSubmitting,
    newIssueTargetRepo,
    newIssueTitle,
    openGitHubDetailPage,
    setDialogWorkItem,
    clearNewIssueDraft,
    setNewIssueDraft
  ])

  const handleCreateNewLinearProject = useCallback(async (): Promise<void> => {
    if (!newLinearProjectTargetTeam) {
      return
    }
    const name = newLinearProjectName.trim()
    if (!name || newLinearProjectSubmitting) {
      return
    }
    setNewLinearProjectSubmitting(true)
    try {
      const result = await linearCreateProject(linearTaskSourceContext ?? settings, {
        name,
        description: newLinearProjectDescription.trim() || undefined,
        content: newLinearProjectContent.trim() || undefined,
        teamIds: [newLinearProjectTargetTeam.id],
        workspaceId: newLinearProjectTargetTeam.workspaceId,
        leadId: newLinearProjectLeadId || undefined,
        memberIds: newLinearProjectMemberIds.length > 0 ? newLinearProjectMemberIds : undefined,
        labelIds: newLinearProjectLabelIds.length > 0 ? newLinearProjectLabelIds : undefined,
        priority: newLinearProjectPriority,
        startDate: newLinearProjectStartDate || undefined,
        targetDate: newLinearProjectTargetDate || undefined
      })
      if (!result.ok) {
        toast.error(
          result.error ||
            translate('auto.components.TaskPage.3ca9b424a3', 'Failed to create project.')
        )
        return
      }
      toast.success(
        translate('auto.components.TaskPage.cb98f0350c', 'Created {{value0}}', {
          value0: result.project.name
        }),
        {
          action: result.project.url
            ? {
                label: translate('auto.components.TaskPage.9c57663908', 'View'),
                onClick: () => window.open(result.project.url, '_blank')
              }
            : undefined
        }
      )
      setNewLinearProjectOpen(false)
      setNewLinearProjectName('')
      setNewLinearProjectDescription('')
      setNewLinearProjectContent('')
      setNewLinearProjectLeadId(null)
      setNewLinearProjectMemberIds([])
      setNewLinearProjectLabelIds([])
      setNewLinearProjectPriority(0)
      setNewLinearProjectStartDate('')
      setNewLinearProjectTargetDate('')
      setAppliedLinearProjectSearch('')
      setLinearProjectSearchInput('')
      setLinearProjectsResult((current) => ({
        ...current,
        items: [result.project, ...current.items.filter((item) => item.id !== result.project.id)]
      }))
      setSelectedLinearProjectDetail(result.project)
      openLinearProjectContext(result.project)
      setLinearRefreshNonce((n) => n + 1)
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : translate('auto.components.TaskPage.3ca9b424a3', 'Failed to create project.')
      )
    } finally {
      setNewLinearProjectSubmitting(false)
    }
  }, [
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
    linearTaskSourceContext,
    settings
  ])

  const handleCreateNewLinearIssue = useCallback(async (): Promise<void> => {
    if (!newLinearIssueTargetTeam) {
      return
    }
    const title = newLinearIssueTitle.trim()
    if (!title || newLinearIssueSubmitting) {
      return
    }
    if (
      selectedLinearProject &&
      newLinearIssueProjectId === selectedLinearProject.id &&
      newLinearIssueTargetTeam.workspaceId !== selectedLinearProject.workspaceId
    ) {
      toast.error(
        translate(
          'auto.components.TaskPage.1e1b2ad8f2',
          'Select a team from the project workspace before filing this issue.'
        )
      )
      return
    }
    setNewLinearIssueSubmitting(true)
    const submitProviderRuntimeContextKey = providerRuntimeContextKey
    try {
      const result = await linearCreateIssue(linearTaskSourceContext ?? settings, {
        teamId: newLinearIssueTargetTeam.id,
        title,
        description: newLinearIssueBody || undefined,
        workspaceId: newLinearIssueTargetTeam.workspaceId,
        stateId: newLinearIssueStateId || undefined,
        priority: newLinearIssuePriority,
        assigneeId: newLinearIssueAssigneeId || undefined,
        projectId: newLinearIssueProjectId || null,
        labelIds: newLinearIssueLabelIds.length > 0 ? newLinearIssueLabelIds : undefined
      })
      if (submitProviderRuntimeContextKey !== providerRuntimeContextKeyRef.current) {
        return
      }
      if (!result.ok) {
        toast.error(
          result.error ||
            translate('auto.components.TaskPage.7437e340b4', 'Failed to create issue.')
        )
        return
      }
      toast.success(
        translate('auto.components.TaskPage.cb98f0350c', 'Created {{value0}}', {
          value0: result.identifier
        }),
        {
          action: result.url
            ? {
                label: translate('auto.components.TaskPage.9c57663908', 'View'),
                onClick: () => window.open(result.url, '_blank')
              }
            : undefined
        }
      )
      setNewLinearIssueOpen(false)
      setNewLinearIssueTitle('')
      setNewLinearIssueBody('')
      setNewLinearIssueStateId(null)
      setNewLinearIssueAssigneeId(null)
      setNewLinearIssuePriority(0)
      setNewLinearIssueProjectId(null)
      setNewLinearIssueLabelIds([])
      setLinearRefreshNonce((n) => n + 1)
      useAppStore.getState().recordFeatureInteraction('linear-tasks')

      // Why: auto-select the new issue so the user sees exactly what was filed (mirrors the GitHub create-issue flow).
      void linearGetIssue(
        linearTaskSourceContext ?? settings,
        result.id,
        newLinearIssueTargetTeam.workspaceId
      )
        .then((full) => {
          if (submitProviderRuntimeContextKey !== providerRuntimeContextKeyRef.current) {
            return
          }
          if (full) {
            setSelectedLinearIssue(full, { allowOutsideList: true })
          }
        })
        .catch(() => {})
    } finally {
      if (submitProviderRuntimeContextKey === providerRuntimeContextKeyRef.current) {
        setNewLinearIssueSubmitting(false)
      }
    }
  }, [
    newLinearIssueBody,
    newLinearIssueSubmitting,
    newLinearIssueTargetTeam,
    newLinearIssueTitle,
    newLinearIssueStateId,
    newLinearIssuePriority,
    newLinearIssueAssigneeId,
    newLinearIssueProjectId,
    newLinearIssueLabelIds,
    providerRuntimeContextKey,
    selectedLinearProject,
    setSelectedLinearIssue,
    linearTaskSourceContext,
    settings
  ])

  const handleCreateNewJiraIssue = useCallback(async (): Promise<void> => {
    if (!newJiraIssueTargetProject || !newJiraIssueTargetType) {
      return
    }
    const title = newJiraIssueTitle.trim()
    if (!title || newJiraIssueSubmitting || hasMissingJiraCreateField || jiraCreateFieldsLoading) {
      return
    }
    const customFields = buildJiraCreateCustomFields(
      visibleJiraCreateFields,
      newJiraIssueCustomFieldValues
    )
    setNewJiraIssueSubmitting(true)
    const submitProviderRuntimeContextKey = providerRuntimeContextKey
    try {
      const result = await jiraCreateIssue(jiraTaskSourceContext ?? settings, {
        siteId: newJiraIssueTargetProject.siteId,
        projectId: newJiraIssueTargetProject.id,
        issueTypeId: newJiraIssueTargetType.id,
        title,
        description: newJiraIssueBody || undefined,
        customFields
      })
      if (submitProviderRuntimeContextKey !== providerRuntimeContextKeyRef.current) {
        return
      }
      if (!result.ok) {
        toast.error(
          result.error ||
            translate('auto.components.TaskPage.aec5feeb69', 'Failed to create Jira issue.')
        )
        return
      }
      toast.success(
        translate('auto.components.TaskPage.cb98f0350c', 'Created {{value0}}', {
          value0: result.key
        }),
        {
          action: result.url
            ? {
                label: translate('auto.components.TaskPage.9c57663908', 'View'),
                onClick: () => window.open(result.url, '_blank')
              }
            : undefined
        }
      )
      setNewJiraIssueOpen(false)
      setNewJiraIssueTitle('')
      setNewJiraIssueBody('')
      setNewJiraIssueCustomFieldValues({})
      setJiraRefreshNonce((n) => n + 1)

      void jiraGetIssue(
        jiraTaskSourceContext ?? settings,
        result.key,
        newJiraIssueTargetProject.siteId
      )
        .then((full) => {
          if (submitProviderRuntimeContextKey !== providerRuntimeContextKeyRef.current) {
            return
          }
          if (full) {
            // Why: list cache may still be fresh after create; insert the new row locally before selecting so the inspector stays open.
            setJiraIssues((prev) => [full, ...prev.filter((issue) => issue.key !== full.key)])
            setSelectedJiraIssue(full)
          }
        })
        .catch(() => {})
    } finally {
      if (submitProviderRuntimeContextKey === providerRuntimeContextKeyRef.current) {
        setNewJiraIssueSubmitting(false)
      }
    }
  }, [
    hasMissingJiraCreateField,
    jiraCreateFieldsLoading,
    newJiraIssueBody,
    newJiraIssueCustomFieldValues,
    newJiraIssueSubmitting,
    newJiraIssueTargetProject,
    newJiraIssueTargetType,
    newJiraIssueTitle,
    providerRuntimeContextKey,
    jiraTaskSourceContext,
    settings,
    setSelectedJiraIssue,
    visibleJiraCreateFields
  ])

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

  useEffect(() => {
    if (!selectedLinearProject?.workspaceId) {
      setSelectedLinearProjectDetail(null)
      return
    }
    let cancelled = false
    setLinearProjectDetailLoading(true)
    setLinearProjectDetailError(null)
    void fetchLinearProject(selectedLinearProject.id, selectedLinearProject.workspaceId, {
      force: linearRefreshNonce > 0,
      sourceContext: linearTaskSourceContext
    })
      .then((project) => {
        if (!cancelled) {
          setSelectedLinearProjectDetail(project)
          setLinearProjectDetailLoading(false)
          if (!project) {
            setSelectedLinearProject(null)
            setLinearProjectParentView(null)
            setLinearProjectDetailError(null)
            setLinearProjectsError('Project was not found.')
            setTaskResumeState({ linearContext: undefined })
          }
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLinearProjectDetailError(
            error instanceof Error ? error.message : 'Failed to load project.'
          )
          setLinearProjectDetailLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    fetchLinearProject,
    linearRefreshNonce,
    selectedLinearProject,
    setTaskResumeState,
    linearTaskSourceContext
  ])

  useEffect(() => {
    if (!selectedLinearProject?.workspaceId || linearProjectTab !== 'issues') {
      return
    }
    let cancelled = false
    setLinearProjectIssuesLoading(true)
    setLinearProjectIssuesError(null)
    const effectiveLimit = clampLinearIssueListLimit(linearProjectIssueLimit)
    void listLinearProjectIssues(
      selectedLinearProject.id,
      selectedLinearProject.workspaceId,
      effectiveLimit,
      { force: linearRefreshNonce > 0, sourceContext: linearTaskSourceContext }
    )
      .then((result) => {
        if (!cancelled) {
          setLinearProjectIssuesResult(result)
          setLinearProjectIssuesLoading(false)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLinearProjectIssuesError(
            error instanceof Error ? error.message : 'Failed to load project issues.'
          )
          setLinearProjectIssuesLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    linearProjectIssueLimit,
    linearProjectTab,
    linearRefreshNonce,
    listLinearProjectIssues,
    linearTaskSourceContext,
    selectedLinearProject
  ])

  useEffect(() => {
    if (!taskResumeApplied || taskSource !== 'linear' || linearMode !== 'views') {
      return
    }
    if (!linearConnected || selectedLinearCustomView) {
      return
    }
    let cancelled = false
    const cachedResults = LINEAR_CUSTOM_VIEW_MODELS.map((model) =>
      getCachedLinearCustomViews(model, LINEAR_ITEM_LIMIT, undefined, {
        sourceContext: linearTaskSourceContext
      })
    )
    const allCached = cachedResults.every(
      (result): result is LinearCollectionResult<LinearCustomViewSummary> => result !== null
    )
    if (allCached) {
      setLinearCustomViewsResult(mergeLinearCollectionResults(cachedResults))
    }
    const force = linearRefreshNonce > 0
    setLinearCustomViewsLoading(force || !allCached)
    setLinearCustomViewsError(null)
    // Why: the Views tab already has a Model column, so list both models rather than add a redundant Issues/Projects switch.
    void Promise.all(
      LINEAR_CUSTOM_VIEW_MODELS.map((model) =>
        listLinearCustomViews(model, LINEAR_ITEM_LIMIT, undefined, {
          force,
          sourceContext: linearTaskSourceContext
        })
      )
    )
      .then((result) => {
        if (!cancelled) {
          setLinearCustomViewsResult(mergeLinearCollectionResults(result))
          setLinearCustomViewsLoading(false)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLinearCustomViewsError(
            error instanceof Error ? error.message : 'Failed to load views.'
          )
          setLinearCustomViewsLoading(false)
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
    selectedLinearCustomView,
    linearRefreshNonce,
    getCachedLinearCustomViews,
    listLinearCustomViews,
    linearTaskSourceContext
  ])

  useEffect(() => {
    if (!selectedLinearCustomView?.workspaceId) {
      setLinearCustomViewIssuesResult({ items: [] })
      setLinearCustomViewProjectsResult({ items: [] })
      return
    }
    let cancelled = false
    setLinearCustomViewContentsLoading(true)
    setLinearCustomViewContentsError(null)
    const issueLimit = clampLinearIssueListLimit(linearCustomViewIssueLimit)
    const request =
      selectedLinearCustomView.model === 'issue'
        ? listLinearCustomViewIssues(
            selectedLinearCustomView.id,
            selectedLinearCustomView.workspaceId,
            issueLimit,
            { force: linearRefreshNonce > 0, sourceContext: linearTaskSourceContext }
          )
        : listLinearCustomViewProjects(
            selectedLinearCustomView.id,
            selectedLinearCustomView.workspaceId,
            LINEAR_ITEM_LIMIT,
            { force: linearRefreshNonce > 0, sourceContext: linearTaskSourceContext }
          )
    void request
      .then((result) => {
        if (cancelled) {
          return
        }
        if (selectedLinearCustomView.model === 'issue') {
          setLinearCustomViewIssuesResult(result as LinearCollectionResult<LinearIssue>)
        } else {
          setLinearCustomViewProjectsResult(result as LinearCollectionResult<LinearProjectSummary>)
        }
        setLinearCustomViewContentsLoading(false)
      })
      .catch((error) => {
        if (!cancelled) {
          setLinearCustomViewContentsError(
            error instanceof Error ? error.message : 'Failed to load view contents.'
          )
          setLinearCustomViewContentsLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [
    linearRefreshNonce,
    linearCustomViewIssueLimit,
    listLinearCustomViewIssues,
    listLinearCustomViewProjects,
    linearTaskSourceContext,
    selectedLinearCustomView
  ])

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

  useEffect(() => {
    if (!taskResumeApplied) {
      return
    }
    if (taskSource !== 'jira') {
      return
    }
    if (!jiraConnected) {
      return
    }

    let cancelled = false
    setJiraLoading(true)
    setJiraError(null)
    setJiraErrorDetailsOpen(false)

    const trimmed = appliedJiraSearch.trim()
    const request =
      trimmed.length > 0
        ? searchJiraIssues(trimmed, JIRA_ITEM_LIMIT, { sourceContext: jiraTaskSourceContext })
        : listJiraIssues(activeJiraPreset, JIRA_ITEM_LIMIT, {
            sourceContext: jiraTaskSourceContext
          })

    void request
      .then((issues) => {
        if (cancelled) {
          return
        }
        setJiraIssues(issues)
        setJiraLoading(false)
        const projectScope = getSingleJiraProjectScope(issues)
        if (!projectScope) {
          return
        }
        const statusOrderScopeKey = getTaskPageJiraStatusOrderScopeKey(
          jiraTaskSourceScopeKey,
          projectScope
        )
        void loadTaskPageJiraProjectStatusOrder(
          jiraTaskSourceContext ?? settings,
          jiraTaskSourceScopeKey,
          projectScope
        ).then((order) => {
          if (!cancelled) {
            setJiraProjectStatusOrder({
              order,
              scopeKey: statusOrderScopeKey
            })
          }
        })
      })
      .catch((err) => {
        if (cancelled) {
          return
        }
        const failureState = createTaskPageJiraLoadFailureState(err)
        setJiraIssues(failureState.issues)
        setJiraError(failureState.error)
        setJiraLoading(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    taskSource,
    jiraConnected,
    selectedJiraSiteId,
    appliedJiraSearch,
    activeJiraPreset,
    jiraRefreshNonce,
    taskResumeApplied,
    jiraTaskSourceContext,
    jiraTaskSourceScopeKey
  ])

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
                  <div
                    className="flex min-w-0 flex-wrap items-center gap-2"
                    data-contextual-tour-target="tasks-source-filters"
                  >
                    {/* Why: Close is anchored left with the source icons for one compact band, clear of the app sidebar on the right. */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 rounded-full"
                          onClick={closeTaskPage}
                          aria-label={translate(
                            'auto.components.TaskPage.1a06219d5c',
                            'Close tasks'
                          )}
                        >
                          <X className="size-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={6}>
                        {translate('auto.components.TaskPage.4826fd1ad8', 'Close · Esc')}
                      </TooltipContent>
                    </Tooltip>
                    <div className="mx-1 h-5 w-px bg-border/50" aria-hidden />
                    {visibleSourceOptions.map((source) => {
                      const active = taskSource === source.id
                      const sourceAvailabilityNotice =
                        taskSourceAvailabilityNoticeByProvider[source.id] ?? null
                      const sourceDisabled = source.disabled || sourceAvailabilityNotice?.blocking
                      return (
                        <Tooltip key={source.id}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              disabled={sourceDisabled}
                              onClick={() => {
                                if (sourceAvailabilityNotice?.blocking) {
                                  return
                                }
                                taskSourceManuallyChangedRef.current = true
                                openTaskPage(
                                  { taskSource: source.id },
                                  { recordTasksInteraction: false }
                                )
                                void updateSettings({ defaultTaskSource: source.id }).catch(() => {
                                  toast.error(
                                    translate(
                                      'auto.components.TaskPage.609532fae7',
                                      'Failed to save default task source.'
                                    )
                                  )
                                })
                              }}
                              data-task-source={source.id}
                              aria-label={sourceAvailabilityNotice?.label ?? source.label}
                              aria-pressed={active}
                              className={cn(
                                'group flex h-8 w-8 items-center justify-center rounded-md border transition',
                                active
                                  ? 'border-foreground/40 bg-muted/70 text-foreground shadow-sm'
                                  : 'border-border/40 bg-transparent text-muted-foreground hover:bg-muted/40 hover:text-foreground',
                                sourceDisabled && 'cursor-not-allowed opacity-55'
                              )}
                            >
                              <source.Icon className="size-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>
                            {sourceAvailabilityNotice?.label ?? source.label}
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}
                    <div
                      className="hidden min-w-0 max-w-[min(420px,40vw)] items-center rounded-md border border-border/50 bg-muted/35 px-2 py-1 text-xs text-muted-foreground sm:flex"
                      title={taskSourceContextSummary.title}
                    >
                      <span className="truncate">{taskSourceContextSummary.label}</span>
                    </div>
                  </div>
                  {taskSource === 'linear' && linearConnected ? (
                    <div className="flex items-center gap-2">
                      <LinearScopeSelector
                        workspaces={linearWorkspaces}
                        selectedWorkspaceId={selectedLinearWorkspaceId}
                        teams={linearTeamOptions}
                        selectedTeamIds={linearTeamSelection}
                        teamSelectionIsStickyAll={defaultLinearTeamSelection == null}
                        onWorkspaceChange={handleLinearWorkspaceChange}
                        onTeamSelectionChange={handleLinearTeamSelectionChange}
                        onAddTeamAccess={() => setLinearConnectOpen(true)}
                        onOpen={handleLinearScopeOpen}
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            onClick={() => {
                              if (!selectedLinearTeamForExternalLink?.url) {
                                return
                              }
                              void window.api.shell.openUrl(selectedLinearTeamForExternalLink.url)
                            }}
                            disabled={!selectedLinearTeamForExternalLink}
                            aria-label={
                              selectedLinearTeamForExternalLink
                                ? translate(
                                    'auto.components.TaskPage.246bd64aed',
                                    'Open {{value0}} in Linear',
                                    { value0: selectedLinearTeamForExternalLink.name }
                                  )
                                : translate(
                                    'auto.components.TaskPage.8029e2bd4d',
                                    'Select one Linear team to open in Linear'
                                  )
                            }
                            className="h-8 w-8 rounded-md border-border/50 bg-muted/50 text-foreground shadow-sm transition hover:bg-muted/50"
                          >
                            <ExternalLink className="size-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" sideOffset={6}>
                          {selectedLinearTeamForExternalLink
                            ? translate(
                                'auto.components.TaskPage.246bd64aed',
                                'Open {{value0}} in Linear',
                                { value0: selectedLinearTeamForExternalLink.name }
                              )
                            : translate(
                                'auto.components.TaskPage.2af3ab5c58',
                                'Select one team to open in Linear'
                              )}
                        </TooltipContent>
                      </Tooltip>
                    </div>
                  ) : null}
                  {taskSource === 'jira' && jiraConnected ? (
                    <div className="flex items-center gap-2">
                      {jiraSites.length > 1 ? (
                        <Select
                          value={selectedJiraSiteId ?? undefined}
                          onValueChange={(value) => {
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
                        >
                          <SelectTrigger className="h-8 w-[220px] rounded-md border-border/50 bg-muted/50 text-xs font-medium shadow-sm">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">
                              {translate('auto.components.TaskPage.e592d99051', 'All Jira sites')}
                            </SelectItem>
                            {jiraSites.map((site) => (
                              <SelectItem key={site.id} value={site.id}>
                                {site.displayName}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                {taskSourceAvailabilityNotice ? (
                  <div
                    role="status"
                    className="flex max-w-3xl items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                    title={taskSourceAvailabilityNotice.title}
                  >
                    <AlertCircle className="size-3.5 flex-none" />
                    <span className="min-w-0 truncate">{taskSourceAvailabilityNotice.label}</span>
                  </div>
                ) : null}

                {taskSource === 'github' ? (
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {projectModeVisible ? (
                      <div className="flex items-center gap-1 text-xs">
                        {githubModeButtons.map((mode) => {
                          const active =
                            mode.id === 'project'
                              ? githubMode === 'project'
                              : githubMode === 'items' && activeGithubTaskKind === mode.id
                          return (
                            <button
                              key={mode.id}
                              type="button"
                              onClick={() => {
                                if (mode.id === 'project') {
                                  setGithubMode('project')
                                  setTaskResumeState({ githubMode: 'project' })
                                  return
                                }
                                setGithubMode('items')
                                setTaskResumeState({ githubMode: 'items' })
                                handleSelectGithubTaskKind(mode.id)
                              }}
                              className={cn(
                                'rounded-md border px-2 py-1 text-xs transition',
                                active
                                  ? 'border-border/50 bg-foreground/90 text-background'
                                  : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
                              )}
                            >
                              {mode.label}
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                    {/* Why: Project rows are repo-scoped, so the selection must stay visible in both GitHub modes. */}
                    <div className="min-w-0 max-w-[220px] shrink-0">
                      <TaskProjectSourceCombobox
                        groups={taskPickerGroups}
                        selected={repoSelection}
                        getRepoHostLabel={getTaskPickerRepoHostLabel}
                        onChange={(next) => {
                          const normalized = normalizeTaskRepoSelection(eligibleRepos, next)
                          setRepoSelection(normalized)
                          void updateSettings({ defaultRepoSelection: [...normalized] }).catch(
                            () => {
                              toast.error(
                                translate(
                                  'auto.components.TaskPage.dfd72673e7',
                                  'Failed to save project selection.'
                                )
                              )
                            }
                          )
                        }}
                        onSelectAll={() => {
                          const allIds = new Set(taskPickerRepos.map((r) => r.id))
                          setRepoSelection(allIds)
                          void updateSettings({ defaultRepoSelection: null }).catch(() => {
                            toast.error(
                              translate(
                                'auto.components.TaskPage.dfd72673e7',
                                'Failed to save project selection.'
                              )
                            )
                          })
                        }}
                        triggerClassName="h-8 w-auto max-w-[220px] rounded-md border border-border/50 bg-muted/50 px-2 text-xs font-medium shadow-sm transition hover:bg-muted/50 focus:ring-2 focus:ring-ring/20 focus:outline-none"
                      />
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          onClick={() => {
                            if (!selectedGitHubRepoExternalLink?.url) {
                              return
                            }
                            void window.api.shell.openUrl(selectedGitHubRepoExternalLink.url)
                          }}
                          aria-label={
                            selectedGitHubRepoExternalLink
                              ? translate(
                                  'auto.components.TaskPage.8d1e17a3ef',
                                  'Open {{value0}} in GitHub',
                                  { value0: selectedGitHubRepoExternalLink.label }
                                )
                              : translate(
                                  'auto.components.TaskPage.d1132848f8',
                                  'Select one GitHub project to open in GitHub'
                                )
                          }
                          className="h-8 w-8 rounded-md border-border/50 bg-muted/50 text-foreground shadow-sm transition hover:bg-muted/50"
                        >
                          <ExternalLink className="size-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" sideOffset={6}>
                        {selectedGitHubRepoExternalLink
                          ? translate(
                              'auto.components.TaskPage.8d1e17a3ef',
                              'Open {{value0}} in GitHub',
                              { value0: selectedGitHubRepoExternalLink.label }
                            )
                          : translate(
                              'auto.components.TaskPage.bc46d8204e',
                              'Select one project to open in GitHub'
                            )}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ) : null}

                {taskSource === 'github' && githubMode === 'items' ? (
                  <div
                    className="min-w-0 rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 pt-2 pb-0 shadow-sm"
                    data-contextual-tour-target="tasks-search-presets"
                  >
                    <div className="mb-2 flex flex-wrap gap-2">
                      {getGitHubTaskKindPresets(activeGithubTaskKind).map((option) => {
                        const active = activeTaskPreset === option.id
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => {
                              const query = option.query
                              setTaskSearchInput(query)
                              setAppliedTaskSearch(query)
                              setActiveTaskPreset(option.id)
                              setTaskResumeState({
                                githubItemsPreset: option.id,
                                githubItemsQuery: query
                              })
                              setTaskRefreshNonce((current) => current + 1)
                            }}
                            onContextMenu={(event) => {
                              event.preventDefault()
                              handleSetDefaultTaskPreset(option.id)
                            }}
                            className={cn(
                              'rounded-md border px-2 py-1 text-xs transition',
                              active
                                ? 'border-border/50 bg-foreground/90 text-background backdrop-blur-md'
                                : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
                            )}
                          >
                            {option.label}
                          </button>
                        )
                      })}
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <PRFilterDropdowns
                        parsed={appliedTaskQuery}
                        kind={activeGithubTaskKind}
                        authorLogins={loadedGitHubAuthorLogins}
                        primarySlug={primaryGithubFilterSlug}
                        settings={settings}
                        onChange={(change) => applyPRFilterChange(change)}
                      />
                      <div className="relative min-w-0 flex-1 basis-64">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          ref={taskSearchInputRef}
                          data-github-items-search-input
                          value={taskSearchInput}
                          onChange={handleTaskSearchChange}
                          onKeyDown={handleTaskSearchKeyDown}
                          placeholder={
                            activeGithubTaskKind === 'prs'
                              ? translate(
                                  'auto.components.TaskPage.eee4df4c66',
                                  'Search GitHub PRs...'
                                )
                              : translate(
                                  'auto.components.TaskPage.b15ceb409d',
                                  'Search GitHub issues...'
                                )
                          }
                          className="h-8 rounded-md border-border/50 bg-background pl-8 pr-8 text-xs"
                        />
                        {taskSearchInput || appliedTaskSearch ? (
                          <button
                            type="button"
                            aria-label={translate(
                              'auto.components.TaskPage.b797bdd7c3',
                              'Clear search'
                            )}
                            onClick={handleResetGithubTaskSearch}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                          >
                            <X className="size-4" />
                          </button>
                        ) : null}
                      </div>
                      <div
                        className="flex shrink-0 items-center gap-2"
                        data-contextual-tour-target="tasks-actions"
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => {
                                // Why: restore a non-empty draft (accidental dismissal recoverable); empty default guards a stale draft after a repo change.
                                const seed = resolveNewIssueOpenSeed({
                                  draft: useAppStore.getState().newIssueDraft,
                                  selectedRepoIds: selectedRepos.map((r) => r.id)
                                })
                                setNewIssueTitle(seed.title)
                                setNewIssueBody(seed.body)
                                setNewIssueLabels(seed.labels)
                                setNewIssueAssignees(seed.assignees)
                                setNewIssueRepoId(seed.repoId)
                                setNewIssueOpen(true)
                              }}
                              disabled={!newIssueTargetRepo}
                              aria-label={translate(
                                'auto.components.TaskPage.d3d0998b7d',
                                'New GitHub issue'
                              )}
                              className="size-8 border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
                            >
                              <Plus className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>
                            {translate('auto.components.TaskPage.d3d0998b7d', 'New GitHub issue')}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={handleRefreshGithubTasks}
                              disabled={githubTasksBusy}
                              aria-busy={githubTasksBusy}
                              aria-label={
                                githubTasksBusy
                                  ? translate(
                                      'auto.components.TaskPage.6ffa6be99f',
                                      'Refreshing GitHub work'
                                    )
                                  : translate(
                                      'auto.components.TaskPage.ff53631e6f',
                                      'Refresh GitHub work'
                                    )
                              }
                              className="size-8 cursor-pointer border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md disabled:pointer-events-auto disabled:cursor-wait supports-[backdrop-filter]:bg-transparent"
                            >
                              {githubTasksBusy ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : (
                                <RefreshCw className="size-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>
                            {githubTasksBusy
                              ? translate(
                                  'auto.components.TaskPage.31f81cc334',
                                  'Refreshing GitHub work…'
                                )
                              : translate(
                                  'auto.components.TaskPage.ff53631e6f',
                                  'Refresh GitHub work'
                                )}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>

                    {(() => {
                      // Why: show the source-slug chip only when the selector can't render (no upstream to toggle); otherwise it duplicates the selector.
                      const rows = perRepoSourceState.filter(
                        (s) => hasUpstreamCandidateDivergence(s) || hasDivergentSources(s)
                      )
                      if (rows.length === 0) {
                        return null
                      }
                      return (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          {rows.map((s) => {
                            const repo = selectedRepos.find((r) => r.id === s.repoId)
                            const showRepoBadgeLabel = selectedRepos.length > 1 && repo
                            const selectorRenderable = hasUpstreamCandidateDivergence(s)
                            // Why: render the indicator standalone — it has its own chip styles, so nesting it in our chip would double-border it.
                            if (!selectorRenderable && hasDivergentSources(s)) {
                              return (
                                <IssueSourceIndicator
                                  key={s.repoId}
                                  issues={s.sources.issues}
                                  prs={s.sources.prs}
                                  localRepo={
                                    showRepoBadgeLabel && repo
                                      ? { displayName: repo.displayName, color: repo.badgeColor }
                                      : undefined
                                  }
                                />
                              )
                            }
                            if (!selectorRenderable || !repo) {
                              return null
                            }
                            // Why: <div> not <span> — the child selector renders a block <div> (div-in-span is invalid HTML); inline-flex class looks identical.
                            return (
                              <div key={s.repoId} className={issueSourceChipClass}>
                                {showRepoBadgeLabel ? (
                                  <RepoBadgeLabel
                                    name={repo.displayName}
                                    color={repo.badgeColor}
                                    badgeClassName="size-1.5"
                                    className="text-[10px] text-muted-foreground"
                                  />
                                ) : null}
                                <IssueSourceSelector
                                  preference={repo.issueSourcePreference}
                                  origin={s.sources.originCandidate}
                                  upstream={s.sources.upstreamCandidate}
                                  onChange={(next) => {
                                    void setIssueSourcePreference(repo.id, repo.path, next)
                                  }}
                                />
                              </div>
                            )
                          })}
                        </div>
                      )
                    })()}
                  </div>
                ) : taskSource === 'linear' && linearConnected ? (
                  <div
                    className="min-w-0 rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 pt-2 pb-0 shadow-sm"
                    data-contextual-tour-target="tasks-search-presets"
                  >
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                      <div
                        className="flex items-center gap-1 text-xs"
                        role="group"
                        aria-label={translate(
                          'auto.components.TaskPage.0cbf7e5cf3',
                          'Linear task mode'
                        )}
                      >
                        {linearModeOptions.map((mode) => {
                          const active = linearMode === mode.id
                          return (
                            <button
                              key={mode.id}
                              type="button"
                              aria-pressed={active}
                              onClick={() => selectLinearMode(mode.id)}
                              className={cn(
                                'rounded-md border px-2 py-1 text-xs transition',
                                active
                                  ? 'border-border/50 bg-foreground/90 text-background'
                                  : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
                              )}
                            >
                              {mode.label}
                            </button>
                          )
                        })}
                      </div>
                      <div
                        className="flex shrink-0 items-center gap-2"
                        data-contextual-tour-target="tasks-actions"
                      >
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => {
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
                                  availableTeams.find(
                                    (team) =>
                                      team.workspaceId === selectedLinearProject?.workspaceId
                                  )?.id
                                setNewLinearIssueTeamId(
                                  projectTeamId ?? availableTeams[0]?.id ?? null
                                )
                                setNewLinearIssueProjectId(selectedLinearProject?.id ?? null)
                                setNewLinearIssueOpen(true)
                              }}
                              disabled={availableTeams.length === 0}
                              aria-label={
                                linearMode === 'projects' && !selectedLinearProject
                                  ? translate(
                                      'auto.components.TaskPage.1361275ec3',
                                      'New Linear project'
                                    )
                                  : translate(
                                      'auto.components.TaskPage.3feb524d42',
                                      'New Linear issue'
                                    )
                              }
                              className="size-8 border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
                            >
                              <Plus className="size-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>
                            {linearMode === 'projects' && !selectedLinearProject
                              ? translate(
                                  'auto.components.TaskPage.1361275ec3',
                                  'New Linear project'
                                )
                              : translate(
                                  'auto.components.TaskPage.3feb524d42',
                                  'New Linear issue'
                                )}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => setLinearRefreshNonce((n) => n + 1)}
                              disabled={
                                linearMode === 'issues'
                                  ? linearLoading
                                  : linearMode === 'projects'
                                    ? linearProjectsLoading || linearProjectDetailLoading
                                    : linearCustomViewsLoading || linearCustomViewContentsLoading
                              }
                              aria-label={translate(
                                'auto.components.TaskPage.8964184a8b',
                                'Refresh Linear'
                              )}
                              className="size-8 border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
                            >
                              {linearMode === 'issues' && linearLoading ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : linearMode === 'projects' &&
                                (linearProjectsLoading || linearProjectDetailLoading) ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : linearMode === 'views' &&
                                (linearCustomViewsLoading || linearCustomViewContentsLoading) ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : (
                                <RefreshCw className="size-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>
                            {translate('auto.components.TaskPage.8964184a8b', 'Refresh Linear')}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>

                    {linearMode === 'issues' ? (
                      <div className="mt-3 flex min-w-0 items-center gap-2">
                        {showLinearAttributeFilters ? (
                          <LinearIssueAttributeFilterDropdowns
                            value={linearAttributeFilter}
                            onChange={applyLinearAttributeFilter}
                            workspaceId={selectedLinearWorkspaceId ?? null}
                            isAllWorkspaces={selectedLinearWorkspaceId === 'all'}
                            primaryTeam={linearAttributePrimaryTeam}
                            selectedTeamIds={[...linearTeamSelection]}
                            availableTeams={linearTeamOptions}
                            settings={linearTaskSourceContext ?? settings}
                          />
                        ) : null}
                        <div className="relative min-w-0 flex-1 basis-64">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={linearSearchInput}
                            onChange={(e) => setLinearSearchInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                if (
                                  shouldSuppressEnterSubmit(
                                    {
                                      isComposing: e.nativeEvent.isComposing,
                                      shiftKey: e.shiftKey
                                    },
                                    false
                                  )
                                ) {
                                  return
                                }
                                e.preventDefault()
                                const trimmed = linearSearchInput.trim()
                                setLinearSearchInput(trimmed)
                                setAppliedLinearSearch(trimmed)
                                setTaskResumeState({ linearQuery: trimmed, linearMode: 'issues' })
                                setLinearRefreshNonce((n) => n + 1)
                              }
                            }}
                            placeholder={translate(
                              'auto.components.TaskPage.eec0c5c079',
                              'Search Linear issues...'
                            )}
                            className="h-8 rounded-md border-border/50 bg-background pl-8 pr-8 text-xs"
                          />
                          {linearSearchInput ? (
                            <button
                              type="button"
                              aria-label={translate(
                                'auto.components.TaskPage.b797bdd7c3',
                                'Clear search'
                              )}
                              onClick={() => {
                                setLinearSearchInput('')
                                setAppliedLinearSearch('')
                                setTaskResumeState({ linearQuery: '', linearMode: 'issues' })
                                setLinearRefreshNonce((n) => n + 1)
                              }}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                            >
                              <X className="size-4" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : linearMode === 'projects' && !selectedLinearProject ? (
                      <div className="mt-3 flex min-w-0 items-center gap-3">
                        <div className="relative min-w-0 flex-1 basis-64">
                          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            value={linearProjectSearchInput}
                            onChange={(e) => setLinearProjectSearchInput(e.target.value)}
                            placeholder={translate(
                              'auto.components.TaskPage.0b65d3fb2c',
                              'Search Linear projects...'
                            )}
                            className="h-8 rounded-md border-border/50 bg-background pl-8 pr-8 text-xs"
                          />
                          {linearProjectSearchInput ? (
                            <button
                              type="button"
                              aria-label={translate(
                                'auto.components.TaskPage.b797bdd7c3',
                                'Clear search'
                              )}
                              onClick={() => {
                                setLinearProjectSearchInput('')
                                setAppliedLinearProjectSearch('')
                                setLinearRefreshNonce((n) => n + 1)
                              }}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                            >
                              <X className="size-4" />
                            </button>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : taskSource === 'jira' && jiraConnected ? (
                  <div className="rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 pt-2 pb-0 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex flex-wrap gap-2">
                        {jiraPresets.map((preset) => {
                          const active = !jiraSearchInput && activeJiraPreset === preset.id
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => {
                                setJiraSearchInput('')
                                setAppliedJiraSearch('')
                                setActiveJiraPreset(preset.id)
                                setTaskResumeState({ jiraPreset: preset.id, jiraQuery: '' })
                                setJiraRefreshNonce((n) => n + 1)
                              }}
                              className={cn(
                                'rounded-md border px-2 py-1 text-xs transition',
                                active
                                  ? 'border-border/50 bg-foreground/90 text-background backdrop-blur-md'
                                  : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
                              )}
                            >
                              {preset.label}
                            </button>
                          )
                        })}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => {
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
                              }}
                              disabled={
                                sortedAvailableJiraProjects.length === 0 || jiraProjectsLoading
                              }
                              aria-label={translate(
                                'auto.components.TaskPage.0c11ca0b6d',
                                'New Jira issue'
                              )}
                              className="border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
                            >
                              {jiraProjectsLoading ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : (
                                <Plus className="size-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>
                            {translate('auto.components.TaskPage.0c11ca0b6d', 'New Jira issue')}
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="outline"
                              size="icon"
                              onClick={() => setJiraRefreshNonce((n) => n + 1)}
                              disabled={jiraLoading}
                              aria-label={translate(
                                'auto.components.TaskPage.2ff9fd71fd',
                                'Refresh Jira issues'
                              )}
                              className="border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
                            >
                              {jiraLoading ? (
                                <LoaderCircle className="size-4 animate-spin" />
                              ) : (
                                <RefreshCw className="size-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>
                            {translate(
                              'auto.components.TaskPage.2ff9fd71fd',
                              'Refresh Jira issues'
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <div className="relative min-w-[320px] flex-1">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          value={jiraSearchInput}
                          onChange={(e) => setJiraSearchInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              if (
                                shouldSuppressEnterSubmit(
                                  { isComposing: e.nativeEvent.isComposing, shiftKey: e.shiftKey },
                                  false
                                )
                              ) {
                                return
                              }
                              e.preventDefault()
                              const trimmed = jiraSearchInput.trim()
                              setJiraSearchInput(trimmed)
                              setAppliedJiraSearch(trimmed)
                              setTaskResumeState({ jiraQuery: trimmed })
                              setJiraRefreshNonce((n) => n + 1)
                            }
                          }}
                          placeholder={translate(
                            'auto.components.TaskPage.99c2755218',
                            'Jira JQL, e.g. project = ABC AND statusCategory != Done'
                          )}
                          className="h-8 rounded-md border-border/50 bg-background pl-8 pr-8 text-xs"
                        />
                        {jiraSearchInput ? (
                          <button
                            type="button"
                            aria-label={translate(
                              'auto.components.TaskPage.b797bdd7c3',
                              'Clear search'
                            )}
                            onClick={() => {
                              setJiraSearchInput('')
                              setAppliedJiraSearch('')
                              setTaskResumeState({ jiraQuery: '' })
                              setJiraRefreshNonce((n) => n + 1)
                            }}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                          >
                            <X className="size-4" />
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ) : taskSource === 'gitlab' ? (
                  <>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1 text-xs">
                        {(['issues', 'mrs', 'todos'] as const).map((view) => {
                          const active = gitlabView === view
                          const label =
                            view === 'issues' ? 'Issues' : view === 'mrs' ? 'MRs' : 'My Todos'
                          return (
                            <button
                              key={view}
                              type="button"
                              onClick={() => setGitlabView(view)}
                              className={cn(
                                'rounded-md border px-2.5 py-1 text-xs transition',
                                active
                                  ? 'border-foreground/40 bg-foreground/90 text-background'
                                  : 'border-border/50 bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground'
                              )}
                            >
                              {label}
                            </button>
                          )
                        })}
                      </div>
                      <div className="min-w-0 w-full sm:w-[200px]">
                        <TaskProjectSourceCombobox
                          groups={taskPickerGroups}
                          selected={repoSelection}
                          getRepoHostLabel={getTaskPickerRepoHostLabel}
                          onChange={(next) => {
                            const normalized = normalizeTaskRepoSelection(eligibleRepos, next)
                            setRepoSelection(normalized)
                            void updateSettings({ defaultRepoSelection: [...normalized] }).catch(
                              () => {
                                toast.error(
                                  translate(
                                    'auto.components.TaskPage.dfd72673e7',
                                    'Failed to save project selection.'
                                  )
                                )
                              }
                            )
                          }}
                          onSelectAll={() => {
                            const allIds = new Set(taskPickerRepos.map((r) => r.id))
                            setRepoSelection(allIds)
                            void updateSettings({ defaultRepoSelection: null }).catch(() => {
                              toast.error(
                                translate(
                                  'auto.components.TaskPage.dfd72673e7',
                                  'Failed to save project selection.'
                                )
                              )
                            })
                          }}
                          triggerClassName="h-8 w-full rounded-md border border-border/50 bg-muted/50 px-2 text-xs font-medium shadow-sm transition hover:bg-muted/50 focus:ring-2 focus:ring-ring/20 focus:outline-none"
                        />
                      </div>
                    </div>
                    <div
                      className="min-w-0 rounded-md rounded-b-none border border-border/50 bg-muted/50 px-3 pt-2 pb-0 shadow-sm"
                      data-contextual-tour-target="tasks-search-presets"
                    >
                      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <div className="flex flex-wrap gap-2">
                            {gitlabView === 'issues' || gitlabView === 'mrs'
                              ? (gitlabView === 'issues'
                                  ? gitLabIssueFilters
                                  : gitLabMRFilters
                                ).map(({ id, label }) => {
                                  const active = activeGitlabFilter === id
                                  return (
                                    <button
                                      key={id}
                                      type="button"
                                      onClick={() => {
                                        setGitlabFilter(id)
                                        setGitlabRefreshNonce((n) => n + 1)
                                      }}
                                      className={cn(
                                        'rounded-md border px-2 py-1 text-xs transition',
                                        active
                                          ? 'border-border/50 bg-foreground/90 text-background backdrop-blur-md'
                                          : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
                                      )}
                                    >
                                      {label}
                                    </button>
                                  )
                                })
                              : null}
                          </div>
                        </div>
                        <div
                          className="flex shrink-0 items-center gap-2"
                          data-contextual-tour-target="tasks-actions"
                        >
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="outline"
                                size="icon"
                                onClick={() => setGitlabRefreshNonce((n) => n + 1)}
                                disabled={gitlabLoading || gitlabTodosLoading}
                                aria-label={
                                  gitlabView === 'todos'
                                    ? translate(
                                        'auto.components.TaskPage.c679af7ad9',
                                        'Refresh My Todos'
                                      )
                                    : translate(
                                        'auto.components.TaskPage.d4c2830063',
                                        'Refresh GitLab work items'
                                      )
                                }
                                className="border-border/50 bg-transparent hover:bg-muted/50 backdrop-blur-md supports-[backdrop-filter]:bg-transparent"
                              >
                                {gitlabLoading || gitlabTodosLoading ? (
                                  <LoaderCircle className="size-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="size-4" />
                                )}
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="bottom" sideOffset={6}>
                              {gitlabView === 'todos'
                                ? translate(
                                    'auto.components.TaskPage.c679af7ad9',
                                    'Refresh My Todos'
                                  )
                                : translate(
                                    'auto.components.TaskPage.d4c2830063',
                                    'Refresh GitLab work items'
                                  )}
                            </TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  </>
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
            !jiraStatusReady ? (
              <div className="mt-4 flex items-center justify-center py-14">
                <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
              </div>
            ) : !jiraConnected ? (
              <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
                <JiraIcon className="mb-4 size-8 text-muted-foreground/60" />
                <p className="text-base font-medium text-foreground">
                  {translate('auto.components.TaskPage.a150c59da7', 'Connect your Jira site')}
                </p>
                <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                  {translate(
                    'auto.components.TaskPage.b518ae6307',
                    'Browse, edit, create, and start work from Jira issues directly from here.'
                  )}
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <Button onClick={() => setJiraConnectOpen(true)}>
                    {translate('auto.components.TaskPage.83bce6be5c', 'Connect Jira')}
                  </Button>
                  <Button variant="outline" onClick={() => hideTaskSource('jira', 'Jira')}>
                    {translate('auto.components.TaskPage.e7115334aa', 'Hide Jira')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
                <div className="flex h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3">
                  <div className="min-w-0 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {translate('auto.components.TaskPage.63b2abd3aa', 'Jira issues')}
                  </div>
                  <div className="shrink-0 text-[11px] text-muted-foreground">
                    {displayedJiraIssues.length}{' '}
                    {translate('auto.components.TaskPage.b7bae28b6a', 'shown')}
                  </div>
                </div>

                <TaskPageJiraSortControls
                  direction={jiraOrderDirection}
                  onSort={handleJiraSort}
                  orderBy={jiraOrderBy}
                />

                <div
                  className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek"
                  style={{ scrollbarGutter: 'stable' }}
                >
                  {jiraStatus.credentialError ? (
                    <div className="border-b border-border px-4 py-4 text-sm text-destructive">
                      {jiraStatus.credentialError}
                    </div>
                  ) : null}
                  {!jiraStatus.credentialError && jiraError ? (
                    <TaskPageJiraErrorBanner
                      error={jiraError}
                      open={jiraErrorDetailsOpen}
                      onOpenChange={setJiraErrorDetailsOpen}
                    />
                  ) : null}

                  {jiraLoading && jiraIssues.length === 0 ? (
                    <div className="divide-y divide-border/50">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="px-3 py-3">
                          <div className="h-4 w-4/5 animate-pulse rounded bg-muted/70" />
                          <div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-muted/60" />
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {!jiraLoading &&
                  jiraIssues.length === 0 &&
                  !jiraError &&
                  !jiraStatus.credentialError ? (
                    <div className="px-4 py-10 text-center">
                      <p className="text-sm font-medium text-foreground">
                        {translate('auto.components.TaskPage.eba87f2edb', 'No Jira issues found')}
                      </p>
                      <p className="mt-2 text-sm text-muted-foreground">
                        {jiraSearchInput
                          ? translate(
                              'auto.components.TaskPage.f51e254d35',
                              'Try a different JQL query.'
                            )
                          : translate(
                              'auto.components.TaskPage.94d900518d',
                              'No issues match the selected preset.'
                            )}
                      </p>
                    </div>
                  ) : null}

                  <TaskPageJiraIssueList
                    formatUpdatedAt={formatRelativeTime}
                    getStatusTone={getJiraStatusTone}
                    issues={sortedJiraIssues}
                    onOpenIssue={openJiraDetailPage}
                    onStartWorkspace={handleUseJiraItem}
                    selectedIssue={selectedJiraIssue}
                    showSiteContext={selectedJiraSiteId === 'all'}
                    statusDirection={jiraOrderBy === 'status' ? jiraOrderDirection : 'asc'}
                    statusOrder={displayedJiraStatusOrder}
                  />
                </div>
                <JiraIssueWorkspace
                  issue={selectedJiraIssue}
                  onUse={handleUseJiraItem}
                  onClose={closeTaskDetailPage}
                  sourceContext={jiraDetailSourceContext}
                />
              </div>
            )
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
              <div className="flex h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3">
                <div className="flex min-w-0 items-center gap-2">
                  {activeLinearIssueContextLabel ? (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => {
                        if (selectedLinearProject) {
                          setLinearProjectTab('overview')
                          return
                        }
                        setSelectedLinearCustomView(null)
                        setLinearProjectParentView(null)
                        setTaskResumeState({ linearContext: undefined })
                      }}
                      aria-label={translate('auto.components.TaskPage.f397d513e3', 'Back')}
                    >
                      <ChevronLeft className="size-3.5" />
                    </Button>
                  ) : null}
                  <div className="min-w-0 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
                    {activeLinearIssueContextLabel ??
                      translate('auto.components.TaskPage.60f68a2ef4', 'Linear issues')}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div
                    className="hidden items-center rounded-md border border-border/50 bg-background/70 p-0.5 md:flex"
                    aria-label={translate(
                      'auto.components.TaskPage.d47248df4d',
                      'Linear view mode'
                    )}
                  >
                    {linearViewOptions.map(({ id, label, Icon }) => {
                      const active = linearViewMode === id
                      return (
                        <Tooltip key={id}>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              onClick={() => setLinearViewMode(id)}
                              aria-label={translate(
                                'auto.components.TaskPage.af377b13b1',
                                '{{value0}} view',
                                { value0: label }
                              )}
                              aria-pressed={active}
                              className={cn(
                                'inline-flex size-6 items-center justify-center rounded text-muted-foreground transition hover:text-foreground',
                                active && 'bg-accent text-accent-foreground shadow-xs'
                              )}
                            >
                              <Icon className="size-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" sideOffset={6}>
                            {translate('auto.components.TaskPage.af377b13b1', '{{value0}} view', {
                              value0: label
                            })}
                          </TooltipContent>
                        </Tooltip>
                      )
                    })}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="outline"
                        size="xs"
                        className="gap-1 border-border/50 bg-background/70 text-[11px]"
                      >
                        <SlidersHorizontal className="size-3.5" />
                        {translate('auto.components.TaskPage.9c57663908', 'View')}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuLabel className="flex items-center gap-2">
                        <List className="size-3.5" />
                        {translate('auto.components.TaskPage.9c57663908', 'View')}
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={linearViewMode}
                        onValueChange={(value) => setLinearViewMode(value as LinearViewMode)}
                      >
                        {linearViewOptions.map(({ id, label, Icon }) => (
                          <DropdownMenuRadioItem key={id} value={id}>
                            <Icon className="size-3.5" />
                            {label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="flex items-center gap-2">
                        <SlidersHorizontal className="size-3.5" />
                        {translate('auto.components.TaskPage.5659da12fc', 'Grouping')}
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={linearGroupBy}
                        onValueChange={(value) => setLinearGroupBy(value as LinearGroupBy)}
                      >
                        {linearGroupOptions.map((option) => (
                          <DropdownMenuRadioItem key={option.id} value={option.id}>
                            {option.label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="flex items-center gap-2">
                        <ArrowDownUp className="size-3.5" />
                        {translate('auto.components.TaskPage.5d2d835467', 'Ordering')}
                      </DropdownMenuLabel>
                      <DropdownMenuRadioGroup
                        value={linearOrderBy}
                        onValueChange={(value) => setLinearOrderBy(value as LinearOrderBy)}
                      >
                        {linearOrderOptions.map((option) => (
                          <DropdownMenuRadioItem key={option.id} value={option.id}>
                            {option.label}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="flex items-center gap-2">
                        <Eye className="size-3.5" />
                        {translate('auto.components.TaskPage.a26a48252e', 'Display properties')}
                      </DropdownMenuLabel>
                      {linearDisplayPropertyOptions.map((property) => (
                        <DropdownMenuCheckboxItem
                          key={property.id}
                          checked={effectiveLinearDisplayProperties.has(property.id)}
                          onSelect={(event) => event.preventDefault()}
                          onCheckedChange={() => toggleLinearDisplayProperty(property.id)}
                        >
                          {property.label}
                        </DropdownMenuCheckboxItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <div className="text-[11px] text-muted-foreground">
                    {pagedLinearIssues.length}{' '}
                    {translate('auto.components.TaskPage.b7bae28b6a', 'shown')}
                  </div>
                </div>
              </div>

              {linearViewMode === 'list' && linearGroupBy === 'none' ? (
                <div
                  className="grid h-8 flex-none items-center gap-3 border-b border-border/50 bg-muted/25 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground max-lg:!hidden lg:grid-cols-[var(--linear-grid-template)] [&>span]:min-w-0 [&>span]:truncate"
                  style={linearIssueGridStyle}
                >
                  <span>{translate('auto.components.TaskPage.37e7ee311e', 'Key')}</span>
                  <span>{translate('auto.components.TaskPage.b1eaa18ace', 'Issue')}</span>
                  {effectiveLinearDisplayProperties.has('labels') ? (
                    <span>{translate('auto.components.TaskPage.d0ca4aa1d0', 'Labels')}</span>
                  ) : null}
                  {effectiveLinearDisplayProperties.has('team') ? (
                    <span>{translate('auto.components.TaskPage.a98cbe7664', 'Team')}</span>
                  ) : null}
                  {effectiveLinearDisplayProperties.has('state') ? (
                    <span>{translate('auto.components.TaskPage.154b0fa623', 'Status')}</span>
                  ) : null}
                  {effectiveLinearDisplayProperties.has('assignee') ? (
                    <span className="text-center">
                      {translate('auto.components.TaskPage.d2a876ca53', 'Assignee')}
                    </span>
                  ) : null}
                  {effectiveLinearDisplayProperties.has('updated') ? (
                    <span>{translate('auto.components.TaskPage.f362667d55', 'Updated')}</span>
                  ) : null}
                  <span />
                </div>
              ) : null}

              <div
                className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek"
                style={{ scrollbarGutter: 'stable' }}
              >
                {activeLinearIssueError ? (
                  <div className="border-b border-border px-4 py-4 text-sm text-destructive">
                    {activeLinearIssueError}
                  </div>
                ) : null}

                {activeLinearIssueLoading && activeLinearIssues.length === 0 ? (
                  <div className="divide-y divide-border/50">
                    {Array.from({ length: 12 }).map((_, i) => (
                      <div key={i} className="px-3 py-3">
                        <div className="h-4 w-4/5 animate-pulse rounded bg-muted/70" />
                        <div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-muted/60" />
                      </div>
                    ))}
                  </div>
                ) : null}

                {!activeLinearIssueLoading &&
                activeLinearIssues.length === 0 &&
                !activeLinearIssueError &&
                activeLinearIssueHasCollectionError ? (
                  <div className="px-4 py-10 text-center">
                    <p className="text-sm font-medium text-foreground">
                      {translate(
                        'auto.components.TaskPage.cc8795e07c',
                        'Unable to load Linear issues'
                      )}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {translate(
                        'auto.components.TaskPage.5ed38a49e5',
                        'Review the workspace error below, then refresh.'
                      )}
                    </p>
                  </div>
                ) : null}

                {!activeLinearIssueLoading &&
                activeLinearIssues.length === 0 &&
                !activeLinearIssueError &&
                !activeLinearIssueHasCollectionError ? (
                  <div className="px-4 py-10 text-center">
                    <p className="text-sm font-medium text-foreground">
                      {translate('auto.components.TaskPage.903c7af49f', 'No Linear issues found')}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {(() => {
                        const emptyKind = resolveLinearIssueEmptyKind({
                          hasContextLabel: Boolean(activeLinearIssueContextLabel),
                          searchActive: linearSearchActive,
                          attributeFilter: linearAttributeFilter,
                          serverIssueCount: activeLinearIssues.length,
                          filteredIssueCount: filteredLinearIssues.length
                        })
                        if (emptyKind === 'context') {
                          return translate(
                            'auto.components.TaskPage.25ff84769a',
                            'No issues match this Linear context.'
                          )
                        }
                        if (emptyKind === 'search') {
                          return translate(
                            'auto.components.TaskPage.2bdefbcac3',
                            'Try a different search query.'
                          )
                        }
                        if (emptyKind === 'server-attribute-filter') {
                          return translate(
                            'auto.components.TaskPage.linearEmptyAttributeFilter',
                            'No issues match the selected filters. Clear a filter or try different criteria.'
                          )
                        }
                        return translate(
                          'auto.components.TaskPage.linearEmptyUnfilteredScope',
                          'No issues in this workspace scope. Try searching or adjusting teams.'
                        )
                      })()}
                    </p>
                  </div>
                ) : null}

                {!activeLinearIssueLoading &&
                activeLinearIssues.length > 0 &&
                filteredLinearIssues.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <p className="text-sm font-medium text-foreground">
                      {translate(
                        'auto.components.TaskPage.618107fab3',
                        'No fetched issues match the selected teams'
                      )}
                    </p>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {translate(
                        'auto.components.TaskPage.592a55611b',
                        'Try selecting more teams or refreshing; team filters apply to the current fetched issue set.'
                      )}
                    </p>
                    {shouldOfferLinearIssueFetchMore({
                      emptyKind: 'client-team',
                      serverHasMore: linearIssuesHasMore
                    }) ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="mt-3 h-7 text-xs"
                        onClick={() => {
                          setLinearIssueLimit((limit) =>
                            Math.min(
                              clampLinearIssueListLimit(limit + LINEAR_ITEM_LIMIT),
                              LINEAR_ISSUE_LIST_MAX
                            )
                          )
                        }}
                      >
                        {translate('auto.components.TaskPage.linearFetchMore', 'Fetch more')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}

                {linearViewMode === 'board' ? (
                  <div className="grid min-w-0 gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                    {linearBoardSections.map((section) => (
                      <section
                        key={section.key}
                        onDragOver={(event) => handleLinearBoardDragOver(section, event)}
                        onDrop={(event) => void handleLinearBoardDrop(section, event)}
                        className={cn(
                          'min-h-0 rounded-md border border-border/50 bg-muted/20 transition-[border-color,box-shadow]',
                          linearBoardDragOverKey === section.key &&
                            'border-ring/70 ring-1 ring-ring/70'
                        )}
                      >
                        <div className="flex h-9 items-center justify-between border-b border-border/50 px-3">
                          <span className="truncate text-xs font-medium text-foreground">
                            {section.label}
                          </span>
                          <span className="text-[11px] text-muted-foreground">
                            {section.issues.length}
                          </span>
                        </div>
                        <div className="space-y-2 p-2">
                          {section.issues.map((issue) => {
                            const selected = issue.id === selectedLinearIssueId
                            const labels = issue.labels.slice(0, 2)
                            const dragging = linearBoardDraggingIssueId === issue.id
                            const updating = linearBoardUpdatingIssueIds.has(issue.id)
                            const teamLabel =
                              selectedLinearWorkspaceId === 'all' && issue.workspaceName
                                ? `${issue.workspaceName} / ${issue.team.name}`
                                : issue.team.name
                            return (
                              <div
                                key={issue.id}
                                role="button"
                                tabIndex={0}
                                draggable={linearStatusBoardEnabled && !updating}
                                aria-current={selected ? 'true' : undefined}
                                data-current={selected ? 'true' : undefined}
                                aria-disabled={updating ? 'true' : undefined}
                                onDragStart={(event) =>
                                  handleLinearBoardCardDragStart(issue, event)
                                }
                                onDragEnd={() => {
                                  setLinearBoardDraggingIssueId(null)
                                  setLinearBoardDragOverKey(null)
                                }}
                                onClick={() => openLinearDetailPage(issue)}
                                onKeyDown={(e) => {
                                  if (e.target !== e.currentTarget) {
                                    return
                                  }
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    openLinearDetailPage(issue)
                                  }
                                }}
                                className={cn(
                                  'group/row cursor-pointer rounded-md border border-border/50 bg-background px-3 py-2 text-left transition hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
                                  linearStatusBoardEnabled &&
                                    !updating &&
                                    'cursor-grab active:cursor-grabbing',
                                  selected && 'bg-accent',
                                  dragging && 'opacity-50',
                                  updating && 'cursor-wait opacity-70'
                                )}
                              >
                                <div className="flex min-w-0 items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <div className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
                                      {effectiveLinearDisplayProperties.has('priority') ? (
                                        <LinearPriorityIcon
                                          priority={issue.priority}
                                          className="size-3.5"
                                        />
                                      ) : null}
                                      <span className="truncate">{issue.identifier}</span>
                                    </div>
                                    <h3 className="mt-1 line-clamp-2 text-[13px] font-medium leading-snug text-foreground">
                                      {issue.title}
                                    </h3>
                                  </div>
                                  <div className="flex shrink-0 items-center gap-1 opacity-70 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100">
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      data-contextual-tour-target="tasks-start-workspace"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        handleUseLinearItem(issue)
                                      }}
                                      aria-label={translate(
                                        'auto.components.TaskPage.ff90d0abc7',
                                        'Start workspace from {{value0}}',
                                        { value0: issue.identifier }
                                      )}
                                    >
                                      <ArrowRight className="size-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon-xs"
                                      onClick={(event) => {
                                        event.stopPropagation()
                                        window.api.shell.openUrl(issue.url)
                                      }}
                                      aria-label={translate(
                                        'auto.components.TaskPage.246bd64aed',
                                        'Open {{value0}} in Linear',
                                        { value0: issue.identifier }
                                      )}
                                    >
                                      <ExternalLink className="size-3.5" />
                                    </Button>
                                  </div>
                                </div>
                                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                                  {effectiveLinearDisplayProperties.has('state') ? (
                                    <LinearStateCell
                                      issue={issue}
                                      className="px-1.5 py-0.5"
                                      sourceContext={linearTaskSourceContext}
                                    />
                                  ) : null}
                                  {effectiveLinearDisplayProperties.has('assignee') ? (
                                    <span>
                                      {issue.assignee?.displayName ??
                                        translate(
                                          'auto.components.TaskPage.42a9160321',
                                          'Unassigned'
                                        )}
                                    </span>
                                  ) : null}
                                  {effectiveLinearDisplayProperties.has('team') ? (
                                    <span className="truncate">{teamLabel}</span>
                                  ) : null}
                                  {effectiveLinearDisplayProperties.has('updated') ? (
                                    <span>{formatRelativeTime(issue.updatedAt)}</span>
                                  ) : null}
                                </div>
                                {effectiveLinearDisplayProperties.has('labels') &&
                                issue.labels.length > 0 ? (
                                  <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1">
                                    {labels.map((label) => (
                                      <span
                                        key={label}
                                        className="max-w-[140px] truncate rounded-full border border-border/50 bg-muted/35 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                                      >
                                        {label}
                                      </span>
                                    ))}
                                    {issue.labels.length > labels.length ? (
                                      <span className="text-[10px] text-muted-foreground">
                                        +{issue.labels.length - labels.length}
                                      </span>
                                    ) : null}
                                  </div>
                                ) : null}
                              </div>
                            )
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <TaskPageLinearIssueList
                    rows={linearIssueListRows}
                    effectiveDisplayProperties={effectiveLinearDisplayProperties}
                    gridStyle={linearIssueGridStyle}
                    selectedIssueId={selectedLinearIssueId}
                    selectedWorkspaceId={selectedLinearWorkspaceId}
                    sourceContext={linearTaskSourceContext}
                    onOpenIssue={openLinearDetailPage}
                    onUseIssue={handleUseLinearItem}
                  />
                )}
              </div>
              {selectedLinearProject && linearProjectTab === 'issues' ? (
                <>
                  <LinearCollectionNotice
                    errors={linearProjectIssuesResult.errors}
                    hasMore={showLinearEmptyFilteredLoadMore}
                    count={linearProjectIssuesResult.items.length}
                    label={translate('auto.components.TaskPage.67662ade50', 'project issues')}
                    onLoadMore={handleLinearEmptyFilteredLoadMore}
                    loading={activeLinearIssueLoading}
                    loadMoreLabel="Fetch more"
                  />
                  {showLinearIssuePagination ? (
                    <div className="flex-none border-t border-border/50 bg-muted/50">
                      <PaginationBar
                        currentPage={visibleLinearIssuePage}
                        totalPages={linearIssueTotalPages}
                        loadingTarget={activeLinearIssueLoadingTargetPage}
                        onPageChange={handleLinearIssuePageChange}
                      />
                    </div>
                  ) : null}
                </>
              ) : selectedLinearCustomView?.model === 'issue' ? (
                <>
                  <LinearCollectionNotice
                    errors={linearCustomViewIssuesResult.errors}
                    hasMore={showLinearEmptyFilteredLoadMore}
                    count={linearCustomViewIssuesResult.items.length}
                    label={translate('auto.components.TaskPage.be8cf68d9f', 'view issues')}
                    onLoadMore={handleLinearEmptyFilteredLoadMore}
                    loading={activeLinearIssueLoading}
                    loadMoreLabel="Fetch more"
                  />
                  {showLinearIssuePagination ? (
                    <div className="flex-none border-t border-border/50 bg-muted/50">
                      <PaginationBar
                        currentPage={visibleLinearIssuePage}
                        totalPages={linearIssueTotalPages}
                        loadingTarget={activeLinearIssueLoadingTargetPage}
                        onPageChange={handleLinearIssuePageChange}
                      />
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <LinearCollectionNotice
                    hasMore={showLinearEmptyFilteredLoadMore}
                    count={linearIssues.length}
                    label={translate('auto.components.TaskPage.d1e243795c', 'issues')}
                    onLoadMore={handleLinearEmptyFilteredLoadMore}
                    loading={activeLinearIssueLoading}
                    loadMoreLabel="Fetch more"
                  />
                  {showLinearIssuePagination ? (
                    <div className="flex-none border-t border-border/50 bg-muted/50">
                      <PaginationBar
                        currentPage={visibleLinearIssuePage}
                        totalPages={linearIssueTotalPages}
                        loadingTarget={activeLinearIssueLoadingTargetPage}
                        onPageChange={handleLinearIssuePageChange}
                      />
                    </div>
                  ) : null}
                </>
              )}
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
