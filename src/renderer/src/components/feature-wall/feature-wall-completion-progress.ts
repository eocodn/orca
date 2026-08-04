import type { FeatureWallWorkflowId } from '../../../../shared/feature-wall-workflows'
import type { WorkbenchStepId } from '../../../../shared/workbench-steps'
import type { ReviewStepId } from '../../../../shared/review-steps'

export const FEATURE_WALL_WORKBENCH_STEP_IDS: readonly WorkbenchStepId[] = [
  'terminal',
  'editor',
  'browser'
]
export const FEATURE_WALL_REVIEW_STEP_IDS: readonly ReviewStepId[] = ['notes', 'pr-view', 'ship']

export type FeatureWallCompletionProgress = {
  workflowDone: Record<FeatureWallWorkflowId, boolean>
  workbenchStepDone: Record<WorkbenchStepId, boolean>
  reviewStepDone: Record<ReviewStepId, boolean>
}

export type FeatureWallCompletionProgressInput = {
  visitedWorkflows: ReadonlySet<FeatureWallWorkflowId>
  visitedWorkbenchSteps: ReadonlySet<WorkbenchStepId>
  visitedReviewSteps: ReadonlySet<ReviewStepId>
  completedWorkflows?: ReadonlySet<FeatureWallWorkflowId>
  completedWorkbenchSteps?: ReadonlySet<WorkbenchStepId>
  completedReviewSteps?: ReadonlySet<ReviewStepId>
  hasConnectedTaskSource: boolean
  isCheckingTaskSources: boolean
  browserUseSkillInstalled: boolean
  githubConfigured: boolean
  aiCommitPrConfigured: boolean
}

export function getFeatureWallCompletionProgress(
  input: FeatureWallCompletionProgressInput
): FeatureWallCompletionProgress {
  const workspacesVisited = input.visitedWorkflows.has('workspaces')
  const tasksVisited = input.visitedWorkflows.has('tasks')
  const workbenchVisited = input.visitedWorkflows.has('workbench')
  const reviewVisited = input.visitedWorkflows.has('review')

  const workspacesDone = workspacesVisited || input.completedWorkflows?.has('workspaces') === true
  const tasksDone =
    input.completedWorkflows?.has('tasks') === true ||
    (tasksVisited && !input.isCheckingTaskSources && input.hasConnectedTaskSource)
  const workbenchTerminalDone =
    input.completedWorkbenchSteps?.has('terminal') === true ||
    input.visitedWorkbenchSteps.has('terminal')
  const workbenchEditorDone =
    input.completedWorkbenchSteps?.has('editor') === true ||
    input.visitedWorkbenchSteps.has('editor')
  const workbenchBrowserDone =
    input.completedWorkbenchSteps?.has('browser') === true ||
    (input.visitedWorkbenchSteps.has('browser') && input.browserUseSkillInstalled)
  const workbenchAllStepsDone =
    input.completedWorkflows?.has('workbench') === true ||
    (workbenchVisited && workbenchTerminalDone && workbenchEditorDone && workbenchBrowserDone)
  const reviewNotesDone =
    input.completedReviewSteps?.has('notes') === true || input.visitedReviewSteps.has('notes')
  const reviewPrViewDone =
    input.completedReviewSteps?.has('pr-view') === true ||
    (input.visitedReviewSteps.has('pr-view') && input.githubConfigured)
  const reviewShipDone =
    input.completedReviewSteps?.has('ship') === true ||
    (input.visitedReviewSteps.has('ship') && input.aiCommitPrConfigured)
  const reviewAllStepsDone =
    input.completedWorkflows?.has('review') === true ||
    (reviewVisited && reviewNotesDone && reviewPrViewDone && reviewShipDone)

  return {
    workflowDone: {
      workspaces: workspacesDone,
      tasks: tasksDone,
      workbench: workbenchAllStepsDone,
      review: reviewAllStepsDone
    },
    workbenchStepDone: {
      terminal: workbenchTerminalDone,
      editor: workbenchEditorDone,
      browser: workbenchBrowserDone
    },
    reviewStepDone: {
      notes: reviewNotesDone,
      'pr-view': reviewPrViewDone,
      ship: reviewShipDone
    }
  }
}
