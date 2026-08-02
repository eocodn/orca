
import { z } from 'zod'
import { FEATURE_WALL_MAX_DWELL_MS } from './feature-wall-telemetry'
import { FEATURE_WALL_EXIT_ACTIONS, FEATURE_WALL_TOUR_DEPTH_STEPS } from './feature-wall-tour-depth'
import {
  CONTEXTUAL_TOUR_OUTCOMES,
  FEATURE_EDUCATION_CONTEXTUAL_TOUR_IDS,
  FEATURE_EDUCATION_SOURCES,
  SETUP_GUIDE_CLOSE_OUTCOMES,
  SETUP_GUIDE_SOURCES,
  TERMINAL_PANE_SPLIT_SOURCES
} from './feature-education-telemetry'
import { FEATURE_WALL_SETUP_STEP_IDS } from './feature-wall-setup-steps'
import {
  FEATURE_INTERACTION_CATEGORIES,
  FEATURE_INTERACTION_IDS,
  FEATURE_INTERACTION_USAGE_BUCKETS,
  getFeatureInteractionCategory
} from './feature-interactions'
import {
  DAEMON_LIFECYCLE_SESSION_BUCKETS,
  DAEMON_LIFECYCLE_TRANSITIONS,
  DAEMON_REPLACE_REASONS,
  DAEMON_RETIRE_REASONS
} from './daemon-lifecycle-telemetry'
import {
  DAEMON_AUDIT_PROCESS_REASON_VALUES,
  DAEMON_AUDIT_REASON_VALUES,
  DAEMON_AUDIT_STATE_VALUES,
  DAEMON_AUDIT_TRIGGER_VALUES,
  DAEMON_EVIDENCE_SOURCE_VALUES
} from './daemon-audit-eligibility'
import { SETUP_SCRIPT_IMPORT_PROVIDERS } from './setup-script-import-providers'
import { WORKSPACE_SOURCE_VALUES, type WorkspaceSource } from './workspace-source'
import { appStarSourceSchema } from './gh-star-source'
import {
  starNagAgentBucketSchema,
  starNagOutcomeSchema,
  starNagPromptModeSchema,
  starNagPromptSourceSchema
} from './star-nag-telemetry'
import {
  NESTED_REPO_COUNT_BUCKETS,
  NESTED_REPO_IMPORT_ACTIONS,
  NESTED_REPO_IMPORT_OUTCOMES,
  NESTED_REPO_SCAN_RESULTS,
  NESTED_REPO_TELEMETRY_MAX_REPO_COUNT,
  NESTED_REPO_TELEMETRY_RUNTIME_KINDS,
  NESTED_REPO_TELEMETRY_SURFACES,
  bucketNestedRepoTelemetryCount
} from './nested-repo-telemetry'

import { AGENT_HOOK_TARGETS } from './agent-hook-types'
import type {
  DiscoveryStatusEmitted,
  GlobalSettings,
  OnboardingChecklistState,
  PathSource,
  ShellHydrationFailureReason
} from './types'
import * as shared from './telemetry-event-shared-enums'
import * as core from './telemetry-event-core-schemas'
import * as onboarding from './telemetry-event-onboarding-schemas'
const { AGENT_KIND_VALUES, agentKindSchema, errorClassSchema, repoMethodSchema, addRepoSetupStepActionSchema, addRepoExistingWorkspaceSourceSchema, addRepoDefaultCheckoutHandoffSourceSchema, addRepoDefaultCheckoutHandoffResultSchema, addRepoDefaultCheckoutHandoffReasonSchema, setupScriptImportProviderSchema, workspaceCreateErrorClassSchema, workspaceSourceSchema, launchSourceSchema, requestKindSchema, featureWallTileIdSchema, featureWallOpenSourceSchema, featureWallWorkflowIdSchema, featureWallTourDepthStepSchema, featureWallExitActionSchema, optInViaSchema, SETTINGS_CHANGED_WHITELIST, settingsChangedKeySchema } = shared
const { nthRepoAddedSchema, appOpenedSchema, featureInteractionIdSchema, featureInteractionCategorySchema, featureInteractionUsageBucketSchema, featureInteractionUsageBucketSourceSchema, featureInteractionUsageBucketReachedSchema, repoAddedSchema, appStarredOrcaSchema, starNagOutcomeEventSchema, workspaceCreatedSchema, agentStartedSchema, agentPromptSentSchema, agentErrorSchema, daemonStartFailedSchema, runtimeRpcStartErrorClassSchema, runtimeRpcStartFailedSchema, mainThreadHangDetectedSchema, daemonLifecycleSchema, daemonAuditEligibilitySchema, codexTrustGrantSchema, settingsChangedSchema, nativeChatViewModeSchema, nativeChatToggledSchema, nativeChatRuntimeSchema, nativeChatMessageSentSchema, nativeChatPickerOpenedSchema, nativeChatPickerItemAcceptedSchema, nativeChatSendClassifiedSchema, nativeChatSkillDiscoverySchema, telemetryOptedInSchema, telemetryOptedOutSchema, orcaCliFeatureTipSourceSchema, orcaCliFeatureTipShownSchema, orcaCliFeatureTipSetupClickedSchema, orcaCliFeatureTipSetupResultSchema, cmdJPaletteFeatureTipShownSchema, cmdJPaletteFeatureTipAcknowledgedSchema, featureWallOpenedSchema, featureWallClosedSchema, featureWallTileFocusedSchema, featureWallTileClickedSchema, featureWallGroupSelectedSchema, featureWallFeatureSelectedSchema, featureWallDocsClickedSchema } = core
const { existingWorkspaceCountSchema, addRepoExistingWorkspaceContextSchema, addRepoSetupStepActionEventSchema, addRepoExistingWorkspacesDetectedSchema, addRepoDefaultCheckoutHandoffSchema, workspaceCreateFailedSchema, setupScriptPromptModeSchema, setupScriptCountBucketSchema, setupScriptPromptContextSchema, validateSetupScriptPromptProvider, setupScriptPromptShownSchema, setupScriptDetectedSaveActions, isSetupScriptDetectedSaveAction, validateSetupScriptPromptAction, setupScriptPromptActionSchema, hookInstallAgentSchema, agentHookInstallFailedSchema, agentHookUnattributedSchema, ONBOARDING_TELEMETRY_LEGACY_MAX_STEP, onboardingStepSchema, onboardingPathSchema, onboardingFailureReasonSchema, onboardingValueKindSchema, onboardingTourOutcomeSchema, onboardingTaskSourcesGithubStatusSchema, onboardingTaskSourcesLinearStatusSchema, onboardingTaskSourcesExitActionSchema, onboardingWindowsTerminalShellSchema, onboardingWindowsTerminalRightClickSchema, onboardingWindowsTerminalExitActionSchema, onboardingChecklistItemSchema, onboardingFeatureSetupFeatureSchema, onboardingFeatureSetupSelectionSchema, onboardingFeatureSetupSelectedCountRefinement, hasMatchingOnboardingFeatureSetupSelectedCount, _onboardingChecklistItemSyncCheck, cohortSchema, nestedRepoTelemetrySurfaceSchema, nestedRepoTelemetryRuntimeKindSchema, nestedRepoCountSchema, nestedRepoCountBucketSchema, nestedRepoScanResultSchema, nestedRepoImportActionSchema, nestedRepoImportOutcomeSchema, nestedRepoScanPathKindSchema, nestedRepoImportModeSchema, nestedRepoAttemptIdSchema, validateNestedRepoCountBucket, validateNestedRepoCountBuckets, nestedRepoTelemetryBaseSchema, addRepoNestedScanResultSchema, addRepoNestedImportActionSchema, addRepoNestedImportResultSchema, advancedViaSchema } = onboarding


export const onboardingStartedSchema = z
  .object({ resumed_from_step: onboardingStepSchema.optional(), cohort: cohortSchema })
  .strict()
export const onboardingStepViewedSchema = z
  .object({
    step: onboardingStepSchema,
    value_kind: onboardingValueKindSchema,
    cohort: cohortSchema
  })
  .strict()
export const onboardingStepCompletedSchema = z
  .object({
    step: onboardingStepSchema,
    value_kind: onboardingValueKindSchema,
    duration_ms: z.number().int().nonnegative().optional(),
    advanced_via: advancedViaSchema,
    cohort: cohortSchema
  })
  .strict()
export const onboardingStepSkippedSchema = z
  .object({
    step: onboardingStepSchema,
    value_kind: onboardingValueKindSchema,
    duration_ms: z.number().int().nonnegative().optional(),
    advanced_via: advancedViaSchema,
    cohort: cohortSchema
  })
  .strict()
export type OnboardingTourOutcomeTelemetry = {
  outcome: z.infer<typeof onboardingTourOutcomeSchema>
  tour_dwell_ms?: number
  furthest_step?: z.infer<typeof featureWallTourDepthStepSchema>
  visited_workflow_count?: number
  visited_substep_count?: number
  completed_workflow_count?: number
  completed_substep_count?: number
}

export function validateOnboardingTourOutcome(
  props: OnboardingTourOutcomeTelemetry,
  ctx: z.RefinementCtx
): void {
  if (props.outcome !== 'skipped_intro') {
    return
  }
  for (const key of [
    'tour_dwell_ms',
    'furthest_step',
    'visited_workflow_count',
    'visited_substep_count',
    'completed_workflow_count',
    'completed_substep_count'
  ] as const) {
    if (props[key] !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: `${key} is only valid after the inline tour starts`
      })
    }
  }
}

export const onboardingTourOutcomeEventSchema = z
  .object({
    outcome: onboardingTourOutcomeSchema,
    intro_duration_ms: z.number().int().min(0).max(FEATURE_WALL_MAX_DWELL_MS).optional(),
    tour_dwell_ms: z.number().int().min(0).max(FEATURE_WALL_MAX_DWELL_MS).optional(),
    furthest_step: featureWallTourDepthStepSchema.optional(),
    visited_workflow_count: z.number().int().min(0).max(5).optional(),
    visited_substep_count: z.number().int().min(0).max(9).optional(),
    completed_workflow_count: z.number().int().min(0).max(5).optional(),
    completed_substep_count: z.number().int().min(0).max(9).optional(),
    advanced_via: advancedViaSchema,
    cohort: cohortSchema
  })
  .strict()
  .superRefine(validateOnboardingTourOutcome)
export const onboardingStep4PathClickedSchema = z
  .object({ path: onboardingPathSchema, cohort: cohortSchema })
  .strict()
export const onboardingStep4PathFailedSchema = z
  .object({
    path: onboardingPathSchema,
    reason: onboardingFailureReasonSchema,
    cohort: cohortSchema
  })
  .strict()
export const onboardingTaskSourcesSnapshotSchema = z
  .object({
    github_status: onboardingTaskSourcesGithubStatusSchema,
    linear_status: onboardingTaskSourcesLinearStatusSchema,
    exit_action: onboardingTaskSourcesExitActionSchema,
    duration_ms: z.number().int().nonnegative().optional(),
    advanced_via: advancedViaSchema,
    cohort: cohortSchema
  })
  .strict()
export const onboardingWindowsTerminalSnapshotSchema = z
  .object({
    default_shell: onboardingWindowsTerminalShellSchema,
    right_click_behavior: onboardingWindowsTerminalRightClickSchema,
    exit_action: onboardingWindowsTerminalExitActionSchema,
    duration_ms: z.number().int().nonnegative().optional(),
    advanced_via: advancedViaSchema,
    cohort: cohortSchema
  })
  .strict()
// Why: no `is_git_repo` here; the signal moved to `repo_added.is_git_repo`.
export const onboardingCompletedSchema = z
  .object({
    path: onboardingPathSchema,
    total_duration_ms: z.number().int().nonnegative(),
    cohort: cohortSchema
  })
  .strict()
export const onboardingDismissedSchema = z
  .object({
    last_step: onboardingStepSchema,
    duration_ms: z.number().int().nonnegative().optional(),
    advanced_via: advancedViaSchema,
    cohort: cohortSchema
  })
  .strict()
export const activationChecklistItemCompletedSchema = z
  .object({
    item: onboardingChecklistItemSchema,
    time_since_completed_ms: z.number().int().nonnegative()
  })
  .strict()

// Why: disambiguates `on_path:false` rows on dashboard 1562016 (shell-hydration failure vs genuinely-not-on-PATH). See docs/agent-on-path-detection.md.
export const pathSourceSchema = z.enum(['shell_hydrate', 'sync_seed_only'])
export const pathFailureReasonSchema = z.enum(['none', 'no_shell', 'timeout', 'spawn_error', 'empty_path'])

// Compile-time guard: schema enum must match `ShellHydrationFailureReason`; drift breaks the build, not runtime parsing.
export type _PathFailureReasonSync =
  z.infer<typeof pathFailureReasonSchema> extends ShellHydrationFailureReason
    ? ShellHydrationFailureReason extends z.infer<typeof pathFailureReasonSchema>
      ? true
      : never
    : never
export const _pathFailureReasonSyncCheck: _PathFailureReasonSync = true
void _pathFailureReasonSyncCheck

export type _PathSourceSync =
  z.infer<typeof pathSourceSchema> extends PathSource
    ? PathSource extends z.infer<typeof pathSourceSchema>
      ? true
      : never
    : never
export const _pathSourceSyncCheck: _PathSourceSync = true
void _pathSourceSyncCheck

// Fired at click time (captures mind-changes); `agent_kind` uses `tuiAgentToAgentKind` to keep the wire enum closed.
export const onboardingAgentPickedSchema = z
  .object({
    agent_kind: agentKindSchema,
    on_path: z.boolean(),
    detected_count: z.number().int().nonnegative(),
    // `'pending'` when detection is still running at click time (picked-before-detection vs picked-the-only-agent).
    detection_state: z.enum(['complete', 'pending']),
    // `true` when the agent lived under the "Show N more" disclosure — signals demand for less-popular agents.
    from_collapsed_section: z.boolean(),
    // Why: `.optional()` is load-bearing so pre-deploy events validate under `.strict()`. See docs/agent-on-path-detection.md.
    path_source: pathSourceSchema.optional(),
    path_failure_reason: pathFailureReasonSchema.optional(),
    cohort: cohortSchema
  })
  .strict()

// Mirrors ThemeStep.tsx DiscoveryState; `failed` is intentionally absent (it's an import outcome, see onboarding_ghostty_import_failed).
export const ghosttyDiscoveryStateSchema = z.enum(['found', 'absent', 'imported'])

// Compile-time guard: schema enum must stay in sync with the renderer's DiscoveryState; drift breaks the build, not runtime.
export type _GhosttyDiscoveryStateSync =
  z.infer<typeof ghosttyDiscoveryStateSchema> extends DiscoveryStatusEmitted
    ? DiscoveryStatusEmitted extends z.infer<typeof ghosttyDiscoveryStateSchema>
      ? true
      : never
    : never
export const _ghosttyDiscoveryStateSyncCheck: _GhosttyDiscoveryStateSync = true
void _ghosttyDiscoveryStateSyncCheck

export const onboardingGhosttyDiscoveredSchema = z
  .object({
    state: ghosttyDiscoveryStateSchema,
    // Bucketed not raw: exact group counts fingerprint heavy customizers.
    field_group_count_bucket: z.enum(['0', '1-3', '4-7', '8+']),
    cohort: cohortSchema
  })
  .strict()
export const onboardingGhosttyImportClickedSchema = z.object({ cohort: cohortSchema }).strict()

// Smart-sort telemetry: measures whether the redesign concentrates users in Class 1-3, and flags Smart→Recent abandonment as a regression.
export const smartSortClassDistributionSchema = z
  .object({
    class_1: z.number().int().nonnegative(),
    class_2: z.number().int().nonnegative(),
    class_3: z.number().int().nonnegative(),
    class_4: z.number().int().nonnegative(),
    total_worktrees: z.number().int().nonnegative()
  })
  .strict()
export const smartSortClass1PromotionSchema = z
  .object({
    cause: z.enum(['blocked', 'waiting', 'title-heuristic'])
  })
  .strict()
// Why `_v` not `z.object({})`: empty zod object infers as TS `{}` ("anything"), breaking the `keyof EventMap[N]` roster probes.
export const smartToRecentSwitchSchema = z.object({ _v: z.literal(1).optional() }).strict()
export const onboardingGhosttyImportFailedSchema = z
  .object({
    // `'no_config'` is reserved for future use; call sites currently emit `'empty_diff'` or `'unknown'`.
    reason: z.enum(['no_config', 'empty_diff', 'unknown']),
    cohort: cohortSchema
  })
  .strict()
export const onboardingFeatureSetupToggledSchema = z
  .object({
    feature: onboardingFeatureSetupFeatureSchema,
    selected: z.boolean(),
    cohort: cohortSchema
  })
  .strict()
export const onboardingFeatureSetupRunSchema = z
  .object({
    ...onboardingFeatureSetupSelectionSchema,
    cli_touched: z.boolean(),
    skill_commands_copied: z.boolean(),
    skill_install_command_prepared: z.boolean(),
    computer_use_permissions_opened: z.boolean(),
    warning_count: z.number().int().nonnegative(),
    cohort: cohortSchema
  })
  // Why: validate derived selected_count at the untrusted IPC boundary rather than trust renderer callers.
  .refine(
    hasMatchingOnboardingFeatureSetupSelectedCount,
    onboardingFeatureSetupSelectedCountRefinement
  )
  .strict()
export const onboardingFeatureSetupTerminalOpenedSchema = z
  .object({
    ...onboardingFeatureSetupSelectionSchema,
    cohort: cohortSchema
  })
  .refine(
    hasMatchingOnboardingFeatureSetupSelectedCount,
    onboardingFeatureSetupSelectedCountRefinement
  )
  .strict()
export const onboardingFeatureSetupTerminalInteractedSchema = z
  .object({
    ...onboardingFeatureSetupSelectionSchema,
    method: z.enum(['keyboard', 'pointer']),
    cohort: cohortSchema
  })
  .refine(
    hasMatchingOnboardingFeatureSetupSelectedCount,
    onboardingFeatureSetupSelectedCountRefinement
  )
  .strict()

export const featureEducationSourceSchema = z.enum(FEATURE_EDUCATION_SOURCES)
export const featureEducationContextualTourIdSchema = z.enum(FEATURE_EDUCATION_CONTEXTUAL_TOUR_IDS)
export const setupGuideSourceSchema = z.enum(SETUP_GUIDE_SOURCES)
export const setupGuideCloseOutcomeSchema = z.enum(SETUP_GUIDE_CLOSE_OUTCOMES)
export const setupGuideStepIdSchema = z.enum(FEATURE_WALL_SETUP_STEP_IDS)
export const setupGuideStepIdOrNoneSchema = z.enum([...FEATURE_WALL_SETUP_STEP_IDS, 'none'] as const)
export const terminalPaneSplitSourceSchema = z.enum(TERMINAL_PANE_SPLIT_SOURCES)

export const contextualTourShownSchema = z
  .object({
    tour_id: featureEducationContextualTourIdSchema,
    source: featureEducationSourceSchema,
    was_feature_previously_interacted: z.boolean()
  })
  .strict()

export const contextualTourOutcomeSchema = z
  .object({
    tour_id: featureEducationContextualTourIdSchema,
    source: featureEducationSourceSchema,
    outcome: z.enum(CONTEXTUAL_TOUR_OUTCOMES),
    steps_seen: z.number().int().min(0).max(8),
    total_steps: z.number().int().min(1).max(8),
    furthest_step_index: z.number().int().min(1).max(8).optional(),
    defined_step_count: z.number().int().min(1).max(8).optional()
  })
  .refine((payload) => payload.steps_seen <= payload.total_steps, {
    message: 'steps_seen must be less than or equal to total_steps',
    path: ['steps_seen']
  })
  .refine(
    (payload) =>
      payload.furthest_step_index === undefined ||
      payload.defined_step_count === undefined ||
      payload.furthest_step_index <= payload.defined_step_count,
    {
      message: 'furthest_step_index must be less than or equal to defined_step_count',
      path: ['furthest_step_index']
    }
  )
  .refine(
    (payload) =>
      (payload.furthest_step_index === undefined) === (payload.defined_step_count === undefined),
    {
      message: 'furthest_step_index and defined_step_count must be sent together',
      path: ['defined_step_count']
    }
  )
  .strict()

export const setupGuideOpenedSchema = z
  .object({
    source: setupGuideSourceSchema,
    initial_completed_count: z.number().int().min(0).max(8),
    total_steps: z.literal(8),
    first_incomplete_step_id: setupGuideStepIdOrNoneSchema
  })
  .strict()

export const setupGuideClosedSchema = z
  .object({
    source: setupGuideSourceSchema,
    outcome: setupGuideCloseOutcomeSchema,
    initial_completed_count: z.number().int().min(0).max(8),
    final_completed_count: z.number().int().min(0).max(8),
    total_steps: z.literal(8),
    active_step_id: setupGuideStepIdOrNoneSchema
  })
  .refine((payload) => payload.final_completed_count >= payload.initial_completed_count, {
    message: 'final_completed_count must be greater than or equal to initial_completed_count',
    path: ['final_completed_count']
  })
  .strict()

export const setupGuideStepCompletedSchema = z
  .object({
    step_id: setupGuideStepIdSchema,
    section_id: z.enum(['parallel-work', 'setup']),
    completed_count: z.number().int().min(1).max(8),
    total_steps: z.literal(8),
    setup_guide_visible: z.boolean()
  })
  .strict()

export const terminalPaneSplitSchema = z
  .object({
    source: terminalPaneSplitSourceSchema,
    direction: z.enum(['vertical', 'horizontal'])
  })
  .strict()

// Why: measures the changed-on-disk conflict flow (issue #7265) per transport; deliberately path-free.
export const editorExternalChangeConflictShownSchema = z
  .object({
    surface: z.enum(['edit', 'unstaged-diff']),
    transport: z.enum(['local', 'ssh', 'runtime']),
    origin: z.enum(['live', 'restore'])
  })
  .strict()

export const editorExternalChangeConflictActionSchema = z
  .object({
    action: z.enum(['reload', 'keep', 'compare', 'undo_reload', 'save_overwrite']),
    surface: z.enum(['edit', 'unstaged-diff']),
    transport: z.enum(['local', 'ssh', 'runtime'])
  })
  .strict()

export const directSshReconnectCountSchema = z.number().int().min(0).max(1_000_000)
export const directSshReconnectDurationSchema = z.number().int().min(0).max(86_400_000)
export const directSshReconnectOperationSchema = z
  .object({
    mode: z.enum(['reconnect', 'prepare_only']),
    reason: z.enum(['reconnect', 'initial_hydration', 'workspace_snapshot', 'wake_refresh']),
    outcome: z.enum(['complete', 'degraded', 'canceled', 'stale', 'stopped', 'stabilizing']),
    terminal_retried_count: directSshReconnectCountSchema,
    terminal_stale_binding_cleared_count: directSshReconnectCountSchema,
    terminal_correction_succeeded_count: directSshReconnectCountSchema,
    catalog_complete_count: directSshReconnectCountSchema,
    catalog_degraded_count: directSshReconnectCountSchema,
    catalog_stale_count: directSshReconnectCountSchema,
    repo_complete_count: directSshReconnectCountSchema,
    repo_non_authoritative_count: directSshReconnectCountSchema,
    repo_retrying_count: directSshReconnectCountSchema,
    repo_timed_out_count: directSshReconnectCountSchema,
    repo_cancel_budget_exhausted_count: directSshReconnectCountSchema,
    repo_canceled_count: directSshReconnectCountSchema,
    repo_stale_count: directSshReconnectCountSchema,
    repo_rejected_count: directSshReconnectCountSchema,
    lineage_complete_count: directSshReconnectCountSchema,
    lineage_degraded_count: directSshReconnectCountSchema,
    lineage_canceled_count: directSshReconnectCountSchema,
    lineage_stale_count: directSshReconnectCountSchema,
    lineage_not_started_count: directSshReconnectCountSchema,
    git_worktree_count: directSshReconnectCountSchema,
    folder_workspace_count: directSshReconnectCountSchema,
    ambiguous_owner_count: directSshReconnectCountSchema,
    contradictory_owner_count: directSshReconnectCountSchema,
    total_duration_ms: directSshReconnectDurationSchema,
    terminal_finalization_duration_ms: directSshReconnectDurationSchema,
    catalog_duration_ms: directSshReconnectDurationSchema,
    queue_wait_sample_count: directSshReconnectCountSchema,
    queue_wait_duration_ms_p50: directSshReconnectDurationSchema,
    queue_wait_duration_ms_p95: directSshReconnectDurationSchema,
    queue_wait_duration_ms_p99: directSshReconnectDurationSchema,
    queue_wait_duration_ms_max: directSshReconnectDurationSchema,
    provider_execution_sample_count: directSshReconnectCountSchema,
    provider_execution_duration_ms_p50: directSshReconnectDurationSchema,
    provider_execution_duration_ms_p95: directSshReconnectDurationSchema,
    provider_execution_duration_ms_p99: directSshReconnectDurationSchema,
    provider_execution_duration_ms_max: directSshReconnectDurationSchema,
    timeout_retry_count: directSshReconnectCountSchema,
    locally_settled_waiter_count: directSshReconnectCountSchema,
    cancel_debt_count: directSshReconnectCountSchema,
    replacement_admission_delayed_count: directSshReconnectCountSchema,
    overlapping_join_count: directSshReconnectCountSchema,
    coordinator_owned_direct_ssh_detected_worktree_concurrency_peak:
      directSshReconnectCountSchema.max(5),
    estimated_late_work_allowance_count: directSshReconnectCountSchema.max(2),
    authority_rotation_count: directSshReconnectCountSchema,
    damped_preparation_count: directSshReconnectCountSchema
  })
  .strict()

// ── Event registry: the one record the validator consumes ───────────────
// Versioning: breaking changes (rename/re-mean/remove a key) need a new event name; in-place edits blend pre/post rows unmixably. Additive-optional fields are safe.
