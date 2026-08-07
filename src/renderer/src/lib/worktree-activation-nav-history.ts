import { useAppStore } from '@/store'
import { setWorktreeNavViewActivator } from '@/store/slices/worktree-nav-history'

// Why: page entries replay via setActiveView (not open*Page) so back/forward doesn't mutate previousViewBefore* or duplicate history (see navigateToIndex).
setWorktreeNavViewActivator((entry) => {
  if (entry === 'tasks') {
    useAppStore.setState((state) => ({
      activeView: 'tasks',
      githubTaskDrawerWorkItem: null,
      taskPageData: {
        ...state.taskPageData,
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
    return
  }
  if (entry.source === 'github') {
    useAppStore.setState((state) => ({
      activeView: 'tasks',
      taskPageData: {
        ...state.taskPageData,
        taskSource: 'github',
        preselectedRepoId: entry.workItem.repoId,
        openGitHubWorkItem: entry.workItem,
        openGitHubSourceContext: entry.sourceContext,
        openGitHubInitialTab: entry.initialTab,
        openGitLabWorkItem: undefined,
        openGitLabSourceContext: undefined,
        openLinearIssue: undefined,
        openLinearSourceContext: undefined,
        openJiraIssue: undefined,
        openJiraSourceContext: undefined
      }
    }))
    return
  }
  if (entry.source === 'gitlab') {
    useAppStore.setState((state) => ({
      activeView: 'tasks',
      githubTaskDrawerWorkItem: null,
      taskPageData: {
        ...state.taskPageData,
        taskSource: 'gitlab',
        preselectedRepoId: entry.workItem.repoId,
        openGitHubWorkItem: undefined,
        openGitHubSourceContext: undefined,
        openGitHubInitialTab: undefined,
        openGitLabWorkItem: entry.workItem,
        openGitLabSourceContext: entry.sourceContext,
        openLinearIssue: undefined,
        openLinearSourceContext: undefined,
        openJiraIssue: undefined,
        openJiraSourceContext: undefined
      }
    }))
    return
  }
  if (entry.source === 'jira') {
    useAppStore.setState((state) => ({
      activeView: 'tasks',
      githubTaskDrawerWorkItem: null,
      taskPageData: {
        ...state.taskPageData,
        taskSource: 'jira',
        openGitHubWorkItem: undefined,
        openGitHubSourceContext: undefined,
        openGitHubInitialTab: undefined,
        openGitLabWorkItem: undefined,
        openGitLabSourceContext: undefined,
        openLinearIssue: undefined,
        openLinearSourceContext: undefined,
        openJiraIssue: entry.issue,
        openJiraSourceContext: entry.sourceContext
      }
    }))
    return
  }
  useAppStore.setState((state) => ({
    activeView: 'tasks',
    githubTaskDrawerWorkItem: null,
    taskPageData: {
      ...state.taskPageData,
      taskSource: 'linear',
      openGitHubWorkItem: undefined,
      openGitHubSourceContext: undefined,
      openGitHubInitialTab: undefined,
      openGitLabWorkItem: undefined,
      openGitLabSourceContext: undefined,
      openLinearIssue: entry.issue,
      openLinearSourceContext: entry.sourceContext,
      openJiraIssue: undefined,
      openJiraSourceContext: undefined
    }
  }))
})
