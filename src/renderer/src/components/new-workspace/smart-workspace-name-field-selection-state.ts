import { useCallback, useMemo } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { resolveSmartWorkspaceCommandValue } from './smart-workspace-command-value'
import {
  buildJiraIssueSearchJql,
  buildSmartWorkspaceSourceRows,
  getSmartWorkspaceEmptyHint,
  getVisibleBranchResults,
  getVisibleHeldProviderResults,
  isBlockingJiraUrlIntent,
  isSmartWorkspaceSourceQueryWithinLimit,
  type SmartWorkspaceSourceRow
} from './smart-workspace-source-results'
import { parseGitHubIssueOrPRLink } from '@/lib/github-links'
import { parseGitLabIssueOrMRLink } from '@/lib/gitlab-links'
import { getRepoSlugCached } from './smart-workspace-name-field-presentation'
import {
  applyWorkspaceEmojiSuggestion,
  getActiveWorkspaceEmojiShortcode,
  replaceCompletedWorkspaceEmojiShortcode,
  searchWorkspaceEmojiShortcodes,
  type WorkspaceEmojiReplacement,
  type WorkspaceEmojiSuggestion
} from '@/lib/workspace-emoji-shortcodes'
import type { RowEntry } from './smart-workspace-name-field-source-view'
import type { RepoOption } from './smart-workspace-name-field-source-view'

export function useSmartWorkspaceNameSelection(context: Record<string, any>): Record<string, any> {
  const {
    selectedRepo,
    mode,
    setOpen,
    debouncedQuery,
    githubItems,
    gitlabItems,
    branches,
    branchResultsSource,
    linearIssues,
    jiraIssues,
    githubLoading,
    setGithubLoading,
    gitlabLoading,
    branchesLoading,
    linearLoading,
    jiraLoading,
    commandValue,
    setCommandValue,
    emojiCommandValue,
    emojiCursor,
    setEmojiCursor,
    localInputRef,
    repoSlugCacheRef,
    handledCrossRepoUrlRef,
    localInputFocusFrameRef,
    crossRepoPrompt,
    setCrossRepoPrompt,
    jiraConnectionStatus,
    jiraSource,
    gitlabSourceAvailable,
    linearAvailable,
    cancelLocalInputFocusFrame,
  } = context

  const rows = useMemo<RowEntry[]>(() => {
    if (jiraSource.intent && jiraSource.accountChoices.length > 0) {
      return jiraSource.accountChoices.map((site) => ({
        kind: 'jira-account' as const,
        value: `jira-account-${site.id}`,
        site
      }))
    }
    return buildSmartWorkspaceSourceRows({
      branches: getVisibleBranchResults({
        branches,
        mode,
        resultRepoId: branchResultsSource?.repoId ?? null,
        resultQuery: branchResultsSource?.query ?? null,
        selectedRepoId: selectedRepo?.id ?? null,
        value
      }),
      githubItems: getVisibleHeldProviderResults({
        items: githubItems,
        value,
        debouncedQuery
      }),
      gitlabAvailable: gitlabSourceAvailable,
      gitlabItems: getVisibleHeldProviderResults({
        items: gitlabItems,
        value,
        debouncedQuery
      }),
      jiraIntent: jiraSource.intent,
      jiraIssue: jiraSource.issue,
      jiraIssues: getVisibleHeldProviderResults({
        items: jiraIssues,
        value,
        debouncedQuery
      }),
      linearAvailable,
      linearIssues: getVisibleHeldProviderResults({
        items: linearIssues,
        value,
        debouncedQuery
      }),
      mode,
      resultLimit: RESULT_LIMIT,
      value
    })
  }, [
    branches,
    branchResultsSource,
    debouncedQuery,
    githubItems,
    gitlabSourceAvailable,
    gitlabItems,
    jiraSource.accountChoices,
    jiraSource.intent,
    jiraSource.issue,
    jiraIssues,
    linearAvailable,
    linearIssues,
    mode,
    selectedRepo?.id,
    value
  ])
  const { typedTextActionRow, searchResultRows } = useMemo(() => {
    const typedTextRow = rows.find(isTypedTextSourceRow) ?? null
    return {
      typedTextActionRow: typedTextRow,
      searchResultRows: typedTextRow ? rows.filter((row) => row !== typedTextRow) : rows
    }
  }, [rows])

  // Why: live input leads debounced search; freeze highlight until the query catches up.
  const valueWithinSourceLimit = isSmartWorkspaceSourceQueryWithinLimit(value)
  const debouncedQueryWithinSourceLimit = isSmartWorkspaceSourceQueryWithinLimit(debouncedQuery)
  const trimmedValue = valueWithinSourceLimit ? value.trim() : ''
  const trimmedDebouncedQuery = debouncedQueryWithinSourceLimit ? debouncedQuery.trim() : ''
  const isQueryStale = trimmedValue.length > 0 && trimmedDebouncedQuery !== trimmedValue

  // Why: when the typed value is an unambiguous source ref, snap the highlight to that row so Enter picks it over the typed-text fallback.
  const sourceIntent = useMemo<'github' | 'gitlab' | 'linear' | 'jira' | null>(() => {
    if (!isSmartWorkspaceSourceQueryWithinLimit(value)) {
      return null
    }
    const trimmed = value.trim()
    if (!trimmed) {
      return null
    }
    if (jiraSource.intent) {
      return 'jira'
    }
    if (/^#\d+$/.test(trimmed) || parseGitHubIssueOrPRLink(trimmed) !== null) {
      return 'github'
    }
    if (parseGitLabIssueOrMRLink(trimmed) !== null) {
      return 'gitlab'
    }
    if (linearAvailable && /^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(trimmed)) {
      return 'linear'
    }
    return null
  }, [jiraSource.intent, linearAvailable, value])

  const resolvedCommandValue = resolveSmartWorkspaceCommandValue({
    currentValue: commandValue,
    rows,
    isQueryStale,
    sourceIntent
  })
  // Why: while isQueryStale, cmdk onValueChange is ignored; re-sync the stored arm
  // when the query settles so commandValue cannot lag resolvedCommandValue.
  useEffect(() => {
    if (isQueryStale || commandValue === resolvedCommandValue) {
      return
    }
    setCommandValue(resolvedCommandValue)
  }, [commandValue, isQueryStale, resolvedCommandValue])
  const activeEmojiShortcode = useMemo(
    () => getActiveWorkspaceEmojiShortcode(value, emojiCursor),
    [emojiCursor, value]
  )
  const emojiSuggestions = useMemo(
    () =>
      activeEmojiShortcode
        ? searchWorkspaceEmojiShortcodes(activeEmojiShortcode.query)
        : ([] as WorkspaceEmojiSuggestion[]),
    [activeEmojiShortcode]
  )
  const emojiMenuOpen =
    !disabled &&
    selectedSource === null &&
    activeEmojiShortcode !== null &&
    emojiSuggestions.length > 0
  const resolvedEmojiCommandValue = emojiSuggestions.some(
    (suggestion) => `emoji:${suggestion.shortcode}` === emojiCommandValue
  )
    ? emojiCommandValue
    : emojiSuggestions[0]
      ? `emoji:${emojiSuggestions[0].shortcode}`
      : ''
  const selectedEmojiSuggestion =
    emojiSuggestions.find(
      (suggestion) => `emoji:${suggestion.shortcode}` === resolvedEmojiCommandValue
    ) ?? null

  const loading = jiraSource.intent
    ? jiraSource.loading
    : githubLoading || gitlabLoading || branchesLoading || linearLoading || jiraLoading
  // Why: only spin on first load — not on every in-flight refresh while rows stay visible.
  const showSearchSpinner = loading && searchResultRows.length === 0
  const ActiveInputIcon =
    mode === 'text' ? CaseSensitive : showSearchSpinner ? LoaderCircle : Search
  const selectJiraAccount = jiraSource.selectAccount
  const jiraBoundSourceContext = jiraSource.boundSourceContext

  const handleSelect = useCallback(
    (row: RowEntry) => {
      if (row.kind === 'jira-account') {
        selectJiraAccount(row.site.id)
        return
      }
      // Why: select what is shown — held provider rows stay visible while the
      // query is ahead of debounce, so blocking them made click/Enter no-ops.
      if (row.kind === 'use-name' || row.kind === 'create-branch') {
        // Why: "create new branch" has no ref to base from, so it uses the typed-name path (default base).
        onValueChange(row.name)
      } else if (row.kind === 'github') {
        onGitHubItemSelect(row.item)
      } else if (row.kind === 'gitlab') {
        // Why: optional handler — guarded so it no-ops for hosts without GitLab support.
        onGitLabItemSelect?.(row.item)
      } else if (row.kind === 'branch') {
        onBranchSelect(row.refName, row.localBranchName)
      } else if (row.kind === 'jira') {
        const sites = jiraConnectionStatus?.sites ?? []
        const site =
          sites.find((candidate) => candidate.id === row.issue.siteId) ??
          (sites.length === 1 ? sites[0] : null)
        const sourceContext =
          jiraBoundSourceContext ??
          (jiraSourceContext && site
            ? bindJiraIssueSourceContext(jiraSourceContext, site, row.issue)
            : null)
        if (!sourceContext) {
          // Why: closing without accept left users thinking the issue was linked.
          toast.error(
            translate(
              'auto.components.new.workspace.SmartWorkspaceNameField.jiraSelectBindFailed',
              'Couldn’t link this Jira issue. Pick the matching site or reconnect Jira, then try again.'
            )
          )
          return
        }
        onJiraIssueSelect?.(row.issue, sourceContext)
      } else {
        onLinearIssueSelect(row.issue)
      }
      setOpen(false)
    },
    [
      jiraBoundSourceContext,
      jiraConnectionStatus?.sites,
      jiraSourceContext,
      onBranchSelect,
      onGitHubItemSelect,
      onGitLabItemSelect,
      onJiraIssueSelect,
      onLinearIssueSelect,
      onValueChange,
      selectJiraAccount
    ]
  )

  const applyEmojiReplacement = useCallback(
    (replacement: WorkspaceEmojiReplacement): void => {
      onValueChange(replacement.value)
      setEmojiCursor(null)
      cancelLocalInputFocusFrame()
      localInputFocusFrameRef.current = requestAnimationFrame(() => {
        localInputFocusFrameRef.current = null
        localInputRef.current?.focus({ preventScroll: true })
        localInputRef.current?.setSelectionRange(replacement.cursor, replacement.cursor)
      })
    },
    [cancelLocalInputFocusFrame, onValueChange]
  )

  const handleEmojiSelect = useCallback(
    (suggestion: WorkspaceEmojiSuggestion): void => {
      if (!activeEmojiShortcode) {
        return
      }
      applyEmojiReplacement(applyWorkspaceEmojiSuggestion(value, activeEmojiShortcode, suggestion))
    },
    [activeEmojiShortcode, applyEmojiReplacement, value]
  )

  const acceptGitHubLink = useCallback(
    async (targetRepo: RepoOption): Promise<void> => {
      if (!crossRepoPrompt) {
        return
      }
      handledCrossRepoUrlRef.current = debouncedQuery.trim()
      setGithubLoading(true)
      try {
        const sourceContext = buildTaskSourceContextFromRepo({
          provider: 'github',
          projectId: targetRepo.id,
          repo: targetRepo
        })
        const item = await lookupGitHubWorkItemByOwnerRepoForSource({
          repoPath: targetRepo.path,
          repoId: targetRepo.id,
          sourceContext,
          owner: crossRepoPrompt.link.slug.owner,
          repo: crossRepoPrompt.link.slug.repo,
          ...(crossRepoPrompt.link.slug.host ? { host: crossRepoPrompt.link.slug.host } : {}),
          number: crossRepoPrompt.link.number,
          type: crossRepoPrompt.link.type
        })
        if (!item) {
          return
        }
        onRepoChange(targetRepo.id)
        onGitHubItemSelect({ ...item, repoId: targetRepo.id } as GitHubWorkItem)
        setOpen(false)
        setCrossRepoPrompt(null)
      } finally {
        setGithubLoading(false)
      }
    },
    [crossRepoPrompt, debouncedQuery, onGitHubItemSelect, onRepoChange]
  )

  const handleUseCurrentRepo = useCallback(async (): Promise<void> => {
    if (!selectedRepo) {
      return
    }
    setCrossRepoPrompt(null)
    await acceptGitHubLink(selectedRepo)
  }, [acceptGitHubLink, selectedRepo])

  const handleAddMatchingRepo = useCallback(async (): Promise<void> => {
    if (!crossRepoPrompt || !allowCrossRepoProjectAdd) {
      return
    }
    const added = await addRepo()
    if (!added) {
      return
    }
    const sourceContext = buildTaskSourceContextFromRepo({
      provider: 'github',
      projectId: added.id,
      repo: added
    })
    const slug = await getRepoSlugCached(added, sourceContext, repoSlugCacheRef.current)
    if (slug && sameSlug(slug, crossRepoPrompt.link.slug)) {
      await acceptGitHubLink(added)
    }
  }, [acceptGitHubLink, addRepo, allowCrossRepoProjectAdd, crossRepoPrompt])

  const dismissCrossRepoPrompt = useCallback((): void => {
    handledCrossRepoUrlRef.current = debouncedQuery.trim()
    setCrossRepoPrompt(null)
  }, [debouncedQuery])

  const smartPlaceholder = repoBackedSourcesDisabled
    ? linearAvailable
      ? translate(
          'auto.components.new.workspace.SmartWorkspaceNameField.placeholderNameOrLinearUrl',
          'Type a name, Linear URL, or Jira URL'
        )
      : translate(
          'auto.components.new.workspace.SmartWorkspaceNameField.placeholderWorkspaceName',
          'Type a workspace name'
        )
    : linearAvailable
      ? branchesEnabled
        ? translate(
            'auto.components.new.workspace.SmartWorkspaceNameField.placeholderSmartWithBranchGitLabLinear',
            'Type a name, #1234, branch, GitHub/GitLab, Linear, or Jira URL'
          )
        : translate(
            'auto.components.new.workspace.SmartWorkspaceNameField.placeholderSmartGitLabLinear',
            'Type a name, #1234, GitHub/GitLab, Linear, or Jira URL'
          )
      : branchesEnabled
        ? translate(
            'auto.components.new.workspace.SmartWorkspaceNameField.placeholderSmartWithBranchGitLab',
            'Type a name, #1234, branch, GitHub, GitLab, or Jira URL'
          )
        : translate(
            'auto.components.new.workspace.SmartWorkspaceNameField.placeholderSmartGitLab',
            'Type a name, #1234, GitHub, GitLab, or Jira URL'
          )
  const crossRepoSwitchIsTaskSource = crossRepoSwitchTarget === 'task-source'
  const crossRepoSwitchTitle = crossRepoSwitchIsTaskSource
    ? translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.switchTaskSourceTitle',
        'Switch task source?'
      )
    : translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.4bd98f1091',
        'Switch project?'
      )
  const crossRepoSwitchDescriptionSuffix = crossRepoSwitchIsTaskSource
    ? translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.differentTaskSource',
        ', which is different from the selected task source.'
      )
    : translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.9ef1a7c4b0',
        ', which is different from the selected project.'
      )
  const crossRepoSwitchFallbackLabel = crossRepoSwitchIsTaskSource
    ? translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.currentTaskSource',
        'current task source'
      )
    : translate(
        'auto.components.new.workspace.SmartWorkspaceNameField.fda67f0b61',
        'current project'
      )

  const placeholder = disabled
    ? (disabledPlaceholder ??
      translate('auto.components.new.workspace.SmartWorkspaceNameField.unavailable', 'Unavailable'))
    : mode === 'smart'
      ? smartPlaceholder
      : mode === 'github'
        ? translate(
            'auto.components.new.workspace.SmartWorkspaceNameField.searchGitHub',
            'Search GitHub PRs and issues'
          )
        : mode === 'gitlab'
          ? translate(
              'auto.components.new.workspace.SmartWorkspaceNameField.searchGitLab',
              'Search GitLab MRs and issues'
            )
          : mode === 'branches'
            ? translate(
                'auto.components.new.workspace.SmartWorkspaceNameField.searchBranches',
                'Search branches'
              )
            : mode === 'linear'
              ? translate(
                  'auto.components.new.workspace.SmartWorkspaceNameField.searchLinear',
                  'Search Linear issues'
                )
              : mode === 'jira'
                ? translate(
                    'auto.components.new.workspace.SmartWorkspaceNameField.searchJira',
                    'Search Jira issues or paste an issue URL'
                  )
                : translate(
                    'auto.components.new.workspace.SmartWorkspaceNameField.workspaceName',
                    'Workspace name'
                  )

  return {
    rows,
    isQueryStale,
    resolvedCommandValue,
    emojiSuggestions,
    emojiMenuOpen,
    resolvedEmojiCommandValue,
    selectedEmojiSuggestion,
    loading,
    showSearchSpinner,
    ActiveInputIcon,
    handleSelect,
    applyEmojiReplacement,
    handleEmojiSelect,
    acceptGitHubLink,
    handleUseCurrentRepo,
    handleAddMatchingRepo,
    dismissCrossRepoPrompt,
    crossRepoSwitchTitle,
    crossRepoSwitchDescriptionSuffix,
    crossRepoSwitchFallbackLabel,  }
}
