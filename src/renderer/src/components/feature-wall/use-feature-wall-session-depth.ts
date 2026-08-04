import { useCallback, useEffect, useRef } from 'react'
import type { FeatureWallWorkflowId } from '../../../../shared/feature-wall-workflows'
import type { FeatureWallTourDepthSummary } from '../../../../shared/feature-wall-tour-depth'
import { buildFeatureWallTourDepthSummary } from '../../../../shared/feature-wall-tour-depth'
import type { ReviewStepId } from '../../../../shared/review-steps'
import type { WorkbenchStepId } from '../../../../shared/workbench-steps'
import { getFeatureWallCompletionProgress } from './feature-wall-completion-progress'

type FeatureWallSessionDepthInput = {
  isOpen: boolean
  hasConnectedTaskSource: boolean
  isCheckingTaskSources: boolean
  browserUseSkillInstalled: boolean
  githubConfigured: boolean
  aiCommitPrConfigured: boolean
  onTourDepthSummaryChange?: (summary: FeatureWallTourDepthSummary) => void
}

export type FeatureWallSessionDepthTracker = {
  markWorkflowVisitedForSession: (id: FeatureWallWorkflowId) => void
  markWorkbenchStepVisitedForSession: (id: WorkbenchStepId) => void
  markReviewStepVisitedForSession: (id: ReviewStepId) => void
  getTourDepthSummary: () => FeatureWallTourDepthSummary
}

export function useFeatureWallSessionDepth(
  input: FeatureWallSessionDepthInput
): FeatureWallSessionDepthTracker {
  const {
    isOpen,
    hasConnectedTaskSource,
    isCheckingTaskSources,
    browserUseSkillInstalled,
    githubConfigured,
    aiCommitPrConfigured,
    onTourDepthSummaryChange
  } = input
  const sessionDepthRef = useRef<{
    visitedWorkflows: Set<FeatureWallWorkflowId>
    visitedWorkbenchSteps: Set<WorkbenchStepId>
    visitedReviewSteps: Set<ReviewStepId>
    lastGroupId: FeatureWallWorkflowId | null
  }>({
    visitedWorkflows: new Set(),
    visitedWorkbenchSteps: new Set(),
    visitedReviewSteps: new Set(),
    lastGroupId: null
  })

  const getTourDepthSummary = useCallback((): FeatureWallTourDepthSummary => {
    const session = sessionDepthRef.current
    const progress = getFeatureWallCompletionProgress({
      visitedWorkflows: session.visitedWorkflows,
      visitedWorkbenchSteps: session.visitedWorkbenchSteps,
      visitedReviewSteps: session.visitedReviewSteps,
      hasConnectedTaskSource,
      isCheckingTaskSources,
      browserUseSkillInstalled,
      githubConfigured,
      aiCommitPrConfigured
    })
    return buildFeatureWallTourDepthSummary({
      ...progress,
      visitedWorkflows: session.visitedWorkflows,
      visitedWorkbenchSteps: session.visitedWorkbenchSteps,
      visitedReviewSteps: session.visitedReviewSteps,
      lastGroupId: session.lastGroupId
    })
  }, [
    aiCommitPrConfigured,
    browserUseSkillInstalled,
    githubConfigured,
    hasConnectedTaskSource,
    isCheckingTaskSources
  ])

  const publishTourDepthSummary = useCallback((): void => {
    onTourDepthSummaryChange?.(getTourDepthSummary())
  }, [getTourDepthSummary, onTourDepthSummaryChange])

  const wasOpenRef = useRef(false)
  useEffect(() => {
    if (!isOpen) {
      wasOpenRef.current = false
      return
    }
    const openedNow = !wasOpenRef.current
    wasOpenRef.current = true
    if (openedNow) {
      // Depth telemetry is per explicit tour session, not persisted completion.
      sessionDepthRef.current = {
        visitedWorkflows: new Set(),
        visitedWorkbenchSteps: new Set(),
        visitedReviewSteps: new Set(),
        lastGroupId: null
      }
    }
    publishTourDepthSummary()
  }, [isOpen, publishTourDepthSummary])

  const markWorkflowVisitedForSession = useCallback(
    (id: FeatureWallWorkflowId): void => {
      const session = sessionDepthRef.current
      session.lastGroupId = id
      session.visitedWorkflows.add(id)
      publishTourDepthSummary()
    },
    [publishTourDepthSummary]
  )
  const markWorkbenchStepVisitedForSession = useCallback(
    (id: WorkbenchStepId): void => {
      sessionDepthRef.current.visitedWorkbenchSteps.add(id)
      publishTourDepthSummary()
    },
    [publishTourDepthSummary]
  )
  const markReviewStepVisitedForSession = useCallback(
    (id: ReviewStepId): void => {
      sessionDepthRef.current.visitedReviewSteps.add(id)
      publishTourDepthSummary()
    },
    [publishTourDepthSummary]
  )

  return {
    markWorkflowVisitedForSession,
    markWorkbenchStepVisitedForSession,
    markReviewStepVisitedForSession,
    getTourDepthSummary
  }
}
