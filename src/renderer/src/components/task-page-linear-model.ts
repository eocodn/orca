import type {
  LinearCollectionResult,
  LinearDisplayProperty,
  LinearIssue,
  LinearWorkflowState
} from '../../../shared/types'
import type { LinearGroupSection } from './task-page-linear-grouping'

export const DEFAULT_LINEAR_DISPLAY_PROPERTIES: LinearDisplayProperty[] = [
  'state',
  'priority',
  'assignee',
  'team',
  'labels',
  'updated'
]

export function mergeLinearCollectionResults<T>(
  results: LinearCollectionResult<T>[]
): LinearCollectionResult<T> {
  const errors = results.flatMap((result) => result.errors ?? [])
  return {
    items: results.flatMap((result) => result.items),
    ...(errors.length > 0 ? { errors } : {}),
    ...(results.some((result) => result.hasMore) ? { hasMore: true } : {})
  }
}

export function getLinearStatusSectionState(
  section: LinearGroupSection
): LinearIssue['state'] | null {
  if (!section.key.startsWith('status:')) {
    return null
  }
  return section.issues[0]?.state ?? null
}

export function findLinearWorkflowStateForStatus(
  states: LinearWorkflowState[],
  targetState: LinearIssue['state']
): LinearWorkflowState | undefined {
  return (
    states.find((state) => state.name === targetState.name && state.type === targetState.type) ??
    states.find((state) => state.name === targetState.name)
  )
}
