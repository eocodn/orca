import type { LinearIssue } from '../../../shared/types'
import type {
  LinearDisplayProperty,
  LinearGroupBy
} from './task-page-localized-options'
import type { LinearGroupSection } from './task-page-linear-grouping'

export type LinearIssueListRow =
  | { type: 'section'; key: string; label: string; count: number }
  | { type: 'issue'; issue: LinearIssue }

export type LinearIssuePageState<T> = {
  loadedPages: number
  totalPages: number
  visiblePage: number
  issues: T[]
}

export function getLinearIssuePageState<T>(
  issues: T[],
  activePage: number,
  itemLimit: number,
  canRequestMore: boolean
): LinearIssuePageState<T> {
  const loadedPages = Math.max(1, Math.ceil(issues.length / itemLimit))
  const totalPages = issues.length === 0 ? 1 : loadedPages + (canRequestMore ? 1 : 0)
  const visiblePage = Math.min(activePage, Math.max(0, loadedPages - 1))
  const start = visiblePage * itemLimit
  return {
    loadedPages,
    totalPages,
    visiblePage,
    issues: issues.slice(start, start + itemLimit)
  }
}

export function getEffectiveLinearDisplayProperties(
  properties: readonly LinearDisplayProperty[],
  groupBy: LinearGroupBy,
  selectedTeamCount: number,
  teamPropertyTouched: boolean
): Set<LinearDisplayProperty> {
  const next = new Set(properties)
  const groupedProperty =
    groupBy === 'status'
      ? 'state'
      : groupBy === 'assignee' || groupBy === 'priority' || groupBy === 'team'
        ? groupBy
        : null
  if (groupedProperty) {
    next.delete(groupedProperty)
  }

  if (selectedTeamCount <= 1 && !teamPropertyTouched) {
    next.delete('team')
  } else if (selectedTeamCount > 1 && !teamPropertyTouched) {
    next.add('team')
  }
  return next
}

export function getLinearIssueListRows(
  sections: LinearGroupSection[],
  groupBy: LinearGroupBy
): LinearIssueListRow[] {
  return sections.flatMap((section) => {
    const issueRows = section.issues.map((issue) => ({ type: 'issue' as const, issue }))
    if (groupBy === 'none') {
      return issueRows
    }
    return [
      {
        type: 'section' as const,
        key: section.key,
        label: section.label,
        count: section.issues.length
      },
      ...issueRows
    ]
  })
}
