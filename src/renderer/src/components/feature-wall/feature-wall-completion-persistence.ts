import {
  FEATURE_WALL_WORKFLOW_IDS,
  type FeatureWallWorkflowId
} from '../../../../shared/feature-wall-workflows'
import type { ReviewStepId } from '../../../../shared/review-steps'
import type { WorkbenchStepId } from '../../../../shared/workbench-steps'

const PERSISTED_WORKFLOW_IDS = new Set<FeatureWallWorkflowId>(FEATURE_WALL_WORKFLOW_IDS)
const VISITED_WORKFLOWS_STORAGE_KEY = 'orca.featureWall.visitedWorkflows.v1'
const COMPLETED_WORKFLOWS_STORAGE_KEY = 'orca.featureWall.completedWorkflows.v1'
const PERSISTED_WORKBENCH_STEP_IDS = new Set<WorkbenchStepId>(['terminal', 'editor', 'browser'])
const VISITED_WORKBENCH_STEPS_STORAGE_KEY = 'orca.featureWall.visitedWorkbenchSteps.v1'
const COMPLETED_WORKBENCH_STEPS_STORAGE_KEY = 'orca.featureWall.completedWorkbenchSteps.v1'
const PERSISTED_REVIEW_STEP_IDS = new Set<ReviewStepId>(['notes', 'pr-view', 'ship'])
const VISITED_REVIEW_STEPS_STORAGE_KEY = 'orca.featureWall.visitedReviewSteps.v1'
const COMPLETED_REVIEW_STEPS_STORAGE_KEY = 'orca.featureWall.completedReviewSteps.v1'

function normalizeIds<T extends string>(value: unknown, allowed: ReadonlySet<T>): T[] {
  if (!Array.isArray(value)) {
    return []
  }
  const seen = new Set<T>()
  for (const item of value) {
    if (typeof item === 'string' && allowed.has(item as T)) {
      seen.add(item as T)
    }
  }
  return [...seen]
}

export function normalizeFeatureWallVisitedWorkflows(value: unknown): FeatureWallWorkflowId[] {
  return normalizeIds(value, PERSISTED_WORKFLOW_IDS)
}

export function normalizeFeatureWallVisitedWorkbenchSteps(value: unknown): WorkbenchStepId[] {
  return normalizeIds(value, PERSISTED_WORKBENCH_STEP_IDS)
}

export function normalizeFeatureWallVisitedReviewSteps(value: unknown): ReviewStepId[] {
  return normalizeIds(value, PERSISTED_REVIEW_STEP_IDS)
}

function readPersistedSet<T extends string>(
  storageKey: string,
  normalize: (value: unknown) => T[]
): Set<T> {
  if (typeof localStorage === 'undefined') {
    return new Set()
  }
  try {
    return new Set(normalize(JSON.parse(localStorage.getItem(storageKey) ?? '[]')))
  } catch {
    return new Set()
  }
}

export function readPersistedVisitedWorkflows(): Set<FeatureWallWorkflowId> {
  return readPersistedSet(VISITED_WORKFLOWS_STORAGE_KEY, normalizeFeatureWallVisitedWorkflows)
}

export function readPersistedCompletedWorkflows(): Set<FeatureWallWorkflowId> {
  return readPersistedSet(COMPLETED_WORKFLOWS_STORAGE_KEY, normalizeFeatureWallVisitedWorkflows)
}

export function readPersistedVisitedWorkbenchSteps(): Set<WorkbenchStepId> {
  return readPersistedSet(
    VISITED_WORKBENCH_STEPS_STORAGE_KEY,
    normalizeFeatureWallVisitedWorkbenchSteps
  )
}

export function readPersistedCompletedWorkbenchSteps(): Set<WorkbenchStepId> {
  return readPersistedSet(
    COMPLETED_WORKBENCH_STEPS_STORAGE_KEY,
    normalizeFeatureWallVisitedWorkbenchSteps
  )
}

export function readPersistedVisitedReviewSteps(): Set<ReviewStepId> {
  return readPersistedSet(VISITED_REVIEW_STEPS_STORAGE_KEY, normalizeFeatureWallVisitedReviewSteps)
}

export function readPersistedCompletedReviewSteps(): Set<ReviewStepId> {
  return readPersistedSet(
    COMPLETED_REVIEW_STEPS_STORAGE_KEY,
    normalizeFeatureWallVisitedReviewSteps
  )
}

function persistId<T extends string>(
  storageKey: string,
  id: T,
  allowed: ReadonlySet<T>,
  read: () => Set<T>
): void {
  if (!allowed.has(id) || typeof localStorage === 'undefined') {
    return
  }
  try {
    const next = read()
    next.add(id)
    localStorage.setItem(storageKey, JSON.stringify([...next]))
  } catch {
    // localStorage can be unavailable in hardened browser contexts.
  }
}

export function persistVisitedWorkflow(id: FeatureWallWorkflowId): void {
  persistId(
    VISITED_WORKFLOWS_STORAGE_KEY,
    id,
    PERSISTED_WORKFLOW_IDS,
    readPersistedVisitedWorkflows
  )
}

export function persistCompletedWorkflow(id: FeatureWallWorkflowId): void {
  persistId(
    COMPLETED_WORKFLOWS_STORAGE_KEY,
    id,
    PERSISTED_WORKFLOW_IDS,
    readPersistedCompletedWorkflows
  )
}

export function persistVisitedWorkbenchStep(id: WorkbenchStepId): void {
  persistId(
    VISITED_WORKBENCH_STEPS_STORAGE_KEY,
    id,
    PERSISTED_WORKBENCH_STEP_IDS,
    readPersistedVisitedWorkbenchSteps
  )
}

export function persistCompletedWorkbenchStep(id: WorkbenchStepId): void {
  persistId(
    COMPLETED_WORKBENCH_STEPS_STORAGE_KEY,
    id,
    PERSISTED_WORKBENCH_STEP_IDS,
    readPersistedCompletedWorkbenchSteps
  )
}

export function persistVisitedReviewStep(id: ReviewStepId): void {
  persistId(
    VISITED_REVIEW_STEPS_STORAGE_KEY,
    id,
    PERSISTED_REVIEW_STEP_IDS,
    readPersistedVisitedReviewSteps
  )
}

export function persistCompletedReviewStep(id: ReviewStepId): void {
  persistId(
    COMPLETED_REVIEW_STEPS_STORAGE_KEY,
    id,
    PERSISTED_REVIEW_STEP_IDS,
    readPersistedCompletedReviewSteps
  )
}
