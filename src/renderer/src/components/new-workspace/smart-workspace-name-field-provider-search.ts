// Concrete smart workspace name field view and source orchestration.
// Concrete surface implementation for SmartWorkspaceNameField.tsx
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: this component's existing reset effects need a dedicated refactor outside the Linear API compatibility change. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import {
  listGitLabMRsForSource,
  lookupGitLabWorkItemByPathForSource
} from '@/lib/gitlab-work-item-source-lookup'
import { parseGitLabIssueOrMRLink } from '@/lib/gitlab-links'
import { cn } from '@/lib/utils'
import { searchRuntimeRepoBaseRefDetails } from '@/runtime/runtime-repo-client'
import {
  buildJiraIssueSearchJql,
  buildSmartWorkspaceSourceRows,
  getBranchSearchRequest,
  getSmartWorkspaceEmptyHint,
  getVisibleBranchResults,
  getVisibleHeldProviderResults,
  isBlockingJiraUrlIntent,
  isSmartWorkspaceSourceQueryWithinLimit,
  type SmartNameMode,
  type SmartWorkspaceSourceRow
} from './smart-workspace-source-results'
import type {
  BaseRefSearchResult,
  GitHubWorkItem,
  GitLabWorkItem,
  JiraIssue,
  JiraSite,
  LinearIssue
} from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import {
  buildTaskSourceContextFromRepo,
  getTaskSourceCacheScope,
  type TaskSourceContext
} from '../../../../shared/task-source-context'
import { parseExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import {
  bindJiraIssueSourceContext,
  useJiraUrlSource,
  type JiraUrlSourceState
} from './use-jira-url-source'

export type RepoOption = ReturnType<typeof useAppStore.getState>['repos'][number]
const EMPTY_REPO_SEARCH_REPOS: readonly RepoOption[] = []

type SmartWorkspaceNameFieldProps = {
  repos: RepoOption[]
  repoId: string
  onRepoChange: (repoId: string) => void
  value: string
  onValueChange: (value: string) => void
  onGitHubItemSelect: (item: GitHubWorkItem) => void
  /** Optional; when omitted, GitLab paste-URL detection is silently skipped. */
  onGitLabItemSelect?: (item: GitLabWorkItem) => void
  onBranchSelect: (refName: string, localBranchName: string) => void
  onLinearIssueSelect: (issue: LinearIssue) => void
  onJiraIssueSelect?: (issue: JiraIssue, sourceContext: TaskSourceContext) => void
  onOpenJiraSettings?: () => void
  selectedSource: SmartWorkspaceNameSelection | null
  onClearSelectedSource: () => void
  githubSourceContext?: TaskSourceContext | null
  jiraSourceContext?: TaskSourceContext | null
  inputRef?: React.RefObject<HTMLInputElement | null>
  onPlainEnter?: () => void
  disabled?: boolean
  disabledPlaceholder?: string
  textOnly?: boolean
  branchesEnabled?: boolean
  repoBackedSourcesDisabled?: boolean
  repoBackedSearchRepos?: readonly RepoOption[]
  allowCrossRepoProjectAdd?: boolean
  crossRepoSwitchTarget?: 'project' | 'task-source'
  onActiveSourceModeChange?: (mode: SmartNameMode) => void
}

export type SmartWorkspaceNameSelection = {
  kind: 'github-pr' | 'github-issue' | 'gitlab-mr' | 'gitlab-issue' | 'branch' | 'linear' | 'jira'
  label: string
  url?: string
}

const SEARCH_DEBOUNCE_MS = 200
const RESULT_LIMIT = 12

export function canUseGitLabSmartSource({
  localGitlabAvailable,
  repoBackedSourcesDisabled,
  sourceHostId
}: {
  localGitlabAvailable: boolean
  repoBackedSourcesDisabled: boolean
  sourceHostId: ExecutionHostId | null | undefined
}): boolean {
  if (repoBackedSourcesDisabled) {
    return false
  }
  const parsedHost = parseExecutionHostId(sourceHostId)
  return parsedHost?.kind === 'ssh' || parsedHost?.kind === 'runtime' || localGitlabAvailable
}

export type RowEntry = SmartWorkspaceSourceRow | { kind: 'jira-account'; value: string; site: JiraSite }

const ROW_ITEM_CLASS_NAME = 'gap-2 px-3 py-2 text-xs'

function getJiraSourceStatusMessage(jiraSource: JiraUrlSourceState): string {
  if (jiraSource.loading) {
    return translate(
      'auto.components.new.workspace.SmartWorkspaceNameField.loadingJira',
      'Loading Jira issue…'
    )
  }
  switch (jiraSource.errorKind) {
    case 'disconnected':
      return translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.jiraDisconnected',
        'Connect Jira in Settings to link this issue'
      )
    case 'site-not-connected':
      return translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.jiraSiteNotConnected',
        'This Jira site is not connected'
      )
    case 'update-runtime':
      return translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.jiraRuntimeUpdate',
        'Update the remote runtime to link Jira'
      )
    case 'read-failed':
      return translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.jiraReadFailed',
        'Couldn’t load this Jira issue'
      )
    case null:
      return jiraSource.accountChoices.length > 0
        ? translate(
            'auto.components.new.workspace.SmartWorkspaceNameField.chooseJiraAccount',
            'Choose a Jira account'
          )
        : translate(
            'auto.components.new.workspace.SmartWorkspaceNameField.jiraLoaded',
            'Jira issue loaded'
          )
  }
}

function isTypedTextSourceRow(row: RowEntry): boolean {
  return row.kind === 'use-name' || row.kind === 'create-branch'
}

function getRowItemClassName(row: RowEntry, options?: { pinnedAction?: boolean }): string {
  return cn(
    ROW_ITEM_CLASS_NAME,
    options?.pinnedAction && isTypedTextSourceRow(row) && 'bg-muted/35'
  )
}


export function useSmartWorkspaceProviderSearch(context: Record<string, any>): void {
  const {
    selectedRepoOwnerSettings,
    gitlabSourceContext,
    repoBackedSearchTargets,
    linearSourceContext,
    mode,
    mrStateFilter,
    debouncedQuery,
    setGitlabItems,
    setBranches,
    setBranchResultsSource,
    setLinearIssues,
    setJiraIssues,
    setGitlabLoading,
    setBranchesLoading,
    setLinearLoading,
    setJiraLoading,
    jiraConnectionStatus,
    jiraSource,
    gitlabSourceAvailable,
    sourceQueryWithinLimit,
    shouldQueryLinear,
    jiraSearchJql,
    shouldQueryJira,
    item,
    intent,
    query,
    target,
    branchSearchRequest,
  } = context

  useEffect(() => {
    if (!branchSearchRequest) {
      setBranches([])
      setBranchResultsSource(null)
      setBranchesLoading(false)
      return
    }
    let stale = false
    // Why: keep prior branch rows until this request settles; visibility already
    // holds the last list while the user types ahead of the debounced query.
    setBranchesLoading(true)
    void searchRuntimeRepoBaseRefDetails(
      selectedRepoOwnerSettings,
      branchSearchRequest.repoId,
      branchSearchRequest.query,
      branchSearchRequest.limit
    )
      .then((results) => {
        if (!stale) {
          setBranches(results)
          setBranchResultsSource({
            repoId: branchSearchRequest.repoId,
            query: branchSearchRequest.query
          })
        }
      })
      .catch(() => {
        if (!stale) {
          setBranches([])
          setBranchResultsSource(null)
        }
      })
      .finally(() => {
        if (!stale) {
          setBranchesLoading(false)
        }
      })
    return () => {
      stale = true
    }
  }, [branchSearchRequest, selectedRepoOwnerSettings])

  useEffect(() => {
    if (disabled || !shouldQueryLinear || !linearStatus.connected) {
      setLinearIssues([])
      setLinearLoading(false)
      return
    }
    let stale = false
    setLinearLoading(true)
    const trimmed = debouncedQuery.trim()
    // Why: empty-query list must not briefly paint the previous non-empty result set.
    if (trimmed === '') {
      setLinearIssues([])
    }
    const request = trimmed
      ? searchLinearIssues(trimmed, RESULT_LIMIT, { sourceContext: linearSourceContext })
      : listLinearIssues(
          { kind: 'list', filter: 'assigned', limit: RESULT_LIMIT },
          { sourceContext: linearSourceContext }
        ).then((result) => result.items)
    void request
      .then((issues) => {
        if (!stale) {
          setLinearIssues(issues)
        }
      })
      .catch(() => {
        if (!stale) {
          setLinearIssues([])
        }
      })
      .finally(() => {
        if (!stale) {
          setLinearLoading(false)
        }
      })
    return () => {
      stale = true
    }
    // Why: list/search are stable store methods; depending on them would refetch on unrelated store writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, disabled, linearSourceContext, linearStatus.connected, shouldQueryLinear])

  useEffect(() => {
    if (!shouldQueryJira || !jiraSourceContext || !jiraSearchJql) {
      setJiraIssues([])
      setJiraLoading(false)
      return
    }
    let stale = false
    // Why: a superseded query must release its slot in the shared Jira request pool immediately.
    const controller = new AbortController()
    setJiraLoading(true)
    const siteId =
      jiraConnectionStatus?.selectedSiteId ?? jiraConnectionStatus?.activeSiteId ?? null
    void searchJiraIssues(jiraSearchJql, RESULT_LIMIT, {
      sourceContext: jiraSourceContext,
      siteId,
      signal: controller.signal
    })
      .then((issues) => {
        if (!stale) {
          setJiraIssues(issues)
        }
      })
      .catch(() => {
        if (!stale) {
          setJiraIssues([])
        }
      })
      .finally(() => {
        if (!stale) {
          setJiraLoading(false)
        }
      })
    return () => {
      stale = true
      controller.abort()
    }
  }, [
    jiraConnectionStatus?.activeSiteId,
    jiraConnectionStatus?.selectedSiteId,
    jiraSearchJql,
    jiraSourceContext,
    searchJiraIssues,
    shouldQueryJira
  ])

  // Why: GitLab paste-URL flow; parseGitLabIssueOrMRLink filters non-GitLab URLs via the project-internal `/-/` separator.
  const parsedGlLink = useMemo(
    () => (sourceQueryWithinLimit ? parseGitLabIssueOrMRLink(debouncedQuery) : null),
    [debouncedQuery, sourceQueryWithinLimit]
  )
  const shouldQueryGitlab =
    sourceQueryWithinLimit &&
    !repoBackedSourcesDisabled &&
    !jiraSource.intent &&
    !textOnly &&
    gitlabSourceAvailable &&
    repoBackedSearchTargets.length > 0 &&
    (mode === 'smart' || mode === 'gitlab')
  useEffect(() => {
    if (!shouldQueryGitlab || disabled || !onGitLabItemSelect) {
      // Why: don't clobber list-mode items — the listMRs effect below is the sole writer in 'gitlab' mode without a URL.
      if (!shouldQueryGitlab || (parsedGlLink === null && mode !== 'gitlab')) {
        setGitlabItems([])
      }
      setGitlabLoading(false)
      return
    }
    if (parsedGlLink === null) {
      // Same reason: only clear when leaving the gitlab/smart context.
      if (mode !== 'gitlab') {
        setGitlabItems([])
      }
      setGitlabLoading(false)
      return
    }
    let stale = false
    setGitlabLoading(true)
    void Promise.all(
      repoBackedSearchTargets.map((target) =>
        lookupGitLabWorkItemByPathForSource({
          repoPath: target.repo.path,
          repoId: target.repo.id,
          sourceContext: target.gitlabSourceContext,
          // Why: self-hosted GitLab URLs must resolve against their pasted hostname, not gitlab.com.
          host: parsedGlLink.slug.host,
          path: parsedGlLink.slug.path,
          iid: parsedGlLink.number,
          type: parsedGlLink.type
        }).catch(() => null)
      )
    )
      .then((items) => {
        if (stale) {
          return
        }
        setGitlabItems(items.filter((item): item is GitLabWorkItem => item !== null))
      })
      .catch(() => {
        if (!stale) {
          setGitlabItems([])
        }
      })
      .finally(() => {
        if (!stale) {
          setGitlabLoading(false)
        }
      })
    return () => {
      stale = true
    }
  }, [disabled, mode, onGitLabItemSelect, parsedGlLink, repoBackedSearchTargets, shouldQueryGitlab])

  // Why: list the project's MRs by state chip when no URL pasted; default 'opened' matches gitlab.com's default MR view.
  useEffect(() => {
    if (!shouldQueryGitlab || disabled || !onGitLabItemSelect) {
      if (!shouldQueryGitlab) {
        setGitlabItems([])
        setGitlabLoading(false)
      }
      return
    }
    if (repoBackedSearchTargets.length === 0) {
      setGitlabItems([])
      setGitlabLoading(false)
      return
    }
    if (parsedGlLink !== null) {
      // Why: paste-URL effect owns the list while a URL is in the input.
      return
    }
    let stale = false
    setGitlabLoading(true)
    // Why: thread the typed query so the GitLab API filters MRs by name/number (shouldQueryGitlab already gates oversized queries).
    const trimmedQuery = debouncedQuery.trim() || undefined
    // Why: empty-query list must not briefly paint the previous non-empty result set.
    if (trimmedQuery === undefined) {
      setGitlabItems([])
    }
    void Promise.all(
      repoBackedSearchTargets.map((target) =>
        listGitLabMRsForSource({
          repoPath: target.repo.path,
          repoId: target.repo.id,
          sourceContext: target.gitlabSourceContext,
          state: mrStateFilter,
          page: 1,
          perPage: RESULT_LIMIT,
          query: trimmedQuery
        }).catch(() => ({ items: [], hasMore: false }))
      )
    )
      .then((results) => {
        if (stale) {
          return
        }
        setGitlabItems(
          results
            .flatMap((result) => result.items)
            .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
            .slice(0, RESULT_LIMIT)
        )
      })
      .catch(() => {
        if (!stale) {
          setGitlabItems([])
        }
      })
      .finally(() => {
        if (!stale) {
          setGitlabLoading(false)
        }
      })
    return () => {
      stale = true
    }
  }, [
    debouncedQuery,
    disabled,
    mode,
    mrStateFilter,
    onGitLabItemSelect,
    parsedGlLink,
    repoBackedSearchTargets,
    shouldQueryGitlab
  ])

}
