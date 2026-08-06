import type { ComponentProps, CSSProperties } from 'react'

import { Button } from '@/components/ui/button'
import { LinearCollectionNotice } from '@/components/linear-project-view-surfaces'
import type { LinearIssueAttributeFilter } from '../../../shared/linear-issue-attribute-filter'
import type { LinearIssue, LinearWorkspaceError } from '../../../shared/types'
import { translate } from '@/i18n/i18n'
import {
  resolveLinearIssueEmptyKind,
  shouldOfferLinearIssueFetchMore
} from './task-page-linear-issue-empty-state'
import { TaskPageLinearIssueBoard } from './task-page-linear-issue-board'
import { TaskPageLinearIssueList } from './task-page-linear-issue-list'
import { PaginationBar } from './task-page-pagination'
import type {
  LinearDisplayProperty,
  LinearGroupBy,
  LinearViewMode
} from './task-page-localized-options'

type TaskPageLinearIssueBodyProps = {
  linearViewMode: LinearViewMode
  linearGroupBy: LinearGroupBy
  linearIssueGridStyle: CSSProperties
  effectiveLinearDisplayProperties: ReadonlySet<LinearDisplayProperty>
  activeLinearIssueError: string | null
  activeLinearIssueLoading: boolean
  activeLinearIssues: LinearIssue[]
  activeLinearIssueHasCollectionError: boolean
  activeLinearIssueContextLabel: string | null
  linearSearchActive: boolean
  linearAttributeFilter: LinearIssueAttributeFilter
  filteredLinearIssues: LinearIssue[]
  linearIssuesHasMore: boolean
  onFetchMore: () => void
  boardProps: ComponentProps<typeof TaskPageLinearIssueBoard>
  listProps: ComponentProps<typeof TaskPageLinearIssueList>
  collectionErrors?: LinearWorkspaceError[]
  collectionCount: number
  collectionLabel: string
  showLinearEmptyFilteredLoadMore: boolean
  onLoadMore: () => void
  showLinearIssuePagination: boolean
  visibleLinearIssuePage: number
  linearIssueTotalPages: number
  activeLinearIssueLoadingTargetPage: number | null
  onPageChange: (page: number) => void
}

export function TaskPageLinearIssueBody({
  linearViewMode,
  linearGroupBy,
  linearIssueGridStyle,
  effectiveLinearDisplayProperties,
  activeLinearIssueError,
  activeLinearIssueLoading,
  activeLinearIssues,
  activeLinearIssueHasCollectionError,
  activeLinearIssueContextLabel,
  linearSearchActive,
  linearAttributeFilter,
  filteredLinearIssues,
  linearIssuesHasMore,
  onFetchMore,
  boardProps,
  listProps,
  collectionErrors,
  collectionCount,
  collectionLabel,
  showLinearEmptyFilteredLoadMore,
  onLoadMore,
  showLinearIssuePagination,
  visibleLinearIssuePage,
  linearIssueTotalPages,
  activeLinearIssueLoadingTargetPage,
  onPageChange
}: TaskPageLinearIssueBodyProps): React.JSX.Element {
  const emptyKind = resolveLinearIssueEmptyKind({
    hasContextLabel: Boolean(activeLinearIssueContextLabel),
    searchActive: linearSearchActive,
    attributeFilter: linearAttributeFilter,
    serverIssueCount: activeLinearIssues.length,
    filteredIssueCount: filteredLinearIssues.length
  })

  return (
    <>
      {linearViewMode === 'list' && linearGroupBy === 'none' ? (
        <div
          className="grid h-8 flex-none items-center gap-3 border-b border-border/50 bg-muted/25 px-3 text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground max-lg:!hidden lg:grid-cols-[var(--linear-grid-template)] [&>span]:min-w-0 [&>span]:truncate"
          style={linearIssueGridStyle}
        >
          <span>{translate('auto.components.TaskPage.37e7ee311e', 'Key')}</span>
          <span>{translate('auto.components.TaskPage.b1eaa18ace', 'Issue')}</span>
          {effectiveLinearDisplayProperties.has('labels') ? (
            <span>{translate('auto.components.TaskPage.d0ca4aa1d0', 'Labels')}</span>
          ) : null}
          {effectiveLinearDisplayProperties.has('team') ? (
            <span>{translate('auto.components.TaskPage.a98cbe7664', 'Team')}</span>
          ) : null}
          {effectiveLinearDisplayProperties.has('state') ? (
            <span>{translate('auto.components.TaskPage.154b0fa623', 'Status')}</span>
          ) : null}
          {effectiveLinearDisplayProperties.has('assignee') ? (
            <span className="text-center">
              {translate('auto.components.TaskPage.d2a876ca53', 'Assignee')}
            </span>
          ) : null}
          {effectiveLinearDisplayProperties.has('updated') ? (
            <span>{translate('auto.components.TaskPage.f362667d55', 'Updated')}</span>
          ) : null}
          <span />
        </div>
      ) : null}

      <div
        className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek"
        style={{ scrollbarGutter: 'stable' }}
      >
        {activeLinearIssueError ? (
          <div className="border-b border-border px-4 py-4 text-sm text-destructive">
            {activeLinearIssueError}
          </div>
        ) : null}
        {activeLinearIssueLoading && activeLinearIssues.length === 0 ? (
          <div className="divide-y divide-border/50">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="px-3 py-3">
                <div className="h-4 w-4/5 animate-pulse rounded bg-muted/70" />
                <div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-muted/60" />
              </div>
            ))}
          </div>
        ) : null}
        {!activeLinearIssueLoading &&
        activeLinearIssues.length === 0 &&
        !activeLinearIssueError &&
        activeLinearIssueHasCollectionError ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">
              {translate('auto.components.TaskPage.cc8795e07c', 'Unable to load Linear issues')}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {translate(
                'auto.components.TaskPage.5ed38a49e5',
                'Review the workspace error below, then refresh.'
              )}
            </p>
          </div>
        ) : null}
        {!activeLinearIssueLoading &&
        activeLinearIssues.length === 0 &&
        !activeLinearIssueError &&
        !activeLinearIssueHasCollectionError ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">
              {translate('auto.components.TaskPage.903c7af49f', 'No Linear issues found')}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {emptyKind === 'context'
                ? translate(
                    'auto.components.TaskPage.25ff84769a',
                    'No issues match this Linear context.'
                  )
                : emptyKind === 'search'
                  ? translate(
                      'auto.components.TaskPage.2bdefbcac3',
                      'Try a different search query.'
                    )
                  : emptyKind === 'server-attribute-filter'
                    ? translate(
                        'auto.components.TaskPage.linearEmptyAttributeFilter',
                        'No issues match the selected filters. Clear a filter or try different criteria.'
                      )
                    : translate(
                        'auto.components.TaskPage.linearEmptyUnfilteredScope',
                        'No issues in this workspace scope. Try searching or adjusting teams.'
                      )}
            </p>
          </div>
        ) : null}
        {!activeLinearIssueLoading &&
        activeLinearIssues.length > 0 &&
        filteredLinearIssues.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">
              {translate(
                'auto.components.TaskPage.618107fab3',
                'No fetched issues match the selected teams'
              )}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {translate(
                'auto.components.TaskPage.592a55611b',
                'Try selecting more teams or refreshing; team filters apply to the current fetched issue set.'
              )}
            </p>
            {shouldOfferLinearIssueFetchMore({
              emptyKind: 'client-team',
              serverHasMore: linearIssuesHasMore
            }) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3 h-7 text-xs"
                onClick={onFetchMore}
              >
                {translate('auto.components.TaskPage.linearFetchMore', 'Fetch more')}
              </Button>
            ) : null}
          </div>
        ) : null}
        {linearViewMode === 'board' ? (
          <TaskPageLinearIssueBoard {...boardProps} />
        ) : (
          <TaskPageLinearIssueList {...listProps} />
        )}
      </div>
      <LinearCollectionNotice
        errors={collectionErrors}
        hasMore={showLinearEmptyFilteredLoadMore}
        count={collectionCount}
        label={collectionLabel}
        onLoadMore={onLoadMore}
        loading={activeLinearIssueLoading}
        loadMoreLabel="Fetch more"
      />
      {showLinearIssuePagination ? (
        <div className="flex-none border-t border-border/50 bg-muted/50">
          <PaginationBar
            currentPage={visibleLinearIssuePage}
            totalPages={linearIssueTotalPages}
            loadingTarget={activeLinearIssueLoadingTargetPage}
            onPageChange={onPageChange}
          />
        </div>
      ) : null}
    </>
  )
}
