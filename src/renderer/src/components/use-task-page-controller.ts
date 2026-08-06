import { useCallback } from 'react'

import { shouldHideTaskPageListChrome } from '@/components/task-page-list-chrome-visibility'
import { useAppStore } from '@/store'
import { useTaskPageBaseController } from './use-task-page-base-controller'
import { useTaskPageCreationActions } from './use-task-page-creation-actions'
import { useTaskPageGitHubController } from './use-task-page-github-controller'
import { useTaskPageGitLabData } from './use-task-page-gitlab-data'
import { useTaskPageGlobalLifecycle } from './use-task-page-global-lifecycle'
import { useTaskPageJiraController } from './use-task-page-jira-controller'
import { useTaskPageLinearController } from './use-task-page-linear-controller'
import { useTaskPagePersistedContextHydration } from './use-task-page-persisted-context-hydration'
import { useTaskPageProviderComposerReset } from './use-task-page-provider-composer-reset'
import { useTaskPageToolbarController } from './use-task-page-toolbar-controller'
import { useTaskPageWorkItemActions } from './use-task-page-work-item-actions'

const LINEAR_ITEM_LIMIT = 36

export function useTaskPageController() {
  const base = useTaskPageBaseController()
  const { store, source, provider } = base
  const github = useTaskPageGitHubController({
    store,
    source,
    taskResumeApplied: base.taskResumeApplied,
    githubSearchPersistReadyRef: base.githubSearchPersistReadyRef
  })
  const gitlab = useTaskPageGitLabData({
    selectedRepos: source.selectedRepos,
    primaryRepo: source.primaryRepo,
    taskSource: source.taskSource
  })
  const toolbar = useTaskPageToolbarController({
    eligibleRepos: source.eligibleRepos,
    taskPickerRepos: source.taskPickerRepos,
    selectedRepos: source.selectedRepos,
    setRepoSelection: source.setRepoSelection,
    updateSettings: store.updateSettings,
    openTaskPage: store.openTaskPage,
    taskSourceManuallyChangedRef: base.taskSourceManuallyChangedRef,
    setGitlabFilter: gitlab.setGitlabFilter,
    setGitlabRefreshNonce: gitlab.setGitlabRefreshNonce,
    setNewIssueTitle: github.setNewIssueTitle,
    setNewIssueBody: github.setNewIssueBody,
    setNewIssueLabels: github.setNewIssueLabels,
    setNewIssueAssignees: github.setNewIssueAssignees,
    setNewIssueRepoId: github.setNewIssueRepoId,
    setNewIssueOpen: github.setNewIssueOpen
  })
  const linear = useTaskPageLinearController({
    store,
    source,
    provider,
    taskResumeApplied: base.taskResumeApplied,
    linearSearchPersistReadyRef: base.linearSearchPersistReadyRef
  })
  const jira = useTaskPageJiraController({
    store,
    source,
    provider,
    taskResumeApplied: base.taskResumeApplied,
    jiraSearchPersistReadyRef: base.jiraSearchPersistReadyRef
  })
  const { setDialogWorkItem } = github
  const { clearSelectedLinearIssue } = linear
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
    useAppStore.setState((current) => ({
      taskPageData: {
        ...current.taskPageData,
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
  const workItemActions = useTaskPageWorkItemActions({
    openModal: store.openModal,
    repoMap: store.repoMap,
    linearTaskSourceContext: provider.linearTaskSourceContext,
    jiraTaskSourceContext: provider.jiraTaskSourceContext,
    jiraSites: source.jiraSites
  })

  useTaskPagePersistedContextHydration({
    pageTaskSource: store.pageData.taskSource,
    persistedUIReady: store.persistedUIReady,
    resolvedInitialSelection: source.resolvedInitialSelection,
    setActiveJiraPreset: jira.setActiveJiraPreset,
    setActiveTaskPreset: github.setActiveTaskPreset,
    setAppliedJiraSearch: jira.setAppliedJiraSearch,
    setAppliedLinearSearch: linear.setAppliedLinearSearch,
    setAppliedTaskSearch: github.setAppliedTaskSearch,
    setGithubMode: github.setGithubMode,
    setJiraSearchInput: jira.setJiraSearchInput,
    setLinearMode: linear.setLinearMode,
    setLinearSearchInput: linear.setLinearSearchInput,
    setRepoSelection: source.setRepoSelection,
    setTaskResumeApplied: base.setTaskResumeApplied,
    setTaskSearchInput: github.setTaskSearchInput,
    setTaskSource: source.setTaskSource,
    settings: store.settings,
    taskResumeAppliedRef: base.taskResumeAppliedRef,
    taskResumeState: store.taskResumeState,
    visibleTaskProviders: source.visibleTaskProviders
  })
  useTaskPageProviderComposerReset({
    providerRuntimeContextKey: source.providerRuntimeContextKey,
    newLinearIssueOpen: linear.newLinearIssueOpen,
    setNewLinearIssueOpen: linear.setNewLinearIssueOpen,
    setNewLinearIssueTitle: linear.setNewLinearIssueTitle,
    setNewLinearIssueBody: linear.setNewLinearIssueBody,
    setNewLinearIssueTeamId: linear.setNewLinearIssueTeamId,
    setNewLinearIssueStateId: linear.setNewLinearIssueStateId,
    setNewLinearIssueAssigneeId: linear.setNewLinearIssueAssigneeId,
    setNewLinearIssuePriority: linear.setNewLinearIssuePriority,
    setNewLinearIssueProjectId: linear.setNewLinearIssueProjectId,
    setNewLinearIssueLabelIds: linear.setNewLinearIssueLabelIds,
    setNewLinearIssueProjects: linear.setNewLinearIssueProjects,
    setNewLinearIssueProjectsLoading: linear.setNewLinearIssueProjectsLoading,
    setNewLinearIssueSubmitting: linear.setNewLinearIssueSubmitting,
    newJiraIssueOpen: jira.newJiraIssueOpen,
    resetNewJiraIssue: jira.resetNewJiraIssue
  })
  const creationActions = useTaskPageCreationActions({
    store,
    github: github.search,
    githubIssue: github.issue,
    githubRepository: github.repository,
    linearComposer: linear,
    linearCollection: linear,
    jiraComposer: jira,
    jiraList: jira,
    linearTaskSourceContext: provider.linearTaskSourceContext,
    jiraTaskSourceContext: provider.jiraTaskSourceContext,
    providerRuntimeContextKey: source.providerRuntimeContextKey,
    providerRuntimeContextKeyRef: source.providerRuntimeContextKeyRef,
    setSelectedLinearIssue: linear.setSelectedLinearIssue,
    setSelectedJiraIssue: jira.setSelectedJiraIssue
  })
  useTaskPageGlobalLifecycle({
    taskSource: source.taskSource,
    githubMode: github.githubMode,
    taskSearchInputRef: github.taskSearchInputRef,
    dialogWorkItem: github.dialogWorkItem,
    gitlabDialogItem: github.gitlabDialogItem,
    selectedLinearIssue: linear.selectedLinearIssue,
    selectedJiraIssue: jira.selectedJiraIssue,
    newIssueOpen: github.newIssueOpen,
    newLinearProjectOpen: linear.newLinearProjectOpen,
    newLinearIssueOpen: linear.newLinearIssueOpen,
    newJiraIssueOpen: jira.newJiraIssueOpen,
    linearConnectOpen: linear.linearConnectOpen,
    jiraConnectOpen: jira.jiraConnectOpen,
    activeModal: store.activeModal,
    closeTaskPage: store.closeTaskPage,
    preflightStatusCurrent: source.preflightStatusCurrent,
    preflightStatusChecked: store.preflightStatusChecked,
    linearStatusReady: source.linearStatusReady,
    jiraStatusReady: source.jiraStatusReady,
    refreshPreflightStatus: store.refreshPreflightStatus,
    checkLinearConnection: store.checkLinearConnection,
    checkJiraConnection: store.checkJiraConnection,
    providerRuntimeContextKey: source.providerRuntimeContextKey,
    preflightStatusContextKey: store.preflightStatusContextKey,
    expectedPreflightContextKey: store.expectedPreflightContextKey,
    linearStatusContextKey: store.linearStatusContextKey,
    jiraStatusContextKey: store.jiraStatusContextKey
  })
  const taskPageListChromeHidden = shouldHideTaskPageListChrome({
    taskSource: source.taskSource,
    hasGitHubDetail: Boolean(github.dialogWorkItem),
    hasGitLabDetail: Boolean(github.gitlabDialogItem),
    hasJiraDetail: Boolean(jira.selectedJiraIssue),
    hasLinearIssueDetail: Boolean(linear.selectedLinearIssue),
    hasLinearProjectContext: Boolean(linear.selectedLinearProject),
    hasLinearViewContext: Boolean(linear.selectedLinearCustomView)
  })

  return {
    ...store,
    ...source,
    ...provider,
    ...github,
    ...gitlab,
    ...toolbar,
    ...linear,
    ...jira,
    ...workItemActions,
    ...creationActions,
    projectModeVisible: source.taskSource === 'github',
    closeTaskDetailPage,
    taskPageListChromeHidden,
    LINEAR_ITEM_LIMIT
  }
}

export type TaskPageController = ReturnType<typeof useTaskPageController>
