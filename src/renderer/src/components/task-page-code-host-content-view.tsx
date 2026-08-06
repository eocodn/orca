import type React from 'react'

import GitHubItemDialog from '@/components/GitHubItemDialog'
import ProjectViewWrapper from '@/components/github-project/ProjectViewWrapper'
import PullRequestPage from '@/components/PullRequestPage'
import { formatRelativeTime } from './task-page-query-model'
import { GHAssigneesCell } from './task-page-github-assignees-cell'
import { PRChecksCell, PRMergeCell } from './task-page-github-pr-cells'
import { PRReviewCell } from './task-page-github-review-cell'
import { GHStatusCell } from './task-page-github-status-cell'
import { TaskPageGitHubItemsTable } from './task-page-github-items-table'
import { TaskPageGitLabItemsTable } from './task-page-gitlab-items-table'
import { TaskPageGitLabTodosTable } from './task-page-gitlab-todos-table'
import type { TaskPageController } from './use-task-page-controller'

type Props = { controller: TaskPageController }

export function TaskPageCodeHostContentView({ controller }: Props): React.JSX.Element {
  if (controller.taskSource === 'github') {
    if (controller.dialogWorkItem) {
      return controller.dialogWorkItem.type === 'pr' ? (
        <PullRequestPage
          workItem={controller.dialogWorkItem}
          initialTab={controller.dialogInitialTab}
          repoPath={controller.dialogRepoPath}
          repoId={controller.dialogWorkItem.repoId}
          sourceContext={controller.dialogSourceContext}
          backLabel="Pull requests"
          onUse={(item) => {
            controller.setDialogWorkItem(null)
            controller.handleUseWorkItem(item)
          }}
          onReviewRequestsChange={controller.handleDialogReviewRequestsChange}
          onClose={controller.closeTaskDetailPage}
        />
      ) : (
        <GitHubItemDialog
          workItem={controller.dialogWorkItem}
          initialTab={controller.dialogInitialTab}
          repoPath={controller.dialogRepoPath}
          repoId={controller.dialogWorkItem.repoId}
          sourceContext={controller.dialogSourceContext}
          backLabel="GitHub list"
          onUse={(item) => {
            controller.setDialogWorkItem(null)
            controller.handleUseWorkItem(item)
          }}
          onReviewRequestsChange={controller.handleDialogReviewRequestsChange}
          onClose={controller.closeTaskDetailPage}
        />
      )
    }
    if (controller.githubMode === 'project') {
      return (
        <div className="mt-3 flex min-h-0 min-w-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-muted/50 shadow-sm">
          <ProjectViewWrapper selectedRepoIds={controller.repoSelection} />
        </div>
      )
    }
    return (
      <TaskPageGitHubItemsTable
        tasksError={controller.tasksError}
        githubUnavailable={controller.githubUnavailable}
        failedCount={controller.failedCount}
        selectedRepoCount={controller.selectedRepos.length}
        perRepoSourceState={controller.perRepoSourceState}
        unresolvedSourceRepos={controller.unresolvedSourceRepos}
        retryingSourceKeys={controller.retryingSourceKeys}
        tasksLoading={controller.tasksLoading}
        handleRetryIssuesFetch={controller.handleRetryIssuesFetch}
        showGitHubTaskSkeletons={controller.showGitHubTaskSkeletons}
        filteredWorkItems={controller.filteredWorkItems}
        githubEmptyState={controller.githubEmptyState}
        githubTaskGridClass={controller.githubTaskGridClass}
        activeGithubTaskKind={controller.activeGithubTaskKind}
        showPRManagementColumns={controller.showPRManagementColumns}
        rows={{
          filteredWorkItems: controller.filteredWorkItems,
          repoMap: controller.repoMap,
          allWorktrees: controller.allWorktrees,
          selectedRepoCount: controller.selectedRepos.length,
          showPRManagementColumns: controller.showPRManagementColumns,
          githubTaskGridClass: controller.githubTaskGridClass,
          formatRelativeTime,
          openGitHubDetailPage: controller.openGitHubDetailPage,
          ensurePRChecksLoaded: controller.ensurePRChecksLoaded,
          handleOpenOrUseGitHubWorkItem: controller.handleOpenOrUseGitHubWorkItem,
          handleUseWorkItem: controller.handleUseWorkItem,
          onRefresh: () => controller.setTaskRefreshNonce((current) => current + 1),
          GHAssigneesCell,
          PRReviewCell,
          PRChecksCell,
          PRMergeCell,
          GHStatusCell
        }}
        currentPage={controller.currentPage}
        totalPages={controller.totalPages}
        loadingTargetPage={controller.loadingTargetPage}
        pages={controller.pages}
        setCurrentPage={controller.setCurrentPage}
        handleLoadNextPage={controller.handleLoadNextPage}
      />
    )
  }

  if (controller.gitlabView === 'todos') {
    return (
      <TaskPageGitLabTodosTable
        gitlabTodos={controller.gitlabTodos}
        gitlabTodosLoading={controller.gitlabTodosLoading}
        primaryRepo={controller.primaryRepo}
      />
    )
  }
  return (
    <TaskPageGitLabItemsTable
      gitlabError={controller.gitlabError}
      gitlabLoading={controller.gitlabLoading}
      gitlabItems={controller.gitlabItems}
      displayedGitLabItems={controller.displayedGitLabItems}
      gitlabEmptyState={controller.gitlabEmptyState}
      openGitLabDetailPage={controller.openGitLabDetailPage}
      handleUseGitLabItem={controller.handleUseGitLabItem}
    />
  )
}
