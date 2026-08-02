import {
  RuntimeJiraReadCommands,
  type JiraReadDependencies
} from './orca-runtime-jira-read-commands'
import {
  RuntimeJiraWriteCommands,
  type JiraWriteDependencies
} from './orca-runtime-jira-write-commands'

export type JiraCommandDependencies = JiraReadDependencies & JiraWriteDependencies

export class RuntimeJiraCommands {
  private readonly readCommands: RuntimeJiraReadCommands
  private readonly writeCommands: RuntimeJiraWriteCommands

  constructor(dependencies: JiraCommandDependencies = {}) {
    this.readCommands = new RuntimeJiraReadCommands(dependencies)
    this.writeCommands = new RuntimeJiraWriteCommands(dependencies)
  }

  jiraConnect: RuntimeJiraWriteCommands['jiraConnect'] = (...args) =>
    this.writeCommands.jiraConnect(...args)
  jiraDisconnect: RuntimeJiraWriteCommands['jiraDisconnect'] = (...args) =>
    this.writeCommands.jiraDisconnect(...args)
  jiraSelectSite: RuntimeJiraReadCommands['jiraSelectSite'] = (...args) =>
    this.readCommands.jiraSelectSite(...args)
  jiraStatus: RuntimeJiraReadCommands['jiraStatus'] = (...args) =>
    this.readCommands.jiraStatus(...args)
  jiraReadStatus: RuntimeJiraReadCommands['jiraReadStatus'] = (...args) =>
    this.readCommands.jiraReadStatus(...args)
  jiraTestConnection: RuntimeJiraReadCommands['jiraTestConnection'] = (...args) =>
    this.readCommands.jiraTestConnection(...args)
  jiraSearchIssues: RuntimeJiraReadCommands['jiraSearchIssues'] = (...args) =>
    this.readCommands.jiraSearchIssues(...args)
  jiraListIssues: RuntimeJiraReadCommands['jiraListIssues'] = (...args) =>
    this.readCommands.jiraListIssues(...args)
  jiraCreateIssue: RuntimeJiraWriteCommands['jiraCreateIssue'] = (...args) =>
    this.writeCommands.jiraCreateIssue(...args)
  jiraGetIssue: RuntimeJiraReadCommands['jiraGetIssue'] = (...args) =>
    this.readCommands.jiraGetIssue(...args)
  jiraLookupIssueSummary: RuntimeJiraReadCommands['jiraLookupIssueSummary'] = (...args) =>
    this.readCommands.jiraLookupIssueSummary(...args)
  jiraUpdateIssue: RuntimeJiraWriteCommands['jiraUpdateIssue'] = (...args) =>
    this.writeCommands.jiraUpdateIssue(...args)
  jiraAddIssueComment: RuntimeJiraWriteCommands['jiraAddIssueComment'] = (...args) =>
    this.writeCommands.jiraAddIssueComment(...args)
  jiraIssueComments: RuntimeJiraReadCommands['jiraIssueComments'] = (...args) =>
    this.readCommands.jiraIssueComments(...args)
  jiraListProjects: RuntimeJiraReadCommands['jiraListProjects'] = (...args) =>
    this.readCommands.jiraListProjects(...args)
  jiraListIssueTypes: RuntimeJiraReadCommands['jiraListIssueTypes'] = (...args) =>
    this.readCommands.jiraListIssueTypes(...args)
  jiraListCreateFields: RuntimeJiraReadCommands['jiraListCreateFields'] = (...args) =>
    this.readCommands.jiraListCreateFields(...args)
  jiraListPriorities: RuntimeJiraReadCommands['jiraListPriorities'] = (...args) =>
    this.readCommands.jiraListPriorities(...args)
  jiraListAssignableUsers: RuntimeJiraReadCommands['jiraListAssignableUsers'] = (...args) =>
    this.readCommands.jiraListAssignableUsers(...args)
  jiraListTransitions: RuntimeJiraReadCommands['jiraListTransitions'] = (...args) =>
    this.readCommands.jiraListTransitions(...args)
  jiraGetProjectStatusOrder: RuntimeJiraReadCommands['jiraGetProjectStatusOrder'] = (...args) =>
    this.readCommands.jiraGetProjectStatusOrder(...args)
}
