import type React from 'react'
import { translate } from '@/i18n/i18n'
import { TaskPageLinearIssueAttributes } from './task-page-linear-issue-attributes'
import type {
  LinearLabel,
  LinearMember,
  LinearProjectSummary,
  LinearWorkflowState
} from '../../../shared/types'
import type { MetadataState } from '@/hooks/issue-metadata-state'

type Setter<T> = React.Dispatch<React.SetStateAction<T>>
export type TaskPageLinearIssueFormContext = {
  newLinearIssueSubmitting: boolean
  handleCreateNewLinearIssue: () => Promise<void>
  newLinearIssueTitle: string
  setNewLinearIssueTitle: Setter<string>
  newLinearIssueBody: string
  setNewLinearIssueBody: Setter<string>
  newLinearStates: MetadataState<LinearWorkflowState[]>
  newLinearIssueStateId: string | null
  setNewLinearIssueStateId: Setter<string | null>
  newLinearMembers: MetadataState<LinearMember[]>
  newLinearIssueAssigneeId: string | null
  setNewLinearIssueAssigneeId: Setter<string | null>
  newLinearIssuePriority: number
  setNewLinearIssuePriority: Setter<number>
  newLinearIssueProjects: LinearProjectSummary[]
  newLinearIssueProjectsLoading: boolean
  newLinearIssueProjectId: string | null
  setNewLinearIssueProjectId: Setter<string | null>
  newLinearLabels: MetadataState<LinearLabel[]>
  newLinearIssueLabelIds: string[]
  setNewLinearIssueLabelIds: Setter<string[]>
  submitShortcutLabel: string
}

export function TaskPageLinearIssueForm({
  context
}: {
  context: TaskPageLinearIssueFormContext
}): React.JSX.Element {
  const {
    newLinearIssueSubmitting,
    handleCreateNewLinearIssue,
    newLinearIssueTitle,
    setNewLinearIssueTitle,
    newLinearIssueBody,
    setNewLinearIssueBody
  } = context
  return (
    <div className="flex flex-col px-6 py-4 gap-3">
      {/* Title */}
      <input
        autoFocus
        value={newLinearIssueTitle}
        onChange={(e) => setNewLinearIssueTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault()
            void handleCreateNewLinearIssue()
          }
        }}
        placeholder={translate('auto.components.TaskPage.d9151fd4e9', 'Issue title')}
        disabled={newLinearIssueSubmitting}
        className="text-lg font-semibold bg-transparent border-none outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 p-0 placeholder:text-muted-foreground/40 text-foreground w-full"
      />

      {/* Description */}
      <textarea
        value={newLinearIssueBody}
        onChange={(e) => setNewLinearIssueBody(e.target.value)}
        placeholder={translate('auto.components.TaskPage.9bc8aea407', 'Add description...')}
        rows={5}
        disabled={newLinearIssueSubmitting}
        className="w-full min-w-0 text-sm bg-transparent border-none outline-none focus:outline-none focus:ring-0 focus-visible:ring-0 p-0 placeholder:text-muted-foreground/45 text-foreground resize-none max-h-60 overflow-y-auto scrollbar-sleek py-1"
      />
      <TaskPageLinearIssueAttributes context={context} />
    </div>
  )
}
