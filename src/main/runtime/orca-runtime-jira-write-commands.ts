import type { JiraConnectArgs, JiraCreateIssueArgs, JiraIssueUpdate } from '../../shared/types'
import { connect as connectJira, disconnect as disconnectJira } from '../jira/client'
import {
  addIssueComment as addJiraIssueComment,
  createIssue as createJiraIssue,
  updateIssue as updateJiraIssue
} from '../jira/issues'

export type JiraWriteDependencies = Partial<{
  connect: typeof connectJira
  disconnect: typeof disconnectJira
  addIssueComment: typeof addJiraIssueComment
  createIssue: typeof createJiraIssue
  updateIssue: typeof updateJiraIssue
}>

const defaults: Required<JiraWriteDependencies> = {
  connect: connectJira,
  disconnect: disconnectJira,
  addIssueComment: addJiraIssueComment,
  createIssue: createJiraIssue,
  updateIssue: updateJiraIssue
}

export class RuntimeJiraWriteCommands {
  private readonly dependencies: Required<JiraWriteDependencies>

  constructor(dependencies: JiraWriteDependencies = {}) {
    this.dependencies = { ...defaults, ...dependencies }
  }

  jiraConnect(args: JiraConnectArgs): ReturnType<typeof connectJira> {
    return this.dependencies.connect(args)
  }

  jiraDisconnect(siteId?: string): { ok: true } {
    this.dependencies.disconnect(siteId)
    return { ok: true }
  }

  jiraCreateIssue(args: JiraCreateIssueArgs): ReturnType<typeof createJiraIssue> {
    return this.dependencies.createIssue(args)
  }

  jiraUpdateIssue(
    key: string,
    updates: JiraIssueUpdate,
    siteId?: string
  ): ReturnType<typeof updateJiraIssue> {
    return this.dependencies.updateIssue(key, updates, siteId)
  }

  jiraAddIssueComment(
    key: string,
    body: string,
    siteId?: string
  ): ReturnType<typeof addJiraIssueComment> {
    return this.dependencies.addIssueComment(key, body, siteId)
  }
}
