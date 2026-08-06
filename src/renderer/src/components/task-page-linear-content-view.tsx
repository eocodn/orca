import type React from 'react'
import { LoaderCircle } from 'lucide-react'

import LinearIssueWorkspace from '@/components/LinearIssueWorkspace'
import { LinearIcon } from '@/components/task-page-localized-options'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  LINEAR_ISSUE_LIST_MAX,
  clampLinearIssueListLimit
} from '../../../shared/linear-issue-read-limits'
import { TaskPageLinearCollectionViews } from './task-page-linear-collection-views'
import { TaskPageLinearIssueBody } from './task-page-linear-issue-body'
import { TaskPageLinearIssueHeader } from './task-page-linear-issue-header'
import type { TaskPageController } from './use-task-page-controller'

type Props = { controller: TaskPageController }

export function TaskPageLinearContentView({ controller }: Props): React.JSX.Element {
  if (controller.selectedLinearIssue) {
    return (
      <LinearIssueWorkspace
        issue={controller.selectedLinearIssue}
        variant="page"
        backLabel={controller.activeLinearIssueContextLabel ?? 'Linear list'}
        onUse={controller.handleUseLinearItem}
        onOpenIssue={controller.openRelatedLinearIssue}
        onClose={controller.closeTaskDetailPage}
        sourceContext={controller.linearDetailSourceContext}
      />
    )
  }
  if (!controller.linearStatusReady) {
    return (
      <div className="mt-4 flex items-center justify-center py-14">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!controller.linearConnected) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
        <LinearIcon className="mb-4 size-8 text-muted-foreground/60" />
        <p className="text-base font-medium text-foreground">
          {translate('auto.components.TaskPage.6d56559467', 'Connect your Linear account')}
        </p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {translate(
            'auto.components.TaskPage.228b25028f',
            'Browse and start work on your assigned Linear issues directly from here.'
          )}
        </p>
        <Button className="mt-5" onClick={() => controller.setLinearConnectOpen(true)}>
          {translate('auto.components.TaskPage.851017590d', 'Add Linear access')}
        </Button>
      </div>
    )
  }

  const showsCollection =
    (controller.selectedLinearProject && controller.linearProjectTab === 'overview') ||
    (controller.linearMode === 'projects' && !controller.selectedLinearProject) ||
    (controller.linearMode === 'views' && !controller.selectedLinearCustomView) ||
    (controller.selectedLinearCustomView?.model === 'project' && !controller.selectedLinearProject)
  if (showsCollection) {
    return (
      <TaskPageLinearCollectionViews
        selectedLinearProject={controller.selectedLinearProject}
        selectedLinearProjectDetail={controller.selectedLinearProjectDetail}
        linearProjectDetailLoading={controller.linearProjectDetailLoading}
        linearProjectDetailError={controller.linearProjectDetailError}
        linearProjectTab={controller.linearProjectTab}
        linearProjectParentView={controller.linearProjectParentView}
        linearMode={controller.linearMode}
        linearProjectsResult={controller.linearProjectsResult}
        linearProjectsLoading={controller.linearProjectsLoading}
        linearProjectsError={controller.linearProjectsError}
        linearCustomViewsResult={controller.linearCustomViewsResult}
        linearCustomViewsLoading={controller.linearCustomViewsLoading}
        linearCustomViewsError={controller.linearCustomViewsError}
        selectedLinearCustomView={controller.selectedLinearCustomView}
        linearCustomViewProjectsResult={controller.linearCustomViewProjectsResult}
        linearCustomViewContentsLoading={controller.linearCustomViewContentsLoading}
        linearCustomViewContentsError={controller.linearCustomViewContentsError}
        selectedLinearWorkspaceId={controller.selectedLinearWorkspaceId}
        setSelectedLinearProject={controller.setSelectedLinearProject}
        setSelectedLinearProjectDetail={controller.setSelectedLinearProjectDetail}
        setLinearProjectTab={controller.setLinearProjectTab}
        setLinearMode={controller.setLinearMode}
        setSelectedLinearCustomView={controller.setSelectedLinearCustomView}
        setLinearProjectParentView={controller.setLinearProjectParentView}
        setTaskResumeState={controller.setTaskResumeState}
        onRefresh={() => controller.setLinearRefreshNonce((current) => current + 1)}
        openLinearProjectContext={controller.openLinearProjectContext}
        openLinearCustomViewContext={controller.openLinearCustomViewContext}
      />
    )
  }

  return (
    <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
      <TaskPageLinearIssueHeader
        activeLinearIssueContextLabel={controller.activeLinearIssueContextLabel}
        onBack={() => {
          if (controller.selectedLinearProject) {
            controller.setLinearProjectTab('overview')
            return
          }
          controller.setSelectedLinearCustomView(null)
          controller.setLinearProjectParentView(null)
          controller.setTaskResumeState({ linearContext: undefined })
        }}
        linearViewOptions={controller.linearViewOptions}
        linearViewMode={controller.linearViewMode}
        onViewModeChange={controller.setLinearViewMode}
        linearGroupOptions={controller.linearGroupOptions}
        linearGroupBy={controller.linearGroupBy}
        onGroupByChange={controller.setLinearGroupBy}
        linearOrderOptions={controller.linearOrderOptions}
        linearOrderBy={controller.linearOrderBy}
        onOrderByChange={controller.setLinearOrderBy}
        linearDisplayPropertyOptions={controller.linearDisplayPropertyOptions}
        effectiveLinearDisplayProperties={controller.effectiveLinearDisplayProperties}
        onToggleDisplayProperty={controller.toggleLinearDisplayProperty}
        shownIssueCount={controller.pagedLinearIssues.length}
      />
      <TaskPageLinearIssueBody
        linearViewMode={controller.linearViewMode}
        linearGroupBy={controller.linearGroupBy}
        linearIssueGridStyle={controller.linearIssueGridStyle}
        effectiveLinearDisplayProperties={controller.effectiveLinearDisplayProperties}
        activeLinearIssueError={controller.activeLinearIssueError}
        activeLinearIssueLoading={controller.activeLinearIssueLoading}
        activeLinearIssues={controller.activeLinearIssues}
        activeLinearIssueHasCollectionError={controller.activeLinearIssueHasCollectionError}
        activeLinearIssueContextLabel={controller.activeLinearIssueContextLabel}
        linearSearchActive={controller.linearSearchActive}
        linearAttributeFilter={controller.linearAttributeFilter}
        filteredLinearIssues={controller.filteredLinearIssues}
        linearIssuesHasMore={controller.linearIssuesHasMore}
        onFetchMore={() => {
          controller.setLinearIssueLimit((limit) =>
            Math.min(
              clampLinearIssueListLimit(limit + controller.LINEAR_ITEM_LIMIT),
              LINEAR_ISSUE_LIST_MAX
            )
          )
        }}
        boardProps={{
          sections: controller.linearBoardSections,
          effectiveDisplayProperties: controller.effectiveLinearDisplayProperties,
          selectedIssueId: controller.selectedLinearIssueId,
          selectedWorkspaceId: controller.selectedLinearWorkspaceId,
          statusBoardEnabled: controller.linearStatusBoardEnabled,
          dragOverKey: controller.linearBoardDragOverKey,
          draggingIssueId: controller.linearBoardDraggingIssueId,
          updatingIssueIds: controller.linearBoardUpdatingIssueIds,
          sourceContext: controller.linearTaskSourceContext,
          onDragStart: controller.handleLinearBoardCardDragStart,
          onDragOver: controller.handleLinearBoardDragOver,
          onDrop: (section, event) => void controller.handleLinearBoardDrop(section, event),
          onDragEnd: () => {
            controller.setLinearBoardDraggingIssueId(null)
            controller.setLinearBoardDragOverKey(null)
          },
          onOpenIssue: controller.openLinearDetailPage,
          onUseIssue: controller.handleUseLinearItem
        }}
        listProps={{
          rows: controller.linearIssueListRows,
          effectiveDisplayProperties: controller.effectiveLinearDisplayProperties,
          gridStyle: controller.linearIssueGridStyle,
          selectedIssueId: controller.selectedLinearIssueId,
          selectedWorkspaceId: controller.selectedLinearWorkspaceId,
          sourceContext: controller.linearTaskSourceContext,
          onOpenIssue: controller.openLinearDetailPage,
          onUseIssue: controller.handleUseLinearItem
        }}
        collectionErrors={
          controller.selectedLinearProject && controller.linearProjectTab === 'issues'
            ? controller.linearProjectIssuesResult.errors
            : controller.selectedLinearCustomView?.model === 'issue'
              ? controller.linearCustomViewIssuesResult.errors
              : undefined
        }
        collectionCount={
          controller.selectedLinearProject && controller.linearProjectTab === 'issues'
            ? controller.linearProjectIssuesResult.items.length
            : controller.selectedLinearCustomView?.model === 'issue'
              ? controller.linearCustomViewIssuesResult.items.length
              : controller.linearIssues.length
        }
        collectionLabel={
          controller.selectedLinearProject && controller.linearProjectTab === 'issues'
            ? translate('auto.components.TaskPage.67662ade50', 'project issues')
            : controller.selectedLinearCustomView?.model === 'issue'
              ? translate('auto.components.TaskPage.be8cf68d9f', 'view issues')
              : translate('auto.components.TaskPage.d1e243795c', 'issues')
        }
        showLinearEmptyFilteredLoadMore={controller.showLinearEmptyFilteredLoadMore}
        onLoadMore={controller.handleLinearEmptyFilteredLoadMore}
        showLinearIssuePagination={controller.showLinearIssuePagination}
        visibleLinearIssuePage={controller.visibleLinearIssuePage}
        linearIssueTotalPages={controller.linearIssueTotalPages}
        activeLinearIssueLoadingTargetPage={controller.activeLinearIssueLoadingTargetPage}
        onPageChange={controller.handleLinearIssuePageChange}
      />
    </div>
  )
}
