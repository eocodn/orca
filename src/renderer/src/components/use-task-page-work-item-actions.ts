import { useCallback } from 'react'
import { toast } from 'sonner'

import { translate } from '@/i18n/i18n'
import { useAppStore, type AppState } from '@/store'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { findGithubWorkItemWorkspaceAttachment } from '@/lib/github-work-item-workspace-attachment'
import { createGitHubWorkItemWorkspaceInBackground } from '@/lib/github-work-item-background-create'
import type { LinkedWorkItemSummary } from '@/lib/new-workspace'
import { buildLinearIssueLinkedWorkItem } from '@/lib/linear-linked-work-item'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type {
  GitHubWorkItem,
  GitLabWorkItem,
  JiraIssue,
  JiraSite,
  LinearIssue,
  Repo
} from '../../../shared/types'
import {
  getGitHubWorkItemWorkspaceSeed,
  getGitLabWorkItemWorkspaceSeed,
  getJiraIssueWorkspaceSeed,
  getTaskPageRepoSourceContext
} from './task-page-source-context'
import { getLinearIssueWorkspaceName } from '../../../shared/workspace-name'
import { bindTaskPageJiraItemSourceContext } from './task-page-jira-item-source-context'

type Props = {
  openModal: AppState['openModal']
  repoMap: ReadonlyMap<string, Repo>
  linearTaskSourceContext: TaskSourceContext | null
  jiraTaskSourceContext: TaskSourceContext | null
  jiraSites: JiraSite[]
}

export function useTaskPageWorkItemActions({
  openModal,
  repoMap,
  linearTaskSourceContext,
  jiraTaskSourceContext,
  jiraSites
}: Props) {
  const openComposerForGitHubItem = useCallback(
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
        openModalFallback: () => openComposerForGitHubItem(item)
      })
    },
    [openComposerForGitHubItem, repoMap]
  )
  const handleOpenOrUseGitHubWorkItem = useCallback(
    (item: GitHubWorkItem): void => {
      const attached = findGithubWorkItemWorkspaceAttachment(
        useAppStore.getState().allWorktrees(),
        item.repoId,
        item.type,
        item.number
      )
      if (!attached) {
        handleUseWorkItem(item)
        return
      }
      if (activateAndRevealWorktree(attached.id) === false) {
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
  const handleUseGitLabItem = useCallback(
    (item: GitLabWorkItem): void => {
      const linkedWorkItem: LinkedWorkItemSummary = {
        provider: 'gitlab',
        type: item.type,
        number: item.number,
        title: item.title,
        url: item.url,
        ...(item.repoId ? { repoId: item.repoId } : {})
      }
      useAppStore.getState().recordFeatureInteraction('gitlab-tasks')
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
  const handleUseLinearItem = useCallback(
    (issue: LinearIssue): void => {
      useAppStore.getState().recordFeatureInteraction('linear-tasks')
      openModal('new-workspace-composer', {
        linkedWorkItem: buildLinearIssueLinkedWorkItem(issue),
        taskSourceContext: linearTaskSourceContext,
        prefilledName: getLinearIssueWorkspaceName(issue),
        telemetrySource: 'sidebar'
      })
    },
    [linearTaskSourceContext, openModal]
  )
  const handleUseJiraItem = useCallback(
    (issue: JiraIssue): void => {
      const taskSourceContext = bindTaskPageJiraItemSourceContext({
        issue,
        sites: jiraSites,
        sourceContext: jiraTaskSourceContext
      })
      if (!taskSourceContext) {
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
      useAppStore.getState().recordFeatureInteraction('jira-tasks')
      openModal('new-workspace-composer', {
        linkedWorkItem,
        taskSourceContext,
        prefilledName: getJiraIssueWorkspaceSeed(issue),
        telemetrySource: 'sidebar'
      })
    },
    [jiraSites, jiraTaskSourceContext, openModal]
  )

  return {
    handleUseWorkItem,
    handleOpenOrUseGitHubWorkItem,
    handleUseGitLabItem,
    handleUseLinearItem,
    handleUseJiraItem
  }
}
