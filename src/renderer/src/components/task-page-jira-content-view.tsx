import type React from 'react'

import { formatRelativeTime } from './task-page-query-model'
import { TaskPageJiraListSurface } from './task-page-jira-list-surface'
import { getJiraStatusTone } from './task-page-linear-cells'
import type { TaskPageController } from './use-task-page-controller'

type Props = { controller: TaskPageController }

export function TaskPageJiraContentView({ controller }: Props): React.JSX.Element {
  return (
    <TaskPageJiraListSurface
      jiraStatusReady={controller.jiraStatusReady}
      jiraConnected={controller.jiraConnected}
      jiraCredentialError={controller.jiraStatus.credentialError}
      onConnect={() => controller.setJiraConnectOpen(true)}
      onHide={() => controller.hideTaskSource('jira', 'Jira')}
      displayedJiraIssueCount={controller.displayedJiraIssues.length}
      jiraOrderDirection={controller.jiraOrderDirection}
      jiraOrderBy={controller.jiraOrderBy}
      onSort={controller.handleJiraSort}
      jiraError={controller.jiraError}
      jiraErrorDetailsOpen={controller.jiraErrorDetailsOpen}
      onJiraErrorDetailsOpenChange={controller.setJiraErrorDetailsOpen}
      jiraLoading={controller.jiraLoading}
      jiraIssues={controller.jiraIssues}
      jiraSearchInput={controller.jiraSearchInput}
      sortedJiraIssues={controller.sortedJiraIssues}
      formatUpdatedAt={formatRelativeTime}
      getStatusTone={getJiraStatusTone}
      onOpenIssue={controller.openJiraDetailPage}
      onStartWorkspace={controller.handleUseJiraItem}
      selectedIssue={controller.selectedJiraIssue}
      showSiteContext={controller.selectedJiraSiteId === 'all'}
      statusDirection={controller.jiraOrderBy === 'status' ? controller.jiraOrderDirection : 'asc'}
      statusOrder={controller.displayedJiraStatusOrder}
      onUse={controller.handleUseJiraItem}
      onClose={controller.closeTaskDetailPage}
      sourceContext={controller.jiraDetailSourceContext}
    />
  )
}
