import { translate } from '@/i18n/i18n'
import { getLinearPriorityLabel } from '@/components/task-page-localized-options'
import type { LinearIssue } from '../../../shared/types'
import type { LinearOrderBy, LinearGroupBy } from '@/components/task-page-localized-options'

export type LinearGroupSection = { key: string; label: string; issues: LinearIssue[] }

function getLinearPriorityRank(priority: number): number {
  return priority === 0 ? 5 : priority
}

export function compareLinearIssues(
  a: LinearIssue,
  b: LinearIssue,
  orderBy: LinearOrderBy
): number {
  if (orderBy === 'updated') {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  }
  if (orderBy === 'identifier') {
    return a.identifier.localeCompare(b.identifier, undefined, { numeric: true })
  }
  const priorityDelta = getLinearPriorityRank(a.priority) - getLinearPriorityRank(b.priority)
  return priorityDelta !== 0
    ? priorityDelta
    : new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
}

function getLinearIssueGroup(
  issue: LinearIssue,
  groupBy: LinearGroupBy
): { key: string; label: string } {
  if (groupBy === 'status') {
    return { key: `status:${issue.state.name}`, label: issue.state.name }
  }
  if (groupBy === 'assignee') {
    return {
      key: `assignee:${issue.assignee?.id ?? 'unassigned'}`,
      label: issue.assignee?.displayName ?? 'Unassigned'
    }
  }
  if (groupBy === 'priority') {
    return { key: `priority:${issue.priority}`, label: getLinearPriorityLabel(issue.priority) }
  }
  if (groupBy === 'team') {
    return { key: `team:${issue.team.id}`, label: issue.team.name }
  }
  return { key: 'all', label: translate('auto.components.TaskPage.dfc0c79bd8', 'Issues') }
}

export function groupLinearIssues(
  issues: LinearIssue[],
  groupBy: LinearGroupBy,
  orderBy: LinearOrderBy
): LinearGroupSection[] {
  const sorted = [...issues].sort((a, b) => compareLinearIssues(a, b, orderBy))
  if (groupBy === 'none') {
    return [
      {
        key: 'all',
        label: translate('auto.components.TaskPage.dfc0c79bd8', 'Issues'),
        issues: sorted
      }
    ]
  }
  const sections = new Map<string, LinearGroupSection>()
  for (const issue of sorted) {
    const group = getLinearIssueGroup(issue, groupBy)
    const section = sections.get(group.key)
    if (section) {
      section.issues.push(issue)
    } else {
      sections.set(group.key, { key: group.key, label: group.label, issues: [issue] })
    }
  }
  return [...sections.values()]
}
