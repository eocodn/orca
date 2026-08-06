import type { ComponentProps } from 'react'
import { LoaderCircle } from 'lucide-react'

import { JiraIcon } from '@/components/icons/JiraIcon'
import { Button } from '@/components/ui/button'
import JiraIssueWorkspace from '@/components/JiraIssueWorkspace'
import { translate } from '@/i18n/i18n'
import { TaskPageJiraErrorBanner } from './task-page-jira-error-banner'
import { TaskPageJiraIssueList } from './task-page-jira-issue-list'
import { TaskPageJiraSortControls } from './task-page-jira-sort-controls'
import type { TaskPageJiraLoadError } from './task-page-jira-load-state'

type JiraSortProps = ComponentProps<typeof TaskPageJiraSortControls>
type JiraIssueListProps = ComponentProps<typeof TaskPageJiraIssueList>
type JiraWorkspaceProps = ComponentProps<typeof JiraIssueWorkspace>

type TaskPageJiraListSurfaceProps = {
  jiraStatusReady: boolean
  jiraConnected: boolean
  jiraCredentialError: string | null | undefined
  onConnect: () => void
  onHide: () => void
  displayedJiraIssueCount: number
  jiraOrderDirection: JiraSortProps['direction']
  jiraOrderBy: JiraSortProps['orderBy']
  onSort: JiraSortProps['onSort']
  jiraError: TaskPageJiraLoadError | null
  jiraErrorDetailsOpen: boolean
  onJiraErrorDetailsOpenChange: (open: boolean) => void
  jiraLoading: boolean
  jiraIssues: JiraIssueListProps['issues']
  jiraSearchInput: string
  sortedJiraIssues: JiraIssueListProps['issues']
  formatUpdatedAt: JiraIssueListProps['formatUpdatedAt']
  getStatusTone: JiraIssueListProps['getStatusTone']
  onOpenIssue: JiraIssueListProps['onOpenIssue']
  onStartWorkspace: JiraIssueListProps['onStartWorkspace']
  selectedIssue: JiraIssueListProps['selectedIssue']
  showSiteContext: boolean
  statusDirection: JiraIssueListProps['statusDirection']
  statusOrder: JiraIssueListProps['statusOrder']
  onUse: JiraWorkspaceProps['onUse']
  onClose: JiraWorkspaceProps['onClose']
  sourceContext: JiraWorkspaceProps['sourceContext']
}

export function TaskPageJiraListSurface({
  jiraStatusReady,
  jiraConnected,
  jiraCredentialError,
  onConnect,
  onHide,
  displayedJiraIssueCount,
  jiraOrderDirection,
  jiraOrderBy,
  onSort,
  jiraError,
  jiraErrorDetailsOpen,
  onJiraErrorDetailsOpenChange,
  jiraLoading,
  jiraIssues,
  jiraSearchInput,
  sortedJiraIssues,
  formatUpdatedAt,
  getStatusTone,
  onOpenIssue,
  onStartWorkspace,
  selectedIssue,
  showSiteContext,
  statusDirection,
  statusOrder,
  onUse,
  onClose,
  sourceContext
}: TaskPageJiraListSurfaceProps): React.JSX.Element {
  if (!jiraStatusReady) {
    return (
      <div className="mt-4 flex items-center justify-center py-14">
        <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!jiraConnected) {
    return (
      <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
        <JiraIcon className="mb-4 size-8 text-muted-foreground/60" />
        <p className="text-base font-medium text-foreground">
          {translate('auto.components.TaskPage.a150c59da7', 'Connect your Jira site')}
        </p>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">
          {translate(
            'auto.components.TaskPage.b518ae6307',
            'Browse, edit, create, and start work from Jira issues directly from here.'
          )}
        </p>
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <Button onClick={onConnect}>
            {translate('auto.components.TaskPage.83bce6be5c', 'Connect Jira')}
          </Button>
          <Button variant="outline" onClick={onHide}>
            {translate('auto.components.TaskPage.e7115334aa', 'Hide Jira')}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 max-h-full flex-col overflow-hidden rounded-md rounded-t-none border border-t-0 border-border/50 bg-background shadow-sm">
      <div className="flex h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3">
        <div className="min-w-0 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {translate('auto.components.TaskPage.63b2abd3aa', 'Jira issues')}
        </div>
        <div className="shrink-0 text-[11px] text-muted-foreground">
          {displayedJiraIssueCount} {translate('auto.components.TaskPage.b7bae28b6a', 'shown')}
        </div>
      </div>
      <TaskPageJiraSortControls
        direction={jiraOrderDirection}
        onSort={onSort}
        orderBy={jiraOrderBy}
      />
      <div
        className="min-h-0 flex-1 overflow-y-auto scrollbar-sleek"
        style={{ scrollbarGutter: 'stable' }}
      >
        {jiraCredentialError ? (
          <div className="border-b border-border px-4 py-4 text-sm text-destructive">
            {jiraCredentialError}
          </div>
        ) : null}
        {!jiraCredentialError && jiraError ? (
          <TaskPageJiraErrorBanner
            error={jiraError}
            open={jiraErrorDetailsOpen}
            onOpenChange={onJiraErrorDetailsOpenChange}
          />
        ) : null}
        {jiraLoading && jiraIssues.length === 0 ? (
          <div className="divide-y divide-border/50">
            {Array.from({ length: 6 }).map((_, index) => (
              <div key={index} className="px-3 py-3">
                <div className="h-4 w-4/5 animate-pulse rounded bg-muted/70" />
                <div className="mt-2 h-3 w-3/5 animate-pulse rounded bg-muted/60" />
              </div>
            ))}
          </div>
        ) : null}
        {!jiraLoading && jiraIssues.length === 0 && !jiraError && !jiraCredentialError ? (
          <div className="px-4 py-10 text-center">
            <p className="text-sm font-medium text-foreground">
              {translate('auto.components.TaskPage.eba87f2edb', 'No Jira issues found')}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {jiraSearchInput
                ? translate('auto.components.TaskPage.f51e254d35', 'Try a different JQL query.')
                : translate(
                    'auto.components.TaskPage.94d900518d',
                    'No issues match the selected preset.'
                  )}
            </p>
          </div>
        ) : null}
        <TaskPageJiraIssueList
          formatUpdatedAt={formatUpdatedAt}
          getStatusTone={getStatusTone}
          issues={sortedJiraIssues}
          onOpenIssue={onOpenIssue}
          onStartWorkspace={onStartWorkspace}
          selectedIssue={selectedIssue}
          showSiteContext={showSiteContext}
          statusDirection={statusDirection}
          statusOrder={statusOrder}
        />
      </div>
      <JiraIssueWorkspace
        issue={selectedIssue}
        onUse={onUse}
        onClose={onClose}
        sourceContext={sourceContext}
      />
    </div>
  )
}
