
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
const { AGENT_KIND_VALUES, agentKindSchema, errorClassSchema, repoMethodSchema, addRepoSetupStepActionSchema, addRepoExistingWorkspaceSourceSchema, addRepoDefaultCheckoutHandoffSourceSchema, addRepoDefaultCheckoutHandoffResultSchema, addRepoDefaultCheckoutHandoffReasonSchema, setupScriptImportProviderSchema, workspaceCreateErrorClassSchema, workspaceSourceSchema, launchSourceSchema, requestKindSchema, featureWallTileIdSchema, featureWallOpenSourceSchema, featureWallWorkflowIdSchema, featureWallTourDepthStepSchema, featureWallExitActionSchema, optInViaSchema, SETTINGS_CHANGED_WHITELIST, settingsChangedKeySchema } = shared
const { nthRepoAddedSchema, appOpenedSchema, featureInteractionIdSchema, featureInteractionCategorySchema, featureInteractionUsageBucketSchema, featureInteractionUsageBucketSourceSchema, featureInteractionUsageBucketReachedSchema, repoAddedSchema, appStarredOrcaSchema, starNagOutcomeEventSchema, workspaceCreatedSchema, agentStartedSchema, agentPromptSentSchema, agentErrorSchema, daemonStartFailedSchema, runtimeRpcStartErrorClassSchema, runtimeRpcStartFailedSchema, mainThreadHangDetectedSchema, daemonLifecycleSchema, daemonAuditEligibilitySchema, codexTrustGrantSchema, settingsChangedSchema, nativeChatViewModeSchema, nativeChatToggledSchema, nativeChatRuntimeSchema, nativeChatMessageSentSchema, nativeChatPickerOpenedSchema, nativeChatPickerItemAcceptedSchema, nativeChatSendClassifiedSchema, nativeChatSkillDiscoverySchema, telemetryOptedInSchema, telemetryOptedOutSchema, orcaCliFeatureTipSourceSchema, orcaCliFeatureTipShownSchema, orcaCliFeatureTipSetupClickedSchema, orcaCliFeatureTipSetupResultSchema, cmdJPaletteFeatureTipShownSchema, cmdJPaletteFeatureTipAcknowledgedSchema, featureWallOpenedSchema, featureWallClosedSchema, featureWallTileFocusedSchema, featureWallTileClickedSchema, featureWallGroupSelectedSchema, featureWallFeatureSelectedSchema, featureWallDocsClickedSchema } = core

export const existingWorkspaceCountSchema = z.number().int().min(1).max(50)
export const addRepoExistingWorkspaceContextSchema = {
  source: addRepoExistingWorkspaceSourceSchema,
  existing_workspace_count: existingWorkspaceCountSchema,
  existing_linked_workspace_count: z.number().int().min(0).max(50)
} as const

export const addRepoSetupStepActionEventSchema = z
  .object({
    action: addRepoSetupStepActionSchema,
    source: addRepoExistingWorkspaceSourceSchema.optional(),
    existing_workspace_count: existingWorkspaceCountSchema.optional(),
    existing_linked_workspace_count: z.number().int().min(0).max(50).optional(),
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()
export const addRepoExistingWorkspacesDetectedSchema = z
  .object({
    ...addRepoExistingWorkspaceContextSchema,
    main_workspace_count: z.number().int().min(0).max(50),
    branch_named_workspace_count: z.number().int().min(0).max(50),
    detached_workspace_count: z.number().int().min(0).max(50),
    custom_named_workspace_count: z.number().int().min(0).max(50),
    sparse_workspace_count: z.number().int().min(0).max(50),
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()
export const addRepoDefaultCheckoutHandoffSchema = z
  .object({
    source: addRepoDefaultCheckoutHandoffSourceSchema,
    result: addRepoDefaultCheckoutHandoffResultSchema,
    reason: addRepoDefaultCheckoutHandoffReasonSchema,
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()

// Why: enum-only like `agent_error` — `.strict()` blocks raw error strings from ever crossing the wire.
export const workspaceCreateFailedSchema = z
  .object({
    source: workspaceSourceSchema,
    error_class: workspaceCreateErrorClassSchema,
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()

export const setupScriptPromptModeSchema = z.enum(['import_available', 'configure_needed'])
export const setupScriptCountBucketSchema = z.enum(['0', '1', '2-3', '4+'])
export const setupScriptPromptContextSchema = {
  mode: setupScriptPromptModeSchema,
  // Why: superRefine (not transform) keeps the top-level ZodObject shape that cohort injection probes.
  provider: setupScriptImportProviderSchema.optional(),
  file_count_bucket: setupScriptCountBucketSchema,
  unsupported_field_count_bucket: setupScriptCountBucketSchema,
  has_shared_hooks: z.boolean(),
  nth_repo_added: nthRepoAddedSchema
} as const

export type SetupScriptPromptContextTelemetry = {
  mode: z.infer<typeof setupScriptPromptModeSchema>
  provider?: z.infer<typeof setupScriptImportProviderSchema>
}

export function validateSetupScriptPromptProvider(
  props: SetupScriptPromptContextTelemetry,
  ctx: z.RefinementCtx
): void {
  if (props.mode === 'import_available' && props.provider === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['provider'],
      message: 'provider is required when a setup candidate is available'
    })
  }
  if (props.mode === 'configure_needed' && props.provider !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['provider'],
      message: 'provider is only valid when a setup candidate is available'
    })
  }
}
// Why: retention-cohort telemetry, not repo debugging — closed enums and count buckets only.
export const setupScriptPromptShownSchema = z
  .object(setupScriptPromptContextSchema)
  .strict()
  .superRefine(validateSetupScriptPromptProvider)
export const setupScriptDetectedSaveActions = [
  'save_detected_setup_clicked',
  'save_detected_setup_completed',
  'save_detected_setup_failed'
] as const

export function isSetupScriptDetectedSaveAction(action: unknown): boolean {
  return setupScriptDetectedSaveActions.includes(action as never)
}

export function validateSetupScriptPromptAction(
  props: SetupScriptPromptContextTelemetry & {
    action?: string
    edited_before_save?: boolean
  },
  ctx: z.RefinementCtx
): void {
  validateSetupScriptPromptProvider(props, ctx)
  const isDetectedSave = isSetupScriptDetectedSaveAction(props.action)
  if (isDetectedSave && props.provider !== 'package-manager') {
    ctx.addIssue({
      code: 'custom',
      path: ['provider'],
      message: 'detected setup save actions require the package-manager provider'
    })
  }
  if (isDetectedSave && props.edited_before_save === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['edited_before_save'],
      message: 'edited_before_save is required for detected setup save actions'
    })
  }
  if (!isDetectedSave && props.edited_before_save !== undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['edited_before_save'],
      message: 'edited_before_save is only valid for detected setup save actions'
    })
  }
}

export const setupScriptPromptActionSchema = z
  .object({
    ...setupScriptPromptContextSchema,
    action: z.enum([
      'import_completed',
      'import_failed',
      'configure_clicked',
      'dismissed',
      ...setupScriptDetectedSaveActions
    ]),
    edited_before_save: z.boolean().optional()
  })
  .strict()
  .superRefine(validateSetupScriptPromptAction)

// Managed-hook installer label from `AGENT_HOOK_TARGETS`, distinct from `AGENT_KIND_VALUES`; `claude` (not `claude-code`) is intentional.
export const hookInstallAgentSchema = z.enum(AGENT_HOOK_TARGETS)
export type HookInstallAgent = z.infer<typeof hookInstallAgentSchema>

// Why: config-shape errors (not user content); callers must truncate before `track` — `.max(200)` drops overlength strings.
export const agentHookInstallFailedSchema = z
  .object({
    agent: hookInstallAgentSchema,
    error_message: z.string().max(200)
  })
  .strict()

// Why: regression signal for paneKey attribution — a hook event that can't route to a pane. See docs/cli-terminal-hook-pane-key.md.
export const agentHookUnattributedSchema = z
  .object({ reason: z.enum(['empty_pane_key', 'unknown_tab_id']) })
  .strict()

// ── Onboarding ──────────────────────────────────────────────────────────
// Closed enums only — no raw paths/repo names/URLs/error strings (measures activation, not repo debugging).
// Why: event names still carry legacy seven-step payloads; keep validation backward-compatible for old rows.
export const ONBOARDING_TELEMETRY_LEGACY_MAX_STEP = 7
export const onboardingStepSchema = z.number().int().min(1).max(ONBOARDING_TELEMETRY_LEGACY_MAX_STEP)
export const onboardingPathSchema = z.enum(['open_folder', 'clone_url', 'add_project_modal'])
export const onboardingFailureReasonSchema = z.enum([
  'invalid_path',
  'clone_failed',
  'cancelled',
  'unknown'
])
export const onboardingValueKindSchema = z.enum([
  'agent',
  'theme',
  'notifications',
  'agent_setup',
  'integrations',
  'windows_terminal',
  'tour',
  'repo'
])
export const onboardingTourOutcomeSchema = z.enum(['skipped_intro', 'started_partial', 'completed_inline'])
export const onboardingTaskSourcesGithubStatusSchema = z.enum([
  'connected',
  'not_authenticated',
  'not_installed',
  'checking',
  'unknown'
])
export const onboardingTaskSourcesLinearStatusSchema = z.enum([
  'connected',
  'not_connected',
  'checking',
  'unknown'
])
export const onboardingTaskSourcesExitActionSchema = z.enum(['continue', 'skip_to_project_setup'])
export const onboardingWindowsTerminalShellSchema = z.enum([
  'powershell',
  'command_prompt',
  'git_bash',
  'wsl',
  'other'
])
export const onboardingWindowsTerminalRightClickSchema = z.enum(['paste', 'menu'])
export const onboardingWindowsTerminalExitActionSchema = z.enum(['continue', 'skip_to_project_setup'])
// `dismissed` is intentionally excluded — it's a UI panel-visibility flag, not an activation event.
export const onboardingChecklistItemSchema = z.enum([
  'addedRepo',
  'addedFolder',
  'choseAgent',
  'ranFirstAgent',
  'ranSecondAgentOnSameTask',
  'triedCmdJ',
  'shapedSidebar',
  'reviewedDiff',
  'openedPr',
  'openedFile',
  'ranAgentOnFile'
])
export const onboardingFeatureSetupFeatureSchema = z.enum([
  'browser_use',
  'computer_use',
  'orchestration',
  'linear_tickets'
])
export const onboardingFeatureSetupSelectionSchema = {
  browser_use: z.boolean(),
  computer_use: z.boolean(),
  linear_tickets: z.boolean(),
  orchestration: z.boolean(),
  selected_count: z.number().int().min(0).max(3)
} as const
export type OnboardingFeatureSetupSelectionTelemetry = {
  browser_use: boolean
  computer_use: boolean
  linear_tickets: boolean
  orchestration: boolean
  selected_count: number
}
export const onboardingFeatureSetupSelectedCountRefinement = {
  path: ['selected_count'],
  message: 'selected_count must match selected feature flags'
}

export function hasMatchingOnboardingFeatureSetupSelectedCount(
  props: OnboardingFeatureSetupSelectionTelemetry
): boolean {
  // Why: Linear ticket setup is a recommended add-on and excluded from progress metrics.
  const selectedCount =
    (props.browser_use ? 1 : 0) + (props.computer_use ? 1 : 0) + (props.orchestration ? 1 : 0)
  return props.selected_count === selectedCount
}

// Compile-time guard: enum must match OnboardingChecklistState activation keys (minus UI-only `dismissed`); drift breaks the build.
export type _OnboardingChecklistItemSync =
  z.infer<typeof onboardingChecklistItemSchema> extends Exclude<
    keyof OnboardingChecklistState,
    'dismissed'
  >
    ? Exclude<keyof OnboardingChecklistState, 'dismissed'> extends z.infer<
        typeof onboardingChecklistItemSchema
      >
      ? true
      : never
    : never
export const _onboardingChecklistItemSyncCheck: _OnboardingChecklistItemSync = true
void _onboardingChecklistItemSyncCheck

// Cohort discriminator for onboarding events; `.optional()` is load-bearing so `.strict()` accepts the `undefined` fallback.
export const cohortSchema = z.enum(['fresh_install', 'upgrade_backfill']).optional()

export const nestedRepoTelemetrySurfaceSchema = z.enum(NESTED_REPO_TELEMETRY_SURFACES)
export const nestedRepoTelemetryRuntimeKindSchema = z.enum(NESTED_REPO_TELEMETRY_RUNTIME_KINDS)
export const nestedRepoCountSchema = z.number().int().min(0).max(NESTED_REPO_TELEMETRY_MAX_REPO_COUNT)
export const nestedRepoCountBucketSchema = z.enum(NESTED_REPO_COUNT_BUCKETS)
export const nestedRepoScanResultSchema = z.enum(NESTED_REPO_SCAN_RESULTS)
export const nestedRepoImportActionSchema = z.enum(NESTED_REPO_IMPORT_ACTIONS)
export const nestedRepoImportOutcomeSchema = z.enum(NESTED_REPO_IMPORT_OUTCOMES)
export const nestedRepoScanPathKindSchema = z.enum(['git_repo', 'non_git_folder'])
export const nestedRepoImportModeSchema = z.enum(['group', 'separate'])
export const nestedRepoAttemptIdSchema = z.string().uuid()

export function validateNestedRepoCountBucket(
  props: Record<string, unknown>,
  countKey: string,
  bucketKey: string,
  ctx: z.RefinementCtx
): void {
  const count = props[countKey]
  const bucket = props[bucketKey]
  if (typeof count !== 'number' || typeof bucket !== 'string') {
    return
  }
  if (bucketNestedRepoTelemetryCount(count) !== bucket) {
    ctx.addIssue({
      code: 'custom',
      path: [bucketKey],
      message: `${bucketKey} must match ${countKey}`
    })
  }
}

export function validateNestedRepoCountBuckets(
  props: Record<string, unknown>,
  ctx: z.RefinementCtx
): void {
  validateNestedRepoCountBucket(props, 'found_count', 'found_count_bucket', ctx)
  validateNestedRepoCountBucket(props, 'selected_count', 'selected_count_bucket', ctx)
  validateNestedRepoCountBucket(props, 'imported_count', 'imported_count_bucket', ctx)
  validateNestedRepoCountBucket(props, 'already_known_count', 'already_known_count_bucket', ctx)
  validateNestedRepoCountBucket(props, 'failed_count', 'failed_count_bucket', ctx)
}

export const nestedRepoTelemetryBaseSchema = {
  // Why: high-cardinality but random and non-persistent — correlates scan→action→result without path-derived IDs.
  attempt_id: nestedRepoAttemptIdSchema,
  surface: nestedRepoTelemetrySurfaceSchema,
  runtime_kind: nestedRepoTelemetryRuntimeKindSchema,
  nth_repo_added: nthRepoAddedSchema
} as const

export const addRepoNestedScanResultSchema = z
  .object({
    ...nestedRepoTelemetryBaseSchema,
    result: nestedRepoScanResultSchema,
    selected_path_kind: nestedRepoScanPathKindSchema.optional(),
    found_count: nestedRepoCountSchema,
    found_count_bucket: nestedRepoCountBucketSchema,
    truncated: z.boolean(),
    timed_out: z.boolean()
  })
  .strict()
  .superRefine(validateNestedRepoCountBuckets)

export const addRepoNestedImportActionSchema = z
  .object({
    ...nestedRepoTelemetryBaseSchema,
    action: nestedRepoImportActionSchema,
    found_count: nestedRepoCountSchema,
    found_count_bucket: nestedRepoCountBucketSchema,
    selected_count: nestedRepoCountSchema,
    selected_count_bucket: nestedRepoCountBucketSchema,
    all_selected: z.boolean()
  })
  .strict()
  .superRefine(validateNestedRepoCountBuckets)

export const addRepoNestedImportResultSchema = z
  .object({
    ...nestedRepoTelemetryBaseSchema,
    mode: nestedRepoImportModeSchema,
    outcome: nestedRepoImportOutcomeSchema,
    found_count: nestedRepoCountSchema,
    found_count_bucket: nestedRepoCountBucketSchema,
    selected_count: nestedRepoCountSchema,
    selected_count_bucket: nestedRepoCountBucketSchema,
    imported_count: nestedRepoCountSchema,
    imported_count_bucket: nestedRepoCountBucketSchema,
    already_known_count: nestedRepoCountSchema,
    already_known_count_bucket: nestedRepoCountBucketSchema,
    failed_count: nestedRepoCountSchema,
    failed_count_bucket: nestedRepoCountBucketSchema,
    all_selected: z.boolean()
  })
  .strict()
  .superRefine(validateNestedRepoCountBuckets)

// Uniform button/keyboard shape lets keyboard skip/dismiss paths arrive without a schema migration.
export const advancedViaSchema = z.enum(['button', 'keyboard']).optional()
