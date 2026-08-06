import { useCallback, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'

import { useAppStore } from '@/store'
import { reconcileLinearTeamSelection } from './task-page-linear-team-selection'
import { resolveLinearIssueAttributeFilterPrimaryTeam } from './linear-issue-attribute-filter-primary-team'
import {
  isLinearIssueSearchActive,
  teamDerivedFacetsForPrimaryTeamChange
} from './task-page-linear-issue-request'
import {
  emptyLinearIssueAttributeFilter,
  linearIssueAttributeFilterSignature,
  type LinearIssueAttributeFilter
} from '../../../shared/linear-issue-attribute-filter'
import { LINEAR_ISSUE_LIST_MAX } from '../../../shared/linear-issue-read-limits'
import {
  buildLinearTeamUrl,
  getLinearOrganizationUrlKeyFromIssueUrl
} from '../../../shared/linear-links'
import type { LinearTeam, LinearWorkspaceSelection } from '../../../shared/types'
import { findTaskPageLinearIssue } from './task-page-linear-cache-selectors'
import { compareLinearIssues } from './task-page-linear-grouping'
import { useTaskPageLinearIssuePaginationState } from './use-task-page-linear-issue-pagination-state'
import type { TaskPageLinearCollectionController } from './use-task-page-linear-collection-controller'

const LINEAR_ITEM_LIMIT = 36

type Props = {
  collection: TaskPageLinearCollectionController
  availableTeams: LinearTeam[]
  defaultLinearTeamSelection: readonly string[] | null | undefined
  selectedLinearWorkspaceId: LinearWorkspaceSelection
  linearCredentialError: string | null | undefined
}

export function useTaskPageLinearListModel({
  collection,
  availableTeams,
  defaultLinearTeamSelection,
  selectedLinearWorkspaceId,
  linearCredentialError
}: Props) {
  const {
    linearMode,
    linearIssues,
    linearIssueLimit,
    linearIssuePage,
    linearIssueLoadingTargetPage,
    linearIssuesHasMore,
    linearLoading,
    linearError,
    linearSearchInput,
    appliedLinearSearch,
    linearAttributeFilter,
    setLinearAttributeFilter,
    linearPrimaryTeamIdRef,
    previousLinearWorkspaceIdForFiltersRef,
    linearOrderBy,
    selectedLinearProject,
    linearProjectTab,
    linearProjectIssuesResult,
    linearProjectIssueLimit,
    linearProjectIssuePage,
    linearProjectIssueLoadingTargetPage,
    linearProjectIssuesLoading,
    linearProjectIssuesError,
    selectedLinearCustomView,
    linearCustomViewIssuesResult,
    linearCustomViewIssueLimit,
    linearCustomViewIssuePage,
    linearCustomViewIssueLoadingTargetPage,
    linearCustomViewContentsLoading,
    linearCustomViewContentsError,
    setLinearCustomViewIssueLoadingTargetPage,
    setLinearCustomViewIssuePage,
    setLinearCustomViewIssueLimit,
    setLinearIssueLoadingTargetPage,
    setLinearIssuePage,
    setLinearIssueLimit,
    setLinearProjectIssueLoadingTargetPage,
    setLinearProjectIssuePage,
    setLinearProjectIssueLimit
  } = collection
  const linearCacheSnapshot = useAppStore(
    useShallow((state) => ({
      issueCache: state.linearIssueCache,
      searchCache: state.linearSearchCache,
      listCache: state.linearListCache
    }))
  )
  const [linearTeamSelection, setLinearTeamSelection] = useState<ReadonlySet<string>>(() =>
    defaultLinearTeamSelection ? new Set(defaultLinearTeamSelection) : new Set<string>()
  )
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
    linearCredentialError ??
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
    [activeLinearIssues, linearCacheSnapshot]
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
  const linearTeamOptions = useMemo(() => {
    if (availableTeams.length === 0) {
      return linearIssueTeams
    }
    const issueTeamById = new Map(linearIssueTeams.map((team) => [team.id, team]))
    return availableTeams.map((team) =>
      team.url ? team : { ...team, url: issueTeamById.get(team.id)?.url }
    )
  }, [availableTeams, linearIssueTeams])

  useEffect(() => {
    if (linearTeamOptions.length === 0) {
      return
    }
    setLinearTeamSelection(
      reconcileLinearTeamSelection(linearTeamOptions, defaultLinearTeamSelection)
    )
  }, [defaultLinearTeamSelection, linearTeamOptions])
  const linearAttributePrimaryTeam = useMemo(
    () =>
      resolveLinearIssueAttributeFilterPrimaryTeam({
        selectedTeamIds: [...linearTeamSelection],
        availableTeams: linearTeamOptions
      }),
    [linearTeamOptions, linearTeamSelection]
  )
  const applyLinearAttributeFilter = useCallback(
    (next: LinearIssueAttributeFilter) => {
      setLinearAttributeFilter(next)
      setLinearIssueLimit(LINEAR_ITEM_LIMIT)
      setLinearIssuePage(0)
      setLinearIssueLoadingTargetPage(null)
    },
    [
      setLinearAttributeFilter,
      setLinearIssueLimit,
      setLinearIssueLoadingTargetPage,
      setLinearIssuePage
    ]
  )
  useEffect(() => {
    const workspaceId = selectedLinearWorkspaceId ?? null
    const previous = previousLinearWorkspaceIdForFiltersRef.current
    previousLinearWorkspaceIdForFiltersRef.current = workspaceId
    if (previous === undefined || previous === workspaceId) {
      return
    }
    applyLinearAttributeFilter(emptyLinearIssueAttributeFilter())
  }, [
    applyLinearAttributeFilter,
    previousLinearWorkspaceIdForFiltersRef,
    selectedLinearWorkspaceId
  ])
  useEffect(() => {
    const nextId = linearAttributePrimaryTeam?.id ?? null
    const previousId = linearPrimaryTeamIdRef.current
    linearPrimaryTeamIdRef.current = nextId
    if (previousId === null || previousId === nextId) {
      return
    }
    const next = teamDerivedFacetsForPrimaryTeamChange(linearAttributeFilter)
    if (
      linearIssueAttributeFilterSignature(linearAttributeFilter) !==
      linearIssueAttributeFilterSignature(next)
    ) {
      applyLinearAttributeFilter(next)
    }
  }, [
    applyLinearAttributeFilter,
    linearAttributeFilter,
    linearAttributePrimaryTeam,
    linearPrimaryTeamIdRef
  ])
  const linearSearchActive = isLinearIssueSearchActive(linearSearchInput, appliedLinearSearch)
  const showLinearAttributeFilters =
    linearMode === 'issues' && !activeLinearIssueContextLabel && !linearSearchActive
  const filteredLinearIssues = useMemo(() => {
    if (
      activeLinearIssueContextLabel ||
      (displayedLinearIssues.length > 0 && linearTeamSelection.size === 0)
    ) {
      return displayedLinearIssues
    }
    return displayedLinearIssues.filter((issue) => linearTeamSelection.has(issue.team.id))
  }, [activeLinearIssueContextLabel, displayedLinearIssues, linearTeamSelection])
  const orderedLinearIssues = useMemo(
    () => [...filteredLinearIssues].sort((a, b) => compareLinearIssues(a, b, linearOrderBy)),
    [filteredLinearIssues, linearOrderBy]
  )
  const pagination = useTaskPageLinearIssuePaginationState({
    activeLinearIssueCanRequestMore:
      activeLinearIssueCanLoadMore && !activeLinearIssueHasCollectionError,
    activeLinearIssueError,
    activeLinearIssueLimit,
    activeLinearIssueLoading,
    activeLinearIssueLoadingTargetPage,
    activeLinearIssuePage,
    linearProjectTab,
    loadedLinearIssues: orderedLinearIssues,
    selectedLinearCustomView,
    selectedLinearProject,
    setLinearCustomViewIssueLoadingTargetPage,
    setLinearCustomViewIssuePage,
    setLinearCustomViewIssueLimit,
    setLinearIssueLoadingTargetPage,
    setLinearIssuePage,
    setLinearIssueLimit,
    setLinearProjectIssueLoadingTargetPage,
    setLinearProjectIssuePage,
    setLinearProjectIssueLimit
  })
  const selectedLinearTeamForExternalLink = useMemo(() => {
    if (linearTeamSelection.size !== 1) {
      return null
    }
    const [teamId] = linearTeamSelection
    const team = linearTeamOptions.find((candidate) => candidate.id === teamId && candidate.url)
    return team?.url ? { name: team.name, url: team.url } : null
  }, [linearTeamOptions, linearTeamSelection])

  return {
    activeLinearIssues,
    activeLinearIssueLoading,
    activeLinearIssueError,
    activeLinearIssueHasCollectionError,
    activeLinearIssueContextLabel,
    activeLinearIssueLoadingTargetPage,
    linearTeamSelection,
    setLinearTeamSelection,
    linearTeamOptions,
    linearAttributePrimaryTeam,
    applyLinearAttributeFilter,
    linearSearchActive,
    showLinearAttributeFilters,
    filteredLinearIssues,
    selectedLinearTeamForExternalLink,
    ...pagination
  }
}

export type TaskPageLinearListModel = ReturnType<typeof useTaskPageLinearListModel>
