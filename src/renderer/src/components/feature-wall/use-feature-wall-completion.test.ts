import { describe, expect, it } from 'vitest'
import type { FeatureWallWorkflowId } from '../../../../shared/feature-wall-workflows'
import type { ReviewStepId } from '../../../../shared/review-steps'
import type { WorkbenchStepId } from '../../../../shared/workbench-steps'
import {
  normalizeFeatureWallVisitedReviewSteps,
  normalizeFeatureWallVisitedWorkbenchSteps,
  normalizeFeatureWallVisitedWorkflows
} from './feature-wall-completion-persistence'
import { getFeatureWallCompletionProgress } from './feature-wall-completion-progress'

type CompletionInput = Parameters<typeof getFeatureWallCompletionProgress>[0]

function completionInput(overrides: Partial<CompletionInput> = {}): CompletionInput {
  return {
    visitedWorkflows: new Set<FeatureWallWorkflowId>(),
    visitedWorkbenchSteps: new Set<WorkbenchStepId>(),
    visitedReviewSteps: new Set<ReviewStepId>(),
    hasConnectedTaskSource: false,
    isCheckingTaskSources: false,
    browserUseSkillInstalled: false,
    githubConfigured: false,
    aiCommitPrConfigured: false,
    ...overrides
  }
}

describe('getFeatureWallCompletionProgress', () => {
  it('does not complete setup-backed items before the user visits them', () => {
    const progress = getFeatureWallCompletionProgress(
      completionInput({
        hasConnectedTaskSource: true,
        browserUseSkillInstalled: true,
        githubConfigured: true,
        aiCommitPrConfigured: true
      })
    )

    expect(progress.workflowDone.tasks).toBe(false)
    expect(progress.workflowDone.workbench).toBe(false)
    expect(progress.workflowDone.review).toBe(false)
    expect(progress.workbenchStepDone.browser).toBe(false)
    expect(progress.reviewStepDone['pr-view']).toBe(false)
    expect(progress.reviewStepDone.ship).toBe(false)
  })

  it('completes tasks only after the user visits Tasks and a source is connected', () => {
    const visitedTasks = completionInput({
      visitedWorkflows: new Set<FeatureWallWorkflowId>(['tasks'])
    })
    expect(getFeatureWallCompletionProgress(visitedTasks).workflowDone.tasks).toBe(false)
    expect(
      getFeatureWallCompletionProgress({ ...visitedTasks, hasConnectedTaskSource: true })
        .workflowDone.tasks
    ).toBe(true)
  })

  it('keeps completed retained workflows and substeps complete', () => {
    const progress = getFeatureWallCompletionProgress(
      completionInput({
        completedWorkflows: new Set<FeatureWallWorkflowId>(['workspaces', 'review']),
        completedWorkbenchSteps: new Set<WorkbenchStepId>(['browser']),
        completedReviewSteps: new Set<ReviewStepId>(['ship'])
      })
    )

    expect(progress.workflowDone.workspaces).toBe(true)
    expect(progress.workflowDone.review).toBe(true)
    expect(progress.workbenchStepDone.browser).toBe(true)
    expect(progress.reviewStepDone.ship).toBe(true)
  })

  it('keeps the review workflow complete after its retained steps are restored', () => {
    expect(
      getFeatureWallCompletionProgress(
        completionInput({
          visitedWorkflows: new Set<FeatureWallWorkflowId>(['review']),
          visitedReviewSteps: new Set<ReviewStepId>(['notes', 'pr-view', 'ship']),
          githubConfigured: true,
          aiCommitPrConfigured: true
        })
      ).workflowDone.review
    ).toBe(true)
  })

  it('keeps the workbench workflow complete after its retained steps are restored', () => {
    expect(
      getFeatureWallCompletionProgress(
        completionInput({
          visitedWorkflows: new Set<FeatureWallWorkflowId>(['workbench']),
          visitedWorkbenchSteps: new Set<WorkbenchStepId>(['terminal', 'editor', 'browser']),
          browserUseSkillInstalled: true
        })
      ).workflowDone.workbench
    ).toBe(true)
  })

  it('requires the Browser Use skill before completing the browser step', () => {
    const browserVisited = completionInput({
      visitedWorkflows: new Set<FeatureWallWorkflowId>(['workbench']),
      visitedWorkbenchSteps: new Set<WorkbenchStepId>(['terminal', 'editor', 'browser'])
    })

    expect(getFeatureWallCompletionProgress(browserVisited).workbenchStepDone.browser).toBe(false)
    expect(
      getFeatureWallCompletionProgress({ ...browserVisited, browserUseSkillInstalled: true })
        .workflowDone.workbench
    ).toBe(true)
  })
})

describe('feature wall completion persistence normalization', () => {
  it('keeps persisted workflow visits and drops duplicates or unknown ids', () => {
    expect(normalizeFeatureWallVisitedWorkflows(['workspaces', 'tasks', 'tasks', 'bogus'])).toEqual(
      ['workspaces', 'tasks']
    )
  })

  it('keeps retained workbench and review visits and drops unknown steps', () => {
    expect(
      normalizeFeatureWallVisitedWorkbenchSteps([
        'terminal',
        'editor',
        'browser',
        'editor',
        'bogus'
      ])
    ).toEqual(['terminal', 'editor', 'browser'])
    expect(
      normalizeFeatureWallVisitedReviewSteps(['notes', 'pr-view', 'ship', 'notes', 'bogus'])
    ).toEqual(['notes', 'pr-view', 'ship'])
  })
})
