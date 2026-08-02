import type { JiraIssueFilter, JiraSiteSelection } from '../../shared/types'
import {
  getStatus as getJiraStatus,
  selectSite as selectJiraSite,
  testConnection as testJiraConnection
} from '../jira/client'
import {
  getIssue as getJiraIssue,
  getIssueSummary as getJiraIssueSummary,
  getIssueComments as getJiraIssueComments,
  getProjectStatusOrder as getJiraProjectStatusOrder,
  listAssignableUsers as listJiraAssignableUsers,
  listCreateFields as listJiraCreateFields,
  listIssueTypes as listJiraIssueTypes,
  listIssues as listJiraIssues,
  listPriorities as listJiraPriorities,
  listProjects as listJiraProjects,
  listTransitions as listJiraTransitions,
  searchIssues as searchJiraIssues
} from '../jira/issues'

export type JiraReadDependencies = Partial<{
  getStatus: typeof getJiraStatus
  selectSite: typeof selectJiraSite
  testConnection: typeof testJiraConnection
  getIssue: typeof getJiraIssue
  getIssueSummary: typeof getJiraIssueSummary
  getIssueComments: typeof getJiraIssueComments
  getProjectStatusOrder: typeof getJiraProjectStatusOrder
  listAssignableUsers: typeof listJiraAssignableUsers
  listCreateFields: typeof listJiraCreateFields
  listIssueTypes: typeof listJiraIssueTypes
  listIssues: typeof listJiraIssues
  listPriorities: typeof listJiraPriorities
  listProjects: typeof listJiraProjects
  listTransitions: typeof listJiraTransitions
  searchIssues: typeof searchJiraIssues
}>

const defaults: Required<JiraReadDependencies> = {
  getStatus: getJiraStatus,
  selectSite: selectJiraSite,
  testConnection: testJiraConnection,
  getIssue: getJiraIssue,
  getIssueSummary: getJiraIssueSummary,
  getIssueComments: getJiraIssueComments,
  getProjectStatusOrder: getJiraProjectStatusOrder,
  listAssignableUsers: listJiraAssignableUsers,
  listCreateFields: listJiraCreateFields,
  listIssueTypes: listJiraIssueTypes,
  listIssues: listJiraIssues,
  listPriorities: listJiraPriorities,
  listProjects: listJiraProjects,
  listTransitions: listJiraTransitions,
  searchIssues: searchJiraIssues
}

export class RuntimeJiraReadCommands {
  private readonly dependencies: Required<JiraReadDependencies>

  constructor(dependencies: JiraReadDependencies = {}) {
    this.dependencies = { ...defaults, ...dependencies }
  }

  jiraSelectSite(siteId: JiraSiteSelection): ReturnType<typeof getJiraStatus> {
    return this.dependencies.selectSite(siteId)
  }

  jiraStatus(): ReturnType<typeof getJiraStatus> {
    return this.dependencies.getStatus()
  }

  jiraReadStatus(): ReturnType<typeof getJiraStatus> {
    return this.dependencies.getStatus()
  }

  jiraTestConnection(siteId?: string): ReturnType<typeof testJiraConnection> {
    return this.dependencies.testConnection(siteId)
  }

  jiraSearchIssues(
    jql: string,
    limit = 30,
    siteId?: JiraSiteSelection,
    signal?: AbortSignal
  ): ReturnType<typeof searchJiraIssues> {
    return this.dependencies.searchIssues(jql, Math.min(Math.max(1, limit), 100), siteId, signal)
  }

  jiraListIssues(
    filter?: JiraIssueFilter,
    limit = 30,
    siteId?: JiraSiteSelection
  ): ReturnType<typeof listJiraIssues> {
    return this.dependencies.listIssues(filter, Math.min(Math.max(1, limit), 100), siteId)
  }

  jiraGetIssue(key: string, siteId?: string): ReturnType<typeof getJiraIssue> {
    return this.dependencies.getIssue(key, siteId)
  }

  jiraLookupIssueSummary(
    key: string,
    siteId: string,
    signal?: AbortSignal
  ): ReturnType<typeof getJiraIssueSummary> {
    return this.dependencies.getIssueSummary(key, siteId, signal)
  }

  jiraIssueComments(key: string, siteId?: string): ReturnType<typeof getJiraIssueComments> {
    return this.dependencies.getIssueComments(key, siteId)
  }

  jiraListProjects(siteId?: JiraSiteSelection): ReturnType<typeof listJiraProjects> {
    return this.dependencies.listProjects(siteId)
  }

  jiraListIssueTypes(
    projectIdOrKey: string,
    siteId?: string
  ): ReturnType<typeof listJiraIssueTypes> {
    return this.dependencies.listIssueTypes(projectIdOrKey, siteId)
  }

  jiraListCreateFields(
    projectIdOrKey: string,
    issueTypeId: string,
    siteId?: string
  ): ReturnType<typeof listJiraCreateFields> {
    return this.dependencies.listCreateFields(projectIdOrKey, issueTypeId, siteId)
  }

  jiraListPriorities(siteId?: string): ReturnType<typeof listJiraPriorities> {
    return this.dependencies.listPriorities(siteId)
  }

  jiraListAssignableUsers(
    key: string,
    query?: string,
    siteId?: string
  ): ReturnType<typeof listJiraAssignableUsers> {
    return this.dependencies.listAssignableUsers(key, query, siteId)
  }

  jiraListTransitions(key: string, siteId?: string): ReturnType<typeof listJiraTransitions> {
    return this.dependencies.listTransitions(key, siteId)
  }

  jiraGetProjectStatusOrder(
    projectKey: string,
    siteId?: string
  ): ReturnType<typeof getJiraProjectStatusOrder> {
    return this.dependencies.getProjectStatusOrder(projectKey, siteId)
  }
}
