import { useCallback, useMemo, useState } from 'react'
import type { CSSProperties, Dispatch, DragEvent, SetStateAction } from 'react'
import { toast } from 'sonner'

import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { AppState } from '@/store'
import { getLinearIssueGridTemplate } from './task-page-linear-cells'
import { groupLinearIssues, type LinearGroupSection } from './task-page-linear-grouping'
import {
  findLinearWorkflowStateForStatus,
  getLinearStatusSectionState
} from './task-page-linear-model'
import {
  getEffectiveLinearDisplayProperties,
  getLinearIssueListRows
} from './task-page-linear-list-model'
import type {
  LinearDisplayProperty,
  LinearGroupBy,
  LinearOrderBy
} from './task-page-localized-options'
import {
  readLinearBoardIssueDragData,
  writeLinearBoardIssueDragData
} from '@/lib/linear-board-drag-payload'
import { linearTeamStates, linearUpdateIssue } from '@/runtime/runtime-linear-client'
import type { RuntimeLinearSettings } from '@/runtime/runtime-linear-client'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import type { LinearIssue } from '../../../shared/types'

type Props = {
  filteredLinearIssues: LinearIssue[]
  pagedLinearIssues: LinearIssue[]
  linearTeamSelectionSize: number
  linearGroupBy: LinearGroupBy
  linearOrderBy: LinearOrderBy
  linearDisplayProperties: ReadonlySet<LinearDisplayProperty>
  linearTeamPropertyTouched: boolean
  setLinearDisplayProperties: Dispatch<SetStateAction<ReadonlySet<LinearDisplayProperty>>>
  setLinearTeamPropertyTouched: Dispatch<SetStateAction<boolean>>
  linearTaskSourceContext: TaskSourceContext | null
  settings: RuntimeLinearSettings
  patchLinearIssue: AppState['patchLinearIssue']
  invalidateLinearIssueLists: AppState['invalidateLinearIssueLists']
  patchScopedLinearIssue: (issueId: string, patch: Partial<LinearIssue>) => void
  setSelectedLinearIssueFallback: Dispatch<SetStateAction<LinearIssue | null>>
}

export function useTaskPageLinearPresentationController({
  filteredLinearIssues,
  pagedLinearIssues,
  linearTeamSelectionSize,
  linearGroupBy,
  linearOrderBy,
  linearDisplayProperties,
  linearTeamPropertyTouched,
  setLinearDisplayProperties,
  setLinearTeamPropertyTouched,
  linearTaskSourceContext,
  settings,
  patchLinearIssue,
  invalidateLinearIssueLists,
  patchScopedLinearIssue,
  setSelectedLinearIssueFallback
}: Props) {
  const [linearBoardDraggingIssueId, setLinearBoardDraggingIssueId] = useState<string | null>(null)
  const [linearBoardDragOverKey, setLinearBoardDragOverKey] = useState<string | null>(null)
  const [linearBoardUpdatingIssueIds, setLinearBoardUpdatingIssueIds] = useState<
    ReadonlySet<string>
  >(() => new Set())

  const effectiveLinearDisplayProperties = useMemo(
    () =>
      getEffectiveLinearDisplayProperties(
        [...linearDisplayProperties],
        linearGroupBy,
        linearTeamSelectionSize,
        linearTeamPropertyTouched
      ),
    [linearDisplayProperties, linearGroupBy, linearTeamPropertyTouched, linearTeamSelectionSize]
  )
  const linearIssueGridStyle = useMemo(
    () =>
      ({
        '--linear-grid-template': getLinearIssueGridTemplate(effectiveLinearDisplayProperties)
      }) as CSSProperties,
    [effectiveLinearDisplayProperties]
  )
  const linearIssueSections = useMemo(
    () => groupLinearIssues(pagedLinearIssues, linearGroupBy, linearOrderBy),
    [pagedLinearIssues, linearGroupBy, linearOrderBy]
  )
  const linearIssueListRows = useMemo(
    () => getLinearIssueListRows(linearIssueSections, linearGroupBy),
    [linearGroupBy, linearIssueSections]
  )
  const linearBoardSections = useMemo(
    () =>
      groupLinearIssues(
        pagedLinearIssues,
        linearGroupBy === 'none' ? 'status' : linearGroupBy,
        linearOrderBy
      ),
    [pagedLinearIssues, linearGroupBy, linearOrderBy]
  )
  const linearStatusBoardEnabled = linearGroupBy === 'none' || linearGroupBy === 'status'

  const handleLinearBoardCardDragStart = useCallback(
    (issue: LinearIssue, event: DragEvent<HTMLDivElement>) => {
      if (!linearStatusBoardEnabled || linearBoardUpdatingIssueIds.has(issue.id)) {
        event.preventDefault()
        return
      }
      if (!writeLinearBoardIssueDragData(event.dataTransfer, issue.id)) {
        event.preventDefault()
        return
      }
      setLinearBoardDraggingIssueId(issue.id)
    },
    [linearBoardUpdatingIssueIds, linearStatusBoardEnabled]
  )
  const handleLinearBoardDragOver = useCallback(
    (section: LinearGroupSection, event: DragEvent<HTMLElement>) => {
      if (!linearStatusBoardEnabled || !getLinearStatusSectionState(section)) {
        return
      }
      event.preventDefault()
      event.dataTransfer.dropEffect = 'move'
      setLinearBoardDragOverKey(section.key)
    },
    [linearStatusBoardEnabled]
  )
  const handleLinearBoardDrop = useCallback(
    async (section: LinearGroupSection, event: DragEvent<HTMLElement>) => {
      event.preventDefault()
      event.stopPropagation()
      setLinearBoardDragOverKey(null)
      const targetState = getLinearStatusSectionState(section)
      if (!linearStatusBoardEnabled || !targetState) {
        return
      }
      const draggedIssue = readLinearBoardIssueDragData(event.dataTransfer)
      const issueId =
        draggedIssue.status === 'issue'
          ? draggedIssue.issueId
          : draggedIssue.status === 'hidden'
            ? linearBoardDraggingIssueId
            : null
      const issue = filteredLinearIssues.find((item) => item.id === issueId)
      if (
        !issue ||
        linearBoardUpdatingIssueIds.has(issue.id) ||
        (issue.state.name === targetState.name && issue.state.type === targetState.type)
      ) {
        return
      }
      setLinearBoardUpdatingIssueIds((current) => new Set(current).add(issue.id))
      const previousState = issue.state
      const patchFallback = (state: LinearIssue['state']) => {
        setSelectedLinearIssueFallback((current) =>
          current?.id === issue.id ? { ...current, state } : current
        )
      }
      const patchState = (state: LinearIssue['state']) => {
        patchLinearIssue(issue.id, { state }, { sourceContext: linearTaskSourceContext })
        patchScopedLinearIssue(issue.id, { state })
        patchFallback(state)
      }
      try {
        const states = await linearTeamStates(
          linearTaskSourceContext ?? settings,
          issue.team.id,
          issue.workspaceId
        )
        const workflowState = findLinearWorkflowStateForStatus(states, targetState)
        if (!workflowState) {
          toast.error(
            translate(
              'auto.components.TaskPage.745ae567d4',
              '"{{value0}}" is not available for {{value1}}',
              { value0: targetState.name, value1: issue.team.name }
            )
          )
          return
        }
        const nextState: LinearIssue['state'] = {
          name: workflowState.name,
          type: workflowState.type,
          color: workflowState.color
        }
        patchState(nextState)
        const result = await linearUpdateIssue(
          linearTaskSourceContext ?? settings,
          issue.id,
          { stateId: workflowState.id },
          issue.workspaceId
        )
        if (result.ok === false) {
          patchState(previousState)
          toast.error(
            result.error ??
              translate('auto.components.TaskPage.6775c05483', 'Failed to update Linear state')
          )
          return
        }
        invalidateLinearIssueLists({ sourceContext: linearTaskSourceContext })
        useAppStore.getState().recordFeatureInteraction('linear-tasks')
      } catch {
        patchState(previousState)
        toast.error(
          translate('auto.components.TaskPage.6775c05483', 'Failed to update Linear state')
        )
      } finally {
        setLinearBoardUpdatingIssueIds((current) => {
          const next = new Set(current)
          next.delete(issue.id)
          return next
        })
      }
    },
    [
      filteredLinearIssues,
      invalidateLinearIssueLists,
      linearBoardDraggingIssueId,
      linearBoardUpdatingIssueIds,
      linearStatusBoardEnabled,
      linearTaskSourceContext,
      patchLinearIssue,
      patchScopedLinearIssue,
      setSelectedLinearIssueFallback,
      settings
    ]
  )
  const toggleLinearDisplayProperty = useCallback(
    (property: LinearDisplayProperty): void => {
      if (property === 'team') {
        setLinearTeamPropertyTouched(true)
      }
      setLinearDisplayProperties((current) => {
        const next = new Set(current)
        if (next.has(property)) {
          next.delete(property)
        } else {
          next.add(property)
        }
        return next
      })
    },
    [setLinearDisplayProperties, setLinearTeamPropertyTouched]
  )

  return {
    effectiveLinearDisplayProperties,
    linearIssueGridStyle,
    linearIssueListRows,
    linearBoardSections,
    linearStatusBoardEnabled,
    linearBoardDraggingIssueId,
    setLinearBoardDraggingIssueId,
    linearBoardDragOverKey,
    setLinearBoardDragOverKey,
    linearBoardUpdatingIssueIds,
    handleLinearBoardCardDragStart,
    handleLinearBoardDragOver,
    handleLinearBoardDrop,
    toggleLinearDisplayProperty
  }
}
