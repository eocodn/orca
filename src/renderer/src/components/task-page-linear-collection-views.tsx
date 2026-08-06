import type React from 'react'
import { ChevronLeft, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import {
  LinearCollectionNotice,
  LinearCustomViewTable,
  LinearProjectOverview,
  LinearProjectTable
} from '@/components/linear-project-view-surfaces'
import type {
  LinearCollectionResult,
  LinearCustomViewSummary,
  LinearProjectDetail,
  LinearProjectSummary,
  TaskResumeState
} from '../../../shared/types'
import type { LinearMode } from './task-page-localized-options'

type LinearProjectTab = 'overview' | 'issues'

export type TaskPageLinearCollectionViewsProps = {
  selectedLinearProject: LinearProjectSummary | null
  selectedLinearProjectDetail: LinearProjectDetail | null
  linearProjectDetailLoading: boolean
  linearProjectDetailError: string | null
  linearProjectTab: LinearProjectTab
  linearProjectParentView: LinearCustomViewSummary | null
  linearMode: LinearMode
  linearProjectsResult: LinearCollectionResult<LinearProjectSummary>
  linearProjectsLoading: boolean
  linearProjectsError: string | null
  linearCustomViewsResult: LinearCollectionResult<LinearCustomViewSummary>
  linearCustomViewsLoading: boolean
  linearCustomViewsError: string | null
  selectedLinearCustomView: LinearCustomViewSummary | null
  linearCustomViewProjectsResult: LinearCollectionResult<LinearProjectSummary>
  linearCustomViewContentsLoading: boolean
  linearCustomViewContentsError: string | null
  selectedLinearWorkspaceId: string | 'all'
  setSelectedLinearProject: (project: LinearProjectSummary | null) => void
  setSelectedLinearProjectDetail: (project: LinearProjectDetail | null) => void
  setLinearProjectTab: (tab: LinearProjectTab) => void
  setLinearMode: (mode: LinearMode) => void
  setSelectedLinearCustomView: (view: LinearCustomViewSummary | null) => void
  setLinearProjectParentView: (view: LinearCustomViewSummary | null) => void
  setTaskResumeState: (updates: Partial<TaskResumeState>) => void
  onRefresh: () => void
  openLinearProjectContext: (
    project: LinearProjectSummary,
    options?: { parentView?: LinearCustomViewSummary | null }
  ) => void
  openLinearCustomViewContext: (view: LinearCustomViewSummary) => void
}

export function TaskPageLinearCollectionViews({
  selectedLinearProject,
  selectedLinearProjectDetail,
  linearProjectDetailLoading,
  linearProjectDetailError,
  linearProjectTab,
  linearProjectParentView,
  linearMode,
  linearProjectsResult,
  linearProjectsLoading,
  linearProjectsError,
  linearCustomViewsResult,
  linearCustomViewsLoading,
  linearCustomViewsError,
  selectedLinearCustomView,
  linearCustomViewProjectsResult,
  linearCustomViewContentsLoading,
  linearCustomViewContentsError,
  selectedLinearWorkspaceId,
  setSelectedLinearProject,
  setSelectedLinearProjectDetail,
  setLinearProjectTab,
  setLinearMode,
  setSelectedLinearCustomView,
  setLinearProjectParentView,
  setTaskResumeState,
  onRefresh,
  openLinearProjectContext,
  openLinearCustomViewContext
}: TaskPageLinearCollectionViewsProps): React.JSX.Element | null {
  if (selectedLinearProject && linearProjectTab === 'overview') {
    return (
      <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
        <LinearProjectOverview
          project={selectedLinearProjectDetail ?? selectedLinearProject}
          loading={linearProjectDetailLoading}
          error={linearProjectDetailError}
          onBack={() => {
            if (linearProjectParentView) {
              setSelectedLinearProject(null)
              setSelectedLinearProjectDetail(null)
              setLinearProjectTab('overview')
              setLinearMode('views')
              setSelectedLinearCustomView(linearProjectParentView)
              setTaskResumeState(
                linearProjectParentView.workspaceId
                  ? {
                      linearMode: 'views',
                      linearContext: {
                        kind: 'view',
                        id: linearProjectParentView.id,
                        workspaceId: linearProjectParentView.workspaceId,
                        model: linearProjectParentView.model
                      }
                    }
                  : { linearMode: 'views', linearContext: undefined }
              )
              setLinearProjectParentView(null)
              return
            }
            setSelectedLinearProject(null)
            setSelectedLinearProjectDetail(null)
            setLinearProjectParentView(null)
            setLinearProjectTab('overview')
            setTaskResumeState({ linearContext: undefined })
          }}
          onOpenProject={(project) => {
            if (project.url) {
              void window.api.shell.openUrl(project.url)
            }
          }}
          onRefresh={onRefresh}
          onOpenIssues={() => setLinearProjectTab('issues')}
        />
      </div>
    )
  }

  if (linearMode === 'projects' && !selectedLinearProject) {
    return (
      <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
        <div className="grid h-8 flex-none items-center gap-3 border-b border-border/50 bg-muted/25 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground grid-cols-[minmax(180px,1.5fr)_110px_100px_90px_120px_110px_80px_70px]">
          <span>{translate('auto.components.TaskPage.00022ec0ba', 'Project')}</span>
          <span>{translate('auto.components.TaskPage.154b0fa623', 'Status')}</span>
          <span>{translate('auto.components.TaskPage.8a07f21e76', 'Health')}</span>
          <span>{translate('auto.components.TaskPage.c8d5bec5f7', 'Priority')}</span>
          <span>{translate('auto.components.TaskPage.34da8ac06c', 'Lead')}</span>
          <span>{translate('auto.components.TaskPage.7da41c9225', 'Target')}</span>
          <span>{translate('auto.components.TaskPage.dfc0c79bd8', 'Issues')}</span>
          <span />
        </div>
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto scrollbar-sleek">
          {linearProjectsError ? (
            <div className="border-b border-border px-4 py-4 text-sm text-destructive">
              {linearProjectsError}
            </div>
          ) : null}
          <LinearProjectTable
            projects={linearProjectsResult.items}
            loading={linearProjectsLoading}
            hasError={!!linearProjectsResult.errors?.length}
            workspaceSelection={selectedLinearWorkspaceId}
            onSelectProject={openLinearProjectContext}
            onOpenProject={(project) => {
              if (project.url) {
                void window.api.shell.openUrl(project.url)
              }
            }}
            onUseProjectIssues={(project) => {
              openLinearProjectContext(project)
              setLinearProjectTab('issues')
            }}
          />
        </div>
        <LinearCollectionNotice
          errors={linearProjectsResult.errors}
          hasMore={linearProjectsResult.hasMore}
          count={linearProjectsResult.items.length}
          label={translate('auto.components.TaskPage.b39fe6511d', 'projects')}
        />
      </div>
    )
  }

  if (linearMode === 'views' && !selectedLinearCustomView) {
    return (
      <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
        <div className="grid h-8 flex-none items-center gap-3 border-b border-border/50 bg-muted/25 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground grid-cols-[minmax(220px,1.5fr)_120px_120px_120px_130px_60px]">
          <span>{translate('auto.components.TaskPage.9c57663908', 'View')}</span>
          <span>{translate('auto.components.TaskPage.0aa8525950', 'Model')}</span>
          <span>{translate('auto.components.TaskPage.a04fe7ba73', 'Visibility')}</span>
          <span>{translate('auto.components.TaskPage.b4e10f096e', 'Owner')}</span>
          <span>{translate('auto.components.TaskPage.f362667d55', 'Updated')}</span>
          <span />
        </div>
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto scrollbar-sleek">
          {linearCustomViewsError ? (
            <div className="border-b border-border px-4 py-4 text-sm text-destructive">
              {linearCustomViewsError}
            </div>
          ) : null}
          <LinearCustomViewTable
            views={linearCustomViewsResult.items}
            loading={linearCustomViewsLoading}
            hasError={!!linearCustomViewsResult.errors?.length}
            workspaceSelection={selectedLinearWorkspaceId}
            onSelectView={openLinearCustomViewContext}
            onOpenView={(view) => {
              if (view.url) {
                void window.api.shell.openUrl(view.url)
              }
            }}
          />
        </div>
        <LinearCollectionNotice
          errors={linearCustomViewsResult.errors}
          hasMore={linearCustomViewsResult.hasMore}
          count={linearCustomViewsResult.items.length}
          label={translate('auto.components.TaskPage.3cb855080f', 'views')}
        />
      </div>
    )
  }

  if (selectedLinearCustomView?.model === 'project' && !selectedLinearProject) {
    return (
      <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
        <div className="flex h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={() => {
                setSelectedLinearCustomView(null)
                setLinearProjectParentView(null)
                setTaskResumeState({ linearContext: undefined })
              }}
              aria-label={translate('auto.components.TaskPage.bc06ed0fb0', 'Back to views')}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <div className="min-w-0">
              <div className="truncate text-[13px] font-medium text-foreground">
                {selectedLinearCustomView.name}
              </div>
              <div className="truncate text-[11px] text-muted-foreground">
                {translate('auto.components.TaskPage.733b8f2421', 'Linear / Views')}
              </div>
            </div>
          </div>
          {selectedLinearCustomView.url ? (
            <Button
              variant="outline"
              size="xs"
              onClick={() => void window.api.shell.openUrl(selectedLinearCustomView.url!)}
              className="gap-1 border-border/50 bg-background/70"
            >
              <ExternalLink className="size-3.5" />
              {translate('auto.components.TaskPage.8675cd6188', 'Linear')}
            </Button>
          ) : null}
        </div>
        <div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto scrollbar-sleek">
          {linearCustomViewContentsError ? (
            <div className="border-b border-border px-4 py-4 text-sm text-destructive">
              {linearCustomViewContentsError}
            </div>
          ) : null}
          <LinearProjectTable
            projects={linearCustomViewProjectsResult.items}
            loading={linearCustomViewContentsLoading}
            hasError={!!linearCustomViewProjectsResult.errors?.length}
            workspaceSelection={selectedLinearWorkspaceId}
            onSelectProject={(project) =>
              openLinearProjectContext(project, { parentView: selectedLinearCustomView })
            }
            onOpenProject={(project) => {
              if (project.url) {
                void window.api.shell.openUrl(project.url)
              }
            }}
            onUseProjectIssues={(project) => {
              openLinearProjectContext(project, { parentView: selectedLinearCustomView })
              setLinearProjectTab('issues')
            }}
          />
        </div>
        <LinearCollectionNotice
          errors={linearCustomViewProjectsResult.errors}
          hasMore={linearCustomViewProjectsResult.hasMore}
          count={linearCustomViewProjectsResult.items.length}
          label={translate('auto.components.TaskPage.b39fe6511d', 'projects')}
        />
      </div>
    )
  }

  return null
}
