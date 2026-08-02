// Concrete smart workspace name field view and source orchestration.
// Concrete surface implementation for SmartWorkspaceNameField.tsx
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: this component's existing reset effects need a dedicated refactor outside the Linear API compatibility change. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAppStore } from '@/store'
import {
  normalizeGitHubLinkQuery,
  parseGitHubIssueOrPRLink,
  type RepoSlug
} from '@/lib/github-links'
import {
  lookupGitHubWorkItemByOwnerRepoForSource,
  lookupGitHubWorkItemForSource
} from '@/lib/github-work-item-source-lookup'
import { lookupSmartGitHubSubmitItem } from '@/lib/smart-github-submit'
import { cn } from '@/lib/utils'
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


export function useSmartWorkspaceGitHubSearch(context: Record<string, any>): void {
  const {
    selectedRepo,
    githubSourceContext,
    repoBackedSearchTargets,
    setOpen,
    debouncedQuery,
    setGithubItems,
    setGithubLoading,
    repoSlugCacheRef,
    handledCrossRepoUrlRef,
    setCrossRepoPrompt,
    normalizedGhQuery,
    parsedGhLink,
    shouldQueryGithub,
  } = context

  useEffect(() => {
    if (disabled || !shouldQueryGithub) {
      setGithubItems([])
      setGithubLoading(false)
      return
    }
    let stale = false
    // Why: empty-query search must not briefly paint the previous non-empty result set
    // once debounce catches a cleared field.
    if (debouncedQuery.trim() === '') {
      setGithubItems([])
    }
    const directNumber = normalizedGhQuery.directNumber
    const directLink = parsedGhLink
    if (directLink !== null && handledCrossRepoUrlRef.current !== debouncedQuery.trim()) {
      setGithubLoading(true)
      const directLookup = async (): Promise<{
        items: GitHubWorkItem[]
        prompt: {
          link: NonNullable<ReturnType<typeof parseGitHubIssueOrPRLink>>
          matchingRepo: RepoOption | null
        } | null
      }> => {
        if (crossRepoSwitchTarget === 'task-source') {
          const matchingTarget = await findMatchingRepoForSlug(
            repoBackedSearchTargets.map((target) => ({
              repo: target.repo,
              sourceContext: target.githubSourceContext
            })),
            directLink.slug,
            repoSlugCacheRef.current
          )
          if (!matchingTarget) {
            return { items: [], prompt: null }
          }
          const item = await lookupGitHubWorkItemByOwnerRepoForSource({
            repoPath: matchingTarget.repo.path,
            repoId: matchingTarget.repo.id,
            sourceContext: matchingTarget.sourceContext,
            owner: directLink.slug.owner,
            repo: directLink.slug.repo,
            ...(directLink.slug.host ? { host: directLink.slug.host } : {}),
            number: directLink.number,
            type: directLink.type
          })
          // Why: only suppress re-tries once resolution succeeded — a transient
          // GHES slug failure (matchingTarget === null) must stay retryable.
          handledCrossRepoUrlRef.current = debouncedQuery.trim()
          return {
            items: item ? [{ ...item, repoId: matchingTarget.repo.id } as GitHubWorkItem] : [],
            prompt: null
          }
        }
        if (!selectedRepo?.path) {
          return { items: [], prompt: null }
        }
        const selectedSlug = await getRepoSlugCached(
          selectedRepo,
          githubSourceContext,
          repoSlugCacheRef.current
        )
        if (!selectedSlug || sameSlug(selectedSlug, directLink.slug)) {
          handledCrossRepoUrlRef.current = debouncedQuery.trim()
          const item = await lookupSmartGitHubSubmitItem({
            repoPath: selectedRepo.path,
            repoId: selectedRepo.id,
            sourceContext: githubSourceContext,
            intent: {
              kind: 'link',
              owner: directLink.slug.owner,
              repo: directLink.slug.repo,
              ...(directLink.slug.host ? { host: directLink.slug.host } : {}),
              number: directLink.number,
              type: directLink.type
            },
            workItem: lookupGitHubWorkItemForSource,
            workItemByOwnerRepo: lookupGitHubWorkItemByOwnerRepoForSource
          })
          return { items: item ? [item] : [], prompt: null }
        }
        const matchingTarget = await findMatchingRepoForSlug(
          repos.map((repo) => ({
            repo,
            sourceContext: buildTaskSourceContextFromRepo({
              provider: 'github',
              projectId: repo.id,
              repo
            })
          })),
          directLink.slug,
          repoSlugCacheRef.current
        )
        return {
          items: [],
          prompt: { link: directLink, matchingRepo: matchingTarget?.repo ?? null }
        }
      }
      void directLookup()
        .then((result) => {
          if (stale) {
            return
          }
          setGithubItems(result.items)
          if (result.prompt) {
            setOpen(false)
            setCrossRepoPrompt(result.prompt)
          }
        })
        .catch(() => {
          if (!stale) {
            setGithubItems([])
          }
        })
        .finally(() => {
          if (!stale) {
            setGithubLoading(false)
          }
        })
      return () => {
        stale = true
      }
    }
    if (directNumber !== null) {
      setGithubLoading(true)
      const intent =
        directLink !== null
          ? {
              kind: 'link' as const,
              owner: directLink.slug.owner,
              repo: directLink.slug.repo,
              ...(directLink.slug.host ? { host: directLink.slug.host } : {}),
              number: directLink.number,
              type: directLink.type
            }
          : { kind: 'hash-number' as const, number: directNumber }
      const request = Promise.all(
        repoBackedSearchTargets.map((target) =>
          lookupSmartGitHubSubmitItem({
            repoPath: target.repo.path,
            repoId: target.repo.id,
            sourceContext: target.githubSourceContext,
            intent,
            workItem: lookupGitHubWorkItemForSource,
            workItemByOwnerRepo: lookupGitHubWorkItemByOwnerRepoForSource
          }).catch(() => null)
        )
      ).then((items) =>
        items
          .filter((item): item is GitHubWorkItem => item !== null)
          .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
          .slice(0, RESULT_LIMIT)
      )
      void request
        .then((items) => {
          if (!stale) {
            setGithubItems(items)
          }
        })
        .catch(() => {
          if (!stale) {
            setGithubItems([])
          }
        })
        .finally(() => {
          if (!stale) {
            setGithubLoading(false)
          }
        })
      return () => {
        stale = true
      }
    }

    const trimmed = normalizedGhQuery.query.trim()
    const query = trimmed ? normalizedGhQuery.query : ''
    if (repoBackedSearchTargets.length === 1) {
      const target = repoBackedSearchTargets[0]
      const cached = getCachedWorkItems(
        target.repo.id,
        RESULT_LIMIT,
        query,
        target.repo.path,
        target.githubSourceContext
      )
      if (cached) {
        setGithubItems(cached.slice(0, RESULT_LIMIT))
        setGithubLoading(false)
      } else {
        setGithubLoading(true)
      }
      void fetchWorkItems(target.repo.id, target.repo.path, RESULT_LIMIT, query, {
        sourceContext: target.githubSourceContext
      })
        .then((items) => {
          if (!stale) {
            setGithubItems(items.slice(0, RESULT_LIMIT))
          }
        })
        .catch(() => {
          if (!stale) {
            setGithubItems([])
          }
        })
        .finally(() => {
          if (!stale) {
            setGithubLoading(false)
          }
        })
    } else {
      setGithubLoading(true)
      void fetchWorkItemsAcrossRepos(
        repoBackedSearchTargets.map((target) => ({
          repoId: target.repo.id,
          path: target.repo.path,
          executionHostId: target.repo.executionHostId,
          sourceContext: target.githubSourceContext
        })),
        RESULT_LIMIT,
        RESULT_LIMIT,
        query
      )
        .then((result) => {
          if (!stale) {
            setGithubItems(result.items)
          }
        })
        .catch(() => {
          if (!stale) {
            setGithubItems([])
          }
        })
        .finally(() => {
          if (!stale) {
            setGithubLoading(false)
          }
        })
    }
    return () => {
      stale = true
    }
  }, [
    debouncedQuery,
    disabled,
    fetchWorkItems,
    fetchWorkItemsAcrossRepos,
    getCachedWorkItems,
    normalizedGhQuery,
    parsedGhLink,
    repos,
    repoBackedSearchTargets,
    githubSourceContext,
    selectedRepo,
    crossRepoSwitchTarget,
    shouldQueryGithub
  ])

}
