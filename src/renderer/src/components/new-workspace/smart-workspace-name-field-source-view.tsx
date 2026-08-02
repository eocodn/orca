// Concrete smart workspace name field view and source orchestration.
// Concrete surface implementation for SmartWorkspaceNameField.tsx
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: this component's existing reset effects need a dedicated refactor outside the Linear API compatibility change. */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CaseSensitive,
  CircleDot,
  ExternalLink,
  GitBranch,
  GitBranchPlus,
  GitMerge,
  GitPullRequest,
  LoaderCircle,
  Search,
  X
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
import {
  listGitLabMRsForSource,
  lookupGitLabWorkItemByPathForSource
} from '@/lib/gitlab-work-item-source-lookup'
import { parseGitLabIssueOrMRLink } from '@/lib/gitlab-links'
import { isImeCompositionKeyDown } from '@/lib/ime-composition-keyboard-event'
import { getLocalPreflightContext, localPreflightContextKey } from '@/lib/local-preflight-context'
import { getRepoOwnerRoutedSettings } from '@/lib/repo-runtime-owner'
import { cn } from '@/lib/utils'
import { LinearIcon } from '@/components/icons/LinearIcon'
import { JiraIcon } from '@/components/icons/JiraIcon'
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
import { filterAvailableTaskProviders } from '../../../../shared/task-providers'
import type {
  BaseRefSearchResult,
  GitHubWorkItem,
  GitLabWorkItem,
  JiraIssue,
  JiraSite,
  LinearIssue
} from '../../../../shared/types'
import { resolveSmartWorkspaceCommandValue } from './smart-workspace-command-value'
import { isComposerFieldToFieldFocus } from './smart-workspace-source-popover-focus'
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
import { parseExecutionHostId, type ExecutionHostId } from '../../../../shared/execution-host'
import { githubRepoIdentityKey } from '../../../../shared/github-repository-identity-key'
import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import {
  getGitHubRuntimeRepoId,
  getGitHubSourceRuntimeTarget
} from '@/lib/github-source-runtime-context'
import { useJiraSourceConnection } from './use-jira-source-connection'
import {
  bindJiraIssueSourceContext,
  useJiraUrlSource,
  type JiraUrlSourceState
} from './use-jira-url-source'
import {
  applyWorkspaceEmojiSuggestion,
  getActiveWorkspaceEmojiShortcode,
  replaceCompletedWorkspaceEmojiShortcode,
  searchWorkspaceEmojiShortcodes,
  type WorkspaceEmojiReplacement,
  type WorkspaceEmojiSuggestion
} from '@/lib/workspace-emoji-shortcodes'
import { WorkspaceEmojiSuggestionPopover } from './WorkspaceEmojiSuggestionPopover'
import { useSmartWorkspaceGitHubSearch } from './smart-workspace-name-field-github-search'
import { useSmartWorkspaceProviderSearch } from './smart-workspace-name-field-provider-search'
import { SmartWorkspaceNameFieldSourceRender } from './smart-workspace-name-field-source-render'
import { useSmartWorkspaceNameSelection } from './smart-workspace-name-field-selection-state'

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

export default function SmartWorkspaceNameField({
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
  githubSourceContext: githubSourceContextOverride,
  jiraSourceContext = null,
  inputRef,
  onPlainEnter,
  disabled = false,
  disabledPlaceholder,
  textOnly = false,
  branchesEnabled = true,
  repoBackedSourcesDisabled = false,
  repoBackedSearchRepos = EMPTY_REPO_SEARCH_REPOS,
  allowCrossRepoProjectAdd = true,
  crossRepoSwitchTarget = 'project',
  onActiveSourceModeChange
}: SmartWorkspaceNameFieldProps): React.JSX.Element {
  const sourceSetup = useSmartWorkspaceNameFieldSourceSetup({
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
    RESULT_LIMIT
  })
  const {
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
    setInputNode,  } = sourceSetup

  const sourceQueryWithinLimit = useMemo(
    () => isSmartWorkspaceSourceQueryWithinLimit(debouncedQuery),
    [debouncedQuery]
  )
  const normalizedGhQuery = useMemo(
    () => normalizeGitHubLinkQuery(sourceQueryWithinLimit ? debouncedQuery : ''),
    [debouncedQuery, sourceQueryWithinLimit]
  )
  const parsedGhLink = useMemo(
    () => (sourceQueryWithinLimit ? parseGitHubIssueOrPRLink(debouncedQuery) : null),
    [debouncedQuery, sourceQueryWithinLimit]
  )
  const shouldQueryGithub =
    sourceQueryWithinLimit &&
    !repoBackedSourcesDisabled &&
    !jiraSource.intent &&
    !textOnly &&
    repoBackedSearchTargets.length > 0 &&
    (mode === 'smart' || mode === 'github')
  const shouldQueryLinear =
    sourceQueryWithinLimit &&
    !jiraSource.intent &&
    !textOnly &&
    linearAvailable &&
    (mode === 'smart' || mode === 'linear')
  const jiraSearchJql =
    mode === 'jira' && !jiraSource.intent && sourceQueryWithinLimit
      ? buildJiraIssueSearchJql(debouncedQuery)
      : null
  const shouldQueryJira =
    !disabled &&
    !textOnly &&
    jiraSourceConnected &&
    jiraSourceContext !== null &&
    jiraSearchJql !== null

  useSmartWorkspaceGitHubSearch({
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
    shouldQueryGithub,  })
  const branchSearchRequest = useMemo(
    () =>
      getBranchSearchRequest({
        disabled: disabled || jiraSource.intent,
        branchesEnabled: branchesEnabled && !repoBackedSourcesDisabled,
        textOnly,
        mode,
        selectedRepoId: selectedRepo?.id ?? null,
        query: debouncedQuery,
        limit: RESULT_LIMIT
      }),
    [
      branchesEnabled,
      debouncedQuery,
      disabled,
      jiraSource.intent,
      mode,
      repoBackedSourcesDisabled,
      selectedRepo?.id,
      textOnly
    ]
  )

  useSmartWorkspaceProviderSearch({
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
    branchSearchRequest,  })
  const selectionState = useSmartWorkspaceNameSelection({
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
    cancelLocalInputFocusFrame,  })
  const {
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
    crossRepoSwitchFallbackLabel,  } = selectionState

  const sourceRenderContext = {
    selectedRepo,
    mode,
    setMode,
    mrStateFilter,
    setMrStateFilter,
    open,
    setOpen,
    commandValue,
    setCommandValue,
    setEmojiCommandValue,
    setEmojiCursor,
    localInputRef,
    tabsListRef,
    localInputFocusFrameRef,
    crossRepoPrompt,
    jiraConnectionStatus,
    jiraSource,
    showJiraSiteContext,
    jiraStatusId,
    availableModes,
    mrStateFilters,
    setSelectedSourceNode,
    cancelLocalInputFocusFrame,
    markSourcePopoverUserEngaged,
    tryOpenSourcePopover,
    handleSourcePopoverOpenChange,
    setInputNode,
    item,
    intent,
    query,
    siteId,
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
    sites,
    site,
    applyEmojiReplacement,
    handleEmojiSelect,
    acceptGitHubLink,
    handleUseCurrentRepo,
    handleAddMatchingRepo,
    slug,
    dismissCrossRepoPrompt,
    crossRepoSwitchTitle,
    crossRepoSwitchDescriptionSuffix,
    crossRepoSwitchFallbackLabel,
    placeholder,  }
  return <SmartWorkspaceNameFieldSourceRender context={sourceRenderContext} />
}

import {
  RowIcon,
  RowLabel,
  SelectionIcon,
  findMatchingRepoForSlug,
  getRepoSlugCached,
  sameSlug
} from './smart-workspace-name-field-presentation'
export { getRepoSlugCached } from './smart-workspace-name-field-presentation'
