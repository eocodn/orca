import { useAppStore } from '@/store'
import { setWorktreeNavViewActivator } from '@/store/slices/worktree-nav-history'
import type { ActivateAndRevealResult } from './worktree-activation-types'

/**
 * Activates a sidebar workspace id of either shape. Rendered sidebar order mixes
 * plain worktree ids with `folder:` keys, so every caller that navigates by that
 * order must dispatch here — the folder branch is what enforces the path-status
 * gate that blocks a missing/unmounted/disconnected-SSH folder (#10716).
 */
export function activateAndRevealWorkspace(workspaceId: string): ActivateAndRevealResult | false {
  const workspaceScope = parseWorkspaceKey(workspaceId)
  if (workspaceScope?.type === 'folder') {
    return activateAndRevealFolderWorkspace(workspaceScope.folderWorkspaceId)
  }
  return activateAndRevealWorktree(workspaceId)
}

// Why: break the import cycle — nav-history slice (under @/store) can't import activation directly, so register the activator here.
setWorktreeNavActivator(activateAndRevealWorkspace)

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

