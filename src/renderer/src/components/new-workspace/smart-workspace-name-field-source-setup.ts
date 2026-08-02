// Concrete smart workspace name field view and source orchestration.
// Concrete surface implementation for SmartWorkspaceNameField.tsx
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: this component's existing reset effects need a dedicated refactor outside the Linear API compatibility change. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useShallow } from 'zustand/react/shallow'
import { useAppStore } from '@/store'
import {
  normalizeGitHubLinkQuery,
  parseGitHubIssueOrPRLink,
  type RepoSlug
} from '@/lib/github-links'
import { getLocalPreflightContext, localPreflightContextKey } from '@/lib/local-preflight-context'
import { getRepoOwnerRoutedSettings } from '@/lib/repo-runtime-owner'
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
import { filterAvailableTaskProviders } from '../../../../shared/task-providers'
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
  getMrStateFilters,
  getSmartWorkspaceNameModes,
  type MrStateFilter
} from './smart-workspace-localized-options'
import {
  buildTaskSourceContextFromRepo,
  getTaskSourceCacheScope,
  type TaskSourceContext
} from '../../../../shared/task-source-context'
import { useJiraSourceConnection } from './use-jira-source-connection'
import {
  bindJiraIssueSourceContext,
  useJiraUrlSource,
  type JiraUrlSourceState
} from './use-jira-url-source'
import type { RepoOption } from './smart-workspace-name-field-source-view'


export function useSmartWorkspaceNameFieldSourceSetup(context: Record<string, any>): Record<string, any> {
  const {
    repos,
    repoId,
    onRepoChange,
    value,
    onValueChange,
    onGitHubItemSelect,
    onGitLabItemSelect,
    onBranchSelect,
    onLinearIssueSelect,
    onJiraIssueSelect,
    onOpenJiraSettings,
    selectedSource,
    onClearSelectedSource,
    githubSourceContextOverride,
    jiraSourceContext,
    inputRef,
    onPlainEnter,
    disabled,
    disabledPlaceholder,
    textOnly,
    branchesEnabled,
    repoBackedSourcesDisabled,
    repoBackedSearchRepos,
    allowCrossRepoProjectAdd,
    crossRepoSwitchTarget,
    onActiveSourceModeChange,
    canUseGitLabSmartSource,
    EMPTY_REPO_SEARCH_REPOS,
    SEARCH_DEBOUNCE_MS,
    RESULT_LIMIT,
  } = context

  // Why: subscribe so translate()-based tab/filter labels refresh on language change without a remount.
  useTranslation()
  const {
    addRepo,
    checkLinearConnection,
    fetchWorkItems,
    fetchWorkItemsAcrossRepos,
    getCachedWorkItems,
    linearStatus,
    linearStatusChecked,
    listLinearIssues,
    preflightStatus,
    preflightStatusChecked,
    preflightStatusContextKey,
    expectedPreflightContextKey,
    refreshPreflightStatus,
    searchJiraIssues,
    searchLinearIssues,
    settings
  } = useAppStore(
    useShallow((s) => ({
      addRepo: s.addRepo,
      checkLinearConnection: s.checkLinearConnection,
      fetchWorkItems: s.fetchWorkItems,
      fetchWorkItemsAcrossRepos: s.fetchWorkItemsAcrossRepos,
      getCachedWorkItems: s.getCachedWorkItems,
      linearStatus: s.linearStatus,
      linearStatusChecked: s.linearStatusChecked,
      listLinearIssues: s.listLinearIssues,
      preflightStatus: s.preflightStatus,
      preflightStatusChecked: s.preflightStatusChecked,
      preflightStatusContextKey: s.preflightStatusContextKey,
      expectedPreflightContextKey: localPreflightContextKey(getLocalPreflightContext(s)),
      refreshPreflightStatus: s.refreshPreflightStatus,
      searchJiraIssues: s.searchJiraIssues,
      searchLinearIssues: s.searchLinearIssues,
      settings: s.settings
    }))
  )
  const selectedRepo = useMemo(
    () => repos.find((repo) => repo.id === repoId) ?? null,
    [repoId, repos]
  )
  const selectedRepoOwnerSettings = useMemo(
    () => getRepoOwnerRoutedSettings(settings, selectedRepo),
    [selectedRepo, settings]
  )
  const githubSourceContext = useMemo(() => {
    if (githubSourceContextOverride?.provider === 'github') {
      return githubSourceContextOverride
    }
    return selectedRepo
      ? buildTaskSourceContextFromRepo({
          provider: 'github',
          projectId: selectedRepo.id,
          repo: selectedRepo
        })
      : null
  }, [githubSourceContextOverride, selectedRepo])
  const gitlabSourceContext = useMemo(
    () =>
      selectedRepo
        ? buildTaskSourceContextFromRepo({
            provider: 'gitlab',
            projectId: selectedRepo.id,
            repo: selectedRepo
          })
        : null,
    [selectedRepo]
  )
  const repoBackedSearchTargets = useMemo(
    () =>
      (repoBackedSearchRepos.length > 0
        ? repoBackedSearchRepos
        : selectedRepo
          ? [selectedRepo]
          : []
      ).map((repo) => ({
        repo,
        githubSourceContext:
          repo.id === selectedRepo?.id && githubSourceContext?.provider === 'github'
            ? githubSourceContext
            : buildTaskSourceContextFromRepo({
                provider: 'github',
                projectId: repo.id,
                repo
              }),
        gitlabSourceContext:
          repo.id === selectedRepo?.id && gitlabSourceContext?.provider === 'gitlab'
            ? gitlabSourceContext
            : buildTaskSourceContextFromRepo({
                provider: 'gitlab',
                projectId: repo.id,
                repo
              })
      })),
    [githubSourceContext, gitlabSourceContext, repoBackedSearchRepos, selectedRepo]
  )
  const linearSourceContext = useMemo(
    () =>
      selectedRepo
        ? buildTaskSourceContextFromRepo({
            provider: 'linear',
            projectId: selectedRepo.id,
            repo: selectedRepo
          })
        : null,
    [selectedRepo]
  )
  const [mode, setMode] = useState<SmartNameMode>(textOnly ? 'text' : 'smart')
  const [mrStateFilter, setMrStateFilter] = useState<MrStateFilter>('opened')
  const [open, setOpen] = useState(false)
  const [debouncedQuery, setDebouncedQuery] = useState(value)
  const [githubItems, setGithubItems] = useState<GitHubWorkItem[]>([])
  const [gitlabItems, setGitlabItems] = useState<GitLabWorkItem[]>([])
  const [branches, setBranches] = useState<BaseRefSearchResult[]>([])
  const [branchResultsSource, setBranchResultsSource] = useState<{
    repoId: string
    query: string
  } | null>(null)
  const [linearIssues, setLinearIssues] = useState<LinearIssue[]>([])
  const [jiraIssues, setJiraIssues] = useState<JiraIssue[]>([])
  const [githubLoading, setGithubLoading] = useState(false)
  const [gitlabLoading, setGitlabLoading] = useState(false)
  const [branchesLoading, setBranchesLoading] = useState(false)
  const [linearLoading, setLinearLoading] = useState(false)
  const [jiraLoading, setJiraLoading] = useState(false)
  const [commandValue, setCommandValue] = useState('')
  const [emojiCommandValue, setEmojiCommandValue] = useState('')
  const [emojiCursor, setEmojiCursor] = useState<number | null>(null)
  const localInputRef = useRef<HTMLInputElement | null>(null)
  const focusedSelectedSourceKeyRef = useRef<string | null>(null)
  const tabsListRef = useRef<HTMLDivElement | null>(null)
  const repoSlugCacheRef = useRef<Map<string, RepoSlug>>(new Map())
  const handledCrossRepoUrlRef = useRef<string | null>(null)
  const localInputFocusFrameRef = useRef<number | null>(null)
  // Why: Electron makes programmatic .focus() look user-initiated, so gate the source popover until real interaction.
  const deferSourcePopoverUntilInteractionRef = useRef(true)
  const [crossRepoPrompt, setCrossRepoPrompt] = useState<{
    link: NonNullable<ReturnType<typeof parseGitHubIssueOrPRLink>>
    matchingRepo: RepoOption | null
  } | null>(null)
  // Why: read Jira status when the composer mounts so an already-configured source is available
  // before users start typing, without showing Jira for hosts where it is not configured.
  const jiraConnection = useJiraSourceConnection({
    enabled: !disabled && !textOnly && jiraSourceContext !== null,
    sourceContext: jiraSourceContext
  })
  const jiraConnectionStatus = jiraConnection.status
  const jiraSource = useJiraUrlSource({
    value,
    enabled:
      !disabled && !textOnly && (mode === 'smart' || mode === 'jira') && selectedSource === null,
    sourceContext: jiraSourceContext,
    connection: jiraConnection
  })
  const jiraSourceConnected = jiraConnectionStatus?.connected === true
  const showJiraSiteContext = mode === 'jira' && jiraConnectionStatus?.selectedSiteId === 'all'
  const jiraStatusId = React.useId()

  useEffect(() => {
    onActiveSourceModeChange?.(mode)
  }, [mode, onActiveSourceModeChange])
  const preflightStatusCurrent = preflightStatusContextKey === expectedPreflightContextKey
  const localGitlabAvailable = preflightStatusCurrent && preflightStatus?.glab?.installed === true
  const gitlabSourceAvailable = repoBackedSearchTargets.some((target) =>
    canUseGitLabSmartSource({
      localGitlabAvailable,
      repoBackedSourcesDisabled,
      sourceHostId: target.gitlabSourceContext?.hostId
    })
  )
  const availableTaskProviders = useMemo(
    () =>
      filterAvailableTaskProviders(['github', 'gitlab', 'linear'], {
        gitlabInstalled: gitlabSourceAvailable,
        linearConnected: linearStatus.connected === true
      }),
    [gitlabSourceAvailable, linearStatus.connected]
  )
  const linearAvailable = availableTaskProviders.includes('linear')
  const availableModes = getSmartWorkspaceNameModes().filter((item) => {
    if (textOnly) {
      return item.id === 'text'
    }
    if (item.id === 'github') {
      return !repoBackedSourcesDisabled
    }
    if (item.id === 'gitlab') {
      return gitlabSourceAvailable
    }
    if (item.id === 'linear') {
      return linearAvailable
    }
    if (item.id === 'jira') {
      return jiraSourceConnected
    }
    if (item.id === 'branches') {
      return branchesEnabled && !repoBackedSourcesDisabled
    }
    return true
  })
  const mrStateFilters = getMrStateFilters()

  useEffect(() => {
    if (availableModes.some((item) => item.id === mode)) {
      return
    }
    setMode(availableModes[0]?.id ?? 'text')
  }, [availableModes, mode])

  useEffect(() => {
    if (!repoBackedSourcesDisabled) {
      return
    }
    setGithubItems([])
    setGitlabItems([])
    setBranches([])
    setGithubLoading(false)
    setGitlabLoading(false)
    setBranchesLoading(false)
    setBranchResultsSource(null)
    setCrossRepoPrompt(null)
  }, [repoBackedSourcesDisabled])

  const selectedSourceFocusKey = selectedSource
    ? `${selectedSource.kind}:${selectedSource.label}:${selectedSource.url ?? ''}`
    : null
  const setSelectedSourceNode = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) {
        focusedSelectedSourceKeyRef.current = null
        return
      }
      if (
        !selectedSourceFocusKey ||
        focusedSelectedSourceKeyRef.current === selectedSourceFocusKey
      ) {
        return
      }
      focusedSelectedSourceKeyRef.current = selectedSourceFocusKey
      // Why: input unmounts after Enter accepts a row; move focus to the pill so the next Enter advances to Agent.
      node.focus({ preventScroll: true })
    },
    [selectedSourceFocusKey]
  )

  const cancelLocalInputFocusFrame = useCallback((): void => {
    if (localInputFocusFrameRef.current === null) {
      return
    }
    cancelAnimationFrame(localInputFocusFrameRef.current)
    localInputFocusFrameRef.current = null
  }, [])

  const markSourcePopoverUserEngaged = useCallback((): void => {
    deferSourcePopoverUntilInteractionRef.current = false
  }, [])

  const tryOpenSourcePopover = useCallback((): void => {
    if (disabled || mode === 'text' || deferSourcePopoverUntilInteractionRef.current) {
      return
    }
    setOpen(true)
  }, [disabled, mode])

  const handleSourcePopoverOpenChange = useCallback(
    (next: boolean): void => {
      if (disabled || selectedSource) {
        setOpen(false)
        return
      }
      if (next && deferSourcePopoverUntilInteractionRef.current) {
        return
      }
      setOpen(next)
    },
    [disabled, selectedSource]
  )

  const setInputNode = useCallback(
    (node: HTMLInputElement | null) => {
      if (node === null) {
        cancelLocalInputFocusFrame()
      }
      localInputRef.current = node
      if (inputRef) {
        inputRef.current = node
      }
    },
    [cancelLocalInputFocusFrame, inputRef]
  )

  useEffect(() => {
    if (disabled || textOnly) {
      return
    }
    if (!preflightStatusChecked || !preflightStatusCurrent) {
      void refreshPreflightStatus()
    }
    if (!linearStatusChecked) {
      void checkLinearConnection()
    }
  }, [
    checkLinearConnection,
    disabled,
    linearStatusChecked,
    preflightStatusChecked,
    preflightStatusCurrent,
    refreshPreflightStatus,
    textOnly
  ])

  useEffect(() => {
    if (textOnly) {
      if (mode !== 'text') {
        setMode('text')
      }
      setOpen(false)
      return
    }
    if ((mode === 'gitlab' && gitlabSourceAvailable) || (mode === 'linear' && linearAvailable)) {
      return
    }
    if (mode !== 'gitlab' && mode !== 'linear') {
      return
    }
    setMode('smart')
    setGitlabItems([])
    setLinearIssues([])
    setJiraIssues([])
    setGitlabLoading(false)
    setLinearLoading(false)
    setJiraLoading(false)
    setCommandValue('')
  }, [gitlabSourceAvailable, linearAvailable, mode, textOnly])

  useEffect(() => {
    if (!disabled) {
      return
    }
    setOpen(false)
    setGithubItems([])
    setGitlabItems([])
    setBranches([])
    setBranchResultsSource(null)
    setLinearIssues([])
    setJiraIssues([])
    setGithubLoading(false)
    setGitlabLoading(false)
    setBranchesLoading(false)
    setLinearLoading(false)
    setJiraLoading(false)
    setCommandValue('')
    setCrossRepoPrompt(null)
  }, [disabled])

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(value), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [value])

  return {
    selectedRepo,
    selectedRepoOwnerSettings,
    githubSourceContext,
    gitlabSourceContext,
    repoBackedSearchTargets,
    linearSourceContext,
    mode,
    setMode,
    mrStateFilter,
    setMrStateFilter,
    open,
    setOpen,
    debouncedQuery,
    githubItems,
    setGithubItems,
    gitlabItems,
    setGitlabItems,
    branches,
    setBranches,
    branchResultsSource,
    setBranchResultsSource,
    linearIssues,
    setLinearIssues,
    jiraIssues,
    setJiraIssues,
    githubLoading,
    setGithubLoading,
    gitlabLoading,
    setGitlabLoading,
    branchesLoading,
    setBranchesLoading,
    linearLoading,
    setLinearLoading,
    jiraLoading,
    setJiraLoading,
    commandValue,
    setCommandValue,
    emojiCommandValue,
    setEmojiCommandValue,
    emojiCursor,
    setEmojiCursor,
    localInputRef,
    tabsListRef,
    repoSlugCacheRef,
    handledCrossRepoUrlRef,
    localInputFocusFrameRef,
    crossRepoPrompt,
    setCrossRepoPrompt,
    jiraConnectionStatus,
    jiraSource,
    jiraSourceConnected,
    showJiraSiteContext,
    jiraStatusId,
    gitlabSourceAvailable,
    linearAvailable,
    availableModes,
    mrStateFilters,
    setSelectedSourceNode,
    cancelLocalInputFocusFrame,
    markSourcePopoverUserEngaged,
    tryOpenSourcePopover,
    handleSourcePopoverOpenChange,
    setInputNode,  }
}
