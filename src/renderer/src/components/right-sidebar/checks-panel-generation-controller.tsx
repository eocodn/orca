import { useCallback, useEffect } from 'react'
import { useAppStore } from '@/store'
import { cancelRuntimeGeneratePullRequestFields, generateRuntimePullRequestFields, getRuntimeGitScope, type RuntimeGeneratePullRequestFieldsOverrides } from '@/runtime/runtime-git-client'
import { stripBaseRef, useCreatePullRequestDialogFields } from './useCreatePullRequestDialogFields'
import { getCommitMessageModelDiscoveryHostKeyForScope } from '../../../../shared/commit-message-host-key'
import { DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS, resolveSourceControlAiForOperation, resolveSourceControlAiPrCreationDefaults, resolveSourceControlAiEnabled } from '../../../../shared/source-control-ai'
import { createRunningPullRequestGenerationRecord, markPullRequestGenerationRequiresPushBeforeCreate, markPullRequestGenerationTerminalSeedRestored, resolvePullRequestGenerationCancel, resolvePullRequestGenerationFailure, resolvePullRequestGenerationSuccess, shouldHydratePullRequestGenerationResult } from '@/store/slices/pull-request-generation'
import type { ChecksPanelGenerationKey } from './checks-panel-generation-types'
import type { PullRequestFieldRevisions, PullRequestGenerationContext, PullRequestGenerationFields } from '@/store/slices/pull-request-generation'
export function useChecksPanelGeneration<T extends Record<string, unknown>>(context: T & { [K in ChecksPanelGenerationKey]: K extends keyof T ? T[K] : never }): Record<string, unknown> {
  const {
    activePullRequestGenerationKey,
    activePullRequestGenerationRecord,
    activePullRequestGenerationSeedRestoreKey,
    activeReview,
    activeWorktreeId,
    activeWorktreePath,
    allocatePullRequestGenerationRequestId,
    branch,
    confirmedReadiness,
    fetchUpstreamStatus,
    hostedReviewCreateProvider,
    hostedReviewCreation,
    isFolder,
    ownerSettings,
    prGenerationRecords,
    repo,
    setCreatePrError,
    setPullRequestGenerationRecord,
    settings,
    updatePullRequestGenerationRecord,
  } = context
const handleBranchChangedByPullRequestGeneration = useCallback(
  async (generationKey: string, context: PullRequestGenerationContext): Promise<void> => {
    if (!context.worktreeId || !context.worktreePath) {
      return
    }
    // Why: AI PR generation can rebase before summarizing; persist the push requirement since ChecksPanel unmounts when users leave the tab.
    updatePullRequestGenerationRecord(generationKey, (record) =>
      markPullRequestGenerationRequiresPushBeforeCreate({
        record,
        requestId: context.requestId
      })
    )
    try {
      await fetchUpstreamStatus(
        context.worktreeId,
        context.worktreePath,
        context.connectionId,
        undefined,
        {
          runtimeTargetSettings: context.runtimeTargetSettings
        }
      )
    } catch (error) {
      console.warn('[ChecksPanel] post-generation upstream refresh failed', error)
    }
  },
  [fetchUpstreamStatus, updatePullRequestGenerationRecord]
)
const prCreationDefaults = useMemo(() => {
  if (!settings) {
    return DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS
  }
  const hostKey = getCommitMessageModelDiscoveryHostKeyForScope(
    getRuntimeGitScope(settings, repo?.connectionId)
  )
  const resolved = resolveSourceControlAiForOperation({
    settings,
    repo,
    operation: 'pullRequest',
    discoveryHostKey: hostKey,
    prCreationProductDefaults: DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS
  })
  return resolved.ok
    ? resolved.value.prCreationDefaults
    : resolveSourceControlAiPrCreationDefaults({
        settings,
        repo,
        prCreationProductDefaults: DEFAULT_SOURCE_CONTROL_AI_PR_CREATION_DEFAULTS
      })
}, [repo, settings])
const sourceControlAiActionsVisible = useMemo(
  () => (settings ? resolveSourceControlAiEnabled({ settings, repo }) : false),
  [repo, settings]
)
// Confirmed-only gate: a confirmed composer survives transient refresh failures, but a failure never *opens* a never-confirmed Create.
const createComposerOpen =
  !isFolder && !activeReview && Boolean(branch) && confirmedReadiness.confirmed
const handleGeneratePullRequestFieldsForActive = useCallback(
  async (
    fields: PullRequestGenerationFields,
    fieldRevisions: PullRequestFieldRevisions,
    overrides?: RuntimeGeneratePullRequestFieldsOverrides
  ): Promise<void> => {
    if (!repo || !activePullRequestGenerationKey || !activeWorktreePath || !branch) {
      return
    }
    const generationKey = activePullRequestGenerationKey
    if (
      useAppStore.getState().pullRequestGenerationRecords[generationKey]?.status === 'running'
    ) {
      return
    }
    const requestId = allocatePullRequestGenerationRequestId()
    const context: PullRequestGenerationContext = {
      worktreeId: activeWorktreeId,
      worktreePath: activeWorktreePath,
      connectionId: getConnectionId(activeWorktreeId) ?? undefined,
      requestId,
      repoId: repo.id,
      branch,
      runtimeTargetSettings: ownerSettings
    }
    const seed = { ...fields }
    const previousRequiresPushBeforeCreate =
      useAppStore.getState().pullRequestGenerationRecords[generationKey]
        ?.requiresPushBeforeCreate === true
    // Why: ChecksPanel unsets the composer on navigate-away; persist the request so generation can finish in the background.
    const runningRecord = createRunningPullRequestGenerationRecord(context, seed, fieldRevisions)
    setPullRequestGenerationRecord(
      generationKey,
      previousRequiresPushBeforeCreate
        ? { ...runningRecord, requiresPushBeforeCreate: true }
        : runningRecord
    )

    try {
      const result = await generateRuntimePullRequestFields(
        {
          // Why: route generation by the worktree owner captured at click time.
          settings: context.runtimeTargetSettings,
          worktreeId: context.worktreeId,
          worktreePath: context.worktreePath,
          connectionId: context.connectionId
        },
        {
          base: stripBaseRef(seed.base.trim()),
          title: seed.title,
          body: seed.body,
          draft: seed.draft,
          provider: hostedReviewCreateProvider,
          useTemplate: prCreationDefaults.useTemplate
        },
        overrides
      )
      if (result.branchChangedByPreparation) {
        await handleBranchChangedByPullRequestGeneration(generationKey, context)
      }
      if (result.success) {
        useAppStore.getState().recordFeatureInteraction('ai-pr-generation')
      }
      updatePullRequestGenerationRecord(generationKey, (record) => {
        if (!result.success) {
          return resolvePullRequestGenerationFailure({
            record,
            requestId,
            canceled: result.canceled,
            error: result.canceled ? null : result.error
          })
        }
        return resolvePullRequestGenerationSuccess({
          record,
          requestId,
          result: {
            base: stripBaseRef(result.fields.base),
            title: result.fields.title,
            body: result.fields.body,
            draft: result.fields.draft
          }
        })
      })
    } catch (error) {
      updatePullRequestGenerationRecord(generationKey, (record) =>
        resolvePullRequestGenerationFailure({
          record,
          requestId,
          error:
            error instanceof Error ? error.message : 'Failed to generate pull request details'
        })
      )
    }
  },
  [
    activePullRequestGenerationKey,
    activeWorktreeId,
    activeWorktreePath,
    allocatePullRequestGenerationRequestId,
    branch,
    handleBranchChangedByPullRequestGeneration,
    hostedReviewCreateProvider,
    ownerSettings,
    prCreationDefaults.useTemplate,
    repo,
    setPullRequestGenerationRecord,
    updatePullRequestGenerationRecord
  ]
)
const handleCancelGeneratePullRequestFieldsForActive = useCallback((): void => {
  if (!activePullRequestGenerationKey) {
    return
  }
  const record = prGenerationRecords[activePullRequestGenerationKey]
  if (!record || record.status !== 'running') {
    return
  }
  const generationKey = activePullRequestGenerationKey
  updatePullRequestGenerationRecord(generationKey, (current) => {
    if (!current || current.context.requestId !== record.context.requestId) {
      return null
    }
    return resolvePullRequestGenerationCancel(current)
  })
  void cancelRuntimeGeneratePullRequestFields({
    // Why: Stop must target the request owner, not the currently focused worktree.
    settings: record.context.runtimeTargetSettings,
    worktreeId: record.context.worktreeId,
    worktreePath: record.context.worktreePath,
    connectionId: record.context.connectionId
  }).catch((error) => {
    updatePullRequestGenerationRecord(generationKey, (current) => {
      if (!current || current.context.requestId !== record.context.requestId) {
        return null
      }
      return {
        ...current,
        status: 'failed',
        error: error instanceof Error ? error.message : 'Failed to stop pull request generation',
        hydrated: false
      }
    })
  })
}, [activePullRequestGenerationKey, prGenerationRecords, updatePullRequestGenerationRecord])
const handlePullRequestGenerationSeedRestored = useCallback((): void => {
  if (!activePullRequestGenerationKey || !activePullRequestGenerationRecord) {
    return
  }
  const requestId = activePullRequestGenerationRecord.context.requestId
  updatePullRequestGenerationRecord(activePullRequestGenerationKey, (record) =>
    markPullRequestGenerationTerminalSeedRestored({
      record,
      requestId
    })
  )
}, [
  activePullRequestGenerationKey,
  activePullRequestGenerationRecord,
  updatePullRequestGenerationRecord
])
const {
  aiGenerationEnabled: prAiGenerationEnabled,
  base: prBase,
  setBase: setPrBase,
  title: prTitle,
  setTitle: setPrTitle,
  body: prBody,
  setBody: setPrBody,
  draft: prDraft,
  setDraft: setPrDraft,
  baseQuery: prBaseQuery,
  setBaseQuery: setPrBaseQuery,
  baseResults: prBaseResults,
  setBaseResults: setPrBaseResults,
  baseSearchError: prBaseSearchError,
  generating: prGenerating,
  generateError: prGenerateError,
  generateDisabled: prGenerateDisabled,
  generateDisabledReason: prGenerateDisabledReason,
  handleGenerate: handleGeneratePullRequestFields,
  handleCancelGenerate: handleCancelGeneratePullRequestFields,
  applyGeneratedFields: applyGeneratedPullRequestFields,
  initializedFromEligibility: pullRequestFieldsInitialized
} = useCreatePullRequestDialogFields({
  open: createComposerOpen,
  repoId: repo?.id ?? '',
  worktreeId: activeWorktreeId,
  worktreePath: activeWorktreePath ?? '',
  branch,
  eligibility: hostedReviewCreation,
  repo,
  settings: ownerSettings,
  submitting: isCreatingPr,
  prCreationDefaults,
  sourceControlAiActionsVisible,
  // Preserve the draft when a hard refresh error hides the composer so title/body/base survive recovery for the same context.
  retainDraftWhenClosed: true,
  generation: {
    generating: activePullRequestGenerationRecord?.status === 'running',
    generateError: activePullRequestGenerationRecord?.error ?? null,
    seedRestoreKey: activePullRequestGenerationSeedRestoreKey,
    seed: activePullRequestGenerationRecord?.seed ?? null,
    seedFieldRevisions: activePullRequestGenerationRecord?.seedFieldRevisions ?? null,
    onSeedRestored: handlePullRequestGenerationSeedRestored,
    onGenerate: (fields, fieldRevisions, overrides) => {
      void handleGeneratePullRequestFieldsForActive(fields, fieldRevisions, overrides)
    },
    onCancelGenerate: handleCancelGeneratePullRequestFieldsForActive
  }
})
useEffect(() => {
  // Why: PR generation can finish while this composer is hidden by a worktree switch; hydrate once the original composer is visible again.
  if (
    !activePullRequestGenerationKey ||
    !activePullRequestGenerationRecord ||
    activePullRequestGenerationRecord.status !== 'succeeded' ||
    !activePullRequestGenerationRecord.result ||
    activePullRequestGenerationRecord.hydrated ||
    !pullRequestFieldsInitialized
  ) {
    return
  }
  if (
    !shouldHydratePullRequestGenerationResult({
      record: activePullRequestGenerationRecord
    })
  ) {
    return
  }
  applyGeneratedPullRequestFields(
    activePullRequestGenerationRecord.result,
    activePullRequestGenerationRecord.seedFieldRevisions
  )
  updatePullRequestGenerationRecord(activePullRequestGenerationKey, (record) => {
    if (
      !record ||
      record.context.requestId !== activePullRequestGenerationRecord.context.requestId
    ) {
      return null
    }
    return {
      ...record,
      hydrated: true
    }
  })
}, [
  activePullRequestGenerationKey,
  activePullRequestGenerationRecord,
  applyGeneratedPullRequestFields,
  pullRequestFieldsInitialized,
  updatePullRequestGenerationRecord
])
const handlePrBaseChange = useCallback(
  (value: string): void => {
    setCreatePrError(null)
    setPrBase(value)
  },
  [setPrBase]
)
const handlePrTitleChange = useCallback(
  (value: string): void => {
    setCreatePrError(null)
    setPrTitle(value)
  },
  [setPrTitle]
)
  return { handleGeneratePullRequestFields, handleGeneratePullRequestFieldsForActive, handleCancelGeneratePullRequestFields, handlePullRequestGenerationSeedRestored, handlePrBaseChange, handlePrTitleChange, prAiGenerationEnabled, prBase, setPrBase, prTitle, setPrTitle, prBody, setPrBody, prDraft, setPrDraft, prBaseQuery, setPrBaseQuery, prBaseResults, setPrBaseResults, prBaseSearchError, prGenerating, prGenerateError, prGenerateDisabled, prGenerateDisabledReason, applyGeneratedPullRequestFields, pullRequestFieldsInitialized }
}
