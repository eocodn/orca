import { z } from 'zod'
import * as core from './telemetry-event-core-schemas'
import * as onboarding from './telemetry-event-onboarding-schemas'
import * as education from './telemetry-event-education-schemas'

const {
  appOpenedSchema,
  featureInteractionUsageBucketReachedSchema,
  repoAddedSchema,
  appStarredOrcaSchema,
  starNagOutcomeEventSchema,
  workspaceCreatedSchema,
  agentStartedSchema,
  agentPromptSentSchema,
  agentErrorSchema,
  daemonStartFailedSchema,
  runtimeRpcStartFailedSchema,
  mainThreadHangDetectedSchema,
  daemonLifecycleSchema,
  daemonAuditEligibilitySchema,
  codexTrustGrantSchema,
  settingsChangedSchema,
  nativeChatToggledSchema,
  nativeChatMessageSentSchema,
  nativeChatPickerOpenedSchema,
  nativeChatPickerItemAcceptedSchema,
  nativeChatSendClassifiedSchema,
  nativeChatSkillDiscoverySchema,
  telemetryOptedInSchema,
  telemetryOptedOutSchema,
  orcaCliFeatureTipShownSchema,
  orcaCliFeatureTipSetupClickedSchema,
  orcaCliFeatureTipSetupResultSchema,
  cmdJPaletteFeatureTipShownSchema,
  cmdJPaletteFeatureTipAcknowledgedSchema,
  featureWallOpenedSchema,
  featureWallClosedSchema,
  featureWallTileFocusedSchema,
  featureWallTileClickedSchema,
  featureWallGroupSelectedSchema,
  featureWallFeatureSelectedSchema,
  featureWallDocsClickedSchema
} = core
const {
  addRepoSetupStepActionEventSchema,
  addRepoExistingWorkspacesDetectedSchema,
  addRepoDefaultCheckoutHandoffSchema,
  workspaceCreateFailedSchema,
  setupScriptPromptShownSchema,
  setupScriptPromptActionSchema,
  agentHookInstallFailedSchema,
  agentHookUnattributedSchema,
  addRepoNestedScanResultSchema,
  addRepoNestedImportActionSchema,
  addRepoNestedImportResultSchema,
  cohortSchema
} = onboarding
const {
  onboardingStartedSchema,
  onboardingStepViewedSchema,
  onboardingStepCompletedSchema,
  onboardingStepSkippedSchema,
  onboardingTourOutcomeEventSchema,
  onboardingStep4PathClickedSchema,
  onboardingStep4PathFailedSchema,
  onboardingTaskSourcesSnapshotSchema,
  onboardingWindowsTerminalSnapshotSchema,
  onboardingCompletedSchema,
  onboardingDismissedSchema,
  activationChecklistItemCompletedSchema,
  onboardingAgentPickedSchema,
  onboardingGhosttyDiscoveredSchema,
  onboardingGhosttyImportClickedSchema,
  smartSortClassDistributionSchema,
  smartSortClass1PromotionSchema,
  smartToRecentSwitchSchema,
  onboardingGhosttyImportFailedSchema,
  onboardingFeatureSetupToggledSchema,
  onboardingFeatureSetupRunSchema,
  onboardingFeatureSetupTerminalOpenedSchema,
  onboardingFeatureSetupTerminalInteractedSchema,
  contextualTourShownSchema,
  contextualTourOutcomeSchema,
  setupGuideOpenedSchema,
  setupGuideClosedSchema,
  setupGuideStepCompletedSchema,
  terminalPaneSplitSchema,
  editorExternalChangeConflictShownSchema,
  editorExternalChangeConflictActionSchema,
  directSshReconnectOperationSchema
} = education

export const eventSchemas = {
  app_opened: appOpenedSchema,
  app_starred_orca: appStarredOrcaSchema,
  star_nag_outcome: starNagOutcomeEventSchema,
  feature_interaction_usage_bucket_reached: featureInteractionUsageBucketReachedSchema,

  repo_added: repoAddedSchema,
  add_repo_setup_step_action: addRepoSetupStepActionEventSchema,
  add_repo_existing_workspaces_detected: addRepoExistingWorkspacesDetectedSchema,
  add_repo_default_checkout_handoff: addRepoDefaultCheckoutHandoffSchema,
  add_repo_nested_scan_result: addRepoNestedScanResultSchema,
  add_repo_nested_import_action: addRepoNestedImportActionSchema,
  add_repo_nested_import_result: addRepoNestedImportResultSchema,
  workspace_created: workspaceCreatedSchema,
  workspace_create_failed: workspaceCreateFailedSchema,
  setup_script_prompt_shown: setupScriptPromptShownSchema,
  setup_script_prompt_action: setupScriptPromptActionSchema,

  agent_started: agentStartedSchema,
  agent_prompt_sent: agentPromptSentSchema,
  agent_error: agentErrorSchema,
  agent_hook_install_failed: agentHookInstallFailedSchema,
  agent_hook_unattributed: agentHookUnattributedSchema,

  daemon_start_failed: daemonStartFailedSchema,
  main_thread_hang_detected: mainThreadHangDetectedSchema,
  daemon_lifecycle: daemonLifecycleSchema,
  daemon_audit_eligibility: daemonAuditEligibilitySchema,
  runtime_rpc_start_failed: runtimeRpcStartFailedSchema,

  codex_trust_grant: codexTrustGrantSchema,

  settings_changed: settingsChangedSchema,

  native_chat_toggled: nativeChatToggledSchema,
  native_chat_message_sent: nativeChatMessageSentSchema,
  native_chat_picker_opened: nativeChatPickerOpenedSchema,
  native_chat_picker_item_accepted: nativeChatPickerItemAcceptedSchema,
  native_chat_send_classified: nativeChatSendClassifiedSchema,
  native_chat_skill_discovery: nativeChatSkillDiscoverySchema,

  telemetry_opted_in: telemetryOptedInSchema,
  telemetry_opted_out: telemetryOptedOutSchema,

  orca_cli_feature_tip_shown: orcaCliFeatureTipShownSchema,
  orca_cli_feature_tip_setup_clicked: orcaCliFeatureTipSetupClickedSchema,
  orca_cli_feature_tip_setup_result: orcaCliFeatureTipSetupResultSchema,
  cmd_j_palette_feature_tip_shown: cmdJPaletteFeatureTipShownSchema,
  cmd_j_palette_feature_tip_acknowledged: cmdJPaletteFeatureTipAcknowledgedSchema,

  feature_wall_opened: featureWallOpenedSchema,
  feature_wall_closed: featureWallClosedSchema,
  feature_wall_tile_focused: featureWallTileFocusedSchema,
  feature_wall_tile_clicked: featureWallTileClickedSchema,
  feature_wall_group_selected: featureWallGroupSelectedSchema,
  feature_wall_feature_selected: featureWallFeatureSelectedSchema,
  feature_wall_docs_clicked: featureWallDocsClickedSchema,

  onboarding_started: onboardingStartedSchema,
  onboarding_step_viewed: onboardingStepViewedSchema,
  onboarding_step_completed: onboardingStepCompletedSchema,
  onboarding_step_skipped: onboardingStepSkippedSchema,
  onboarding_tour_outcome: onboardingTourOutcomeEventSchema,
  onboarding_step4_path_clicked: onboardingStep4PathClickedSchema,
  onboarding_step4_path_failed: onboardingStep4PathFailedSchema,
  onboarding_task_sources_snapshot: onboardingTaskSourcesSnapshotSchema,
  onboarding_windows_terminal_snapshot: onboardingWindowsTerminalSnapshotSchema,
  onboarding_completed: onboardingCompletedSchema,
  onboarding_dismissed: onboardingDismissedSchema,
  onboarding_agent_picked: onboardingAgentPickedSchema,
  onboarding_ghostty_discovered: onboardingGhosttyDiscoveredSchema,
  onboarding_ghostty_import_clicked: onboardingGhosttyImportClickedSchema,
  onboarding_ghostty_import_failed: onboardingGhosttyImportFailedSchema,
  onboarding_feature_setup_toggled: onboardingFeatureSetupToggledSchema,
  onboarding_feature_setup_run: onboardingFeatureSetupRunSchema,
  onboarding_feature_setup_terminal_opened: onboardingFeatureSetupTerminalOpenedSchema,
  onboarding_feature_setup_terminal_interacted: onboardingFeatureSetupTerminalInteractedSchema,
  activation_checklist_item_completed: activationChecklistItemCompletedSchema,

  contextual_tour_shown: contextualTourShownSchema,
  contextual_tour_outcome: contextualTourOutcomeSchema,
  setup_guide_opened: setupGuideOpenedSchema,
  setup_guide_closed: setupGuideClosedSchema,
  setup_guide_step_completed: setupGuideStepCompletedSchema,
  terminal_pane_split: terminalPaneSplitSchema,

  editor_external_change_conflict_shown: editorExternalChangeConflictShownSchema,
  editor_external_change_conflict_action: editorExternalChangeConflictActionSchema,

  direct_ssh_reconnect_operation: directSshReconnectOperationSchema,

  smart_sort_class_distribution: smartSortClassDistributionSchema,
  smart_sort_class_1_promotion: smartSortClass1PromotionSchema,
  smart_to_recent_switch: smartToRecentSwitchSchema
} as const

export type EventMap = { [N in keyof typeof eventSchemas]: z.infer<(typeof eventSchemas)[N]> }
export type EventName = keyof EventMap
export type EventProps<N extends EventName> = EventMap[N]

// Why: non-`ZodObject` schemas have no `.shape`; return null so `key in undefined` can't throw at module load.
function eventSchemaShape(schema: z.ZodTypeAny): z.ZodRawShape | null {
  if (schema instanceof z.ZodObject) {
    return schema.shape
  }

  const shapeBearingSchema = schema as { shape?: unknown }
  // Why: refined object schemas may expose `.shape` even when refinement breaks `instanceof ZodObject`.
  if (shapeBearingSchema.shape && typeof shapeBearingSchema.shape === 'object') {
    return shapeBearingSchema.shape as z.ZodRawShape
  }
  return null
}

function eventsWithShapeKey(key: string): ReadonlySet<EventName> {
  return new Set(
    (Object.entries(eventSchemas) as [EventName, z.ZodTypeAny][])
      .filter(([, schema]) => {
        const shape = eventSchemaShape(schema)
        return shape !== null && key in shape
      })
      .map(([name]) => name)
  )
}

// Cohort injection is gated on this derived set because `.strict()` schemas drop events that don't declare `nth_repo_added`.
const COHORT_EXTENDED_SET = eventsWithShapeKey('nth_repo_added')
export const COHORT_EXTENDED: readonly EventName[] = Array.from(COHORT_EXTENDED_SET)

// Compile-time roster guarding the runtime injection set against silent schema drift.
type _CohortExtendedRoster =
  | 'app_opened'
  | 'app_starred_orca'
  | 'star_nag_outcome'
  | 'feature_interaction_usage_bucket_reached'
  | 'repo_added'
  | 'add_repo_setup_step_action'
  | 'add_repo_existing_workspaces_detected'
  | 'add_repo_default_checkout_handoff'
  | 'add_repo_nested_scan_result'
  | 'add_repo_nested_import_action'
  | 'add_repo_nested_import_result'
  | 'workspace_created'
  | 'workspace_create_failed'
  | 'setup_script_prompt_shown'
  | 'setup_script_prompt_action'
  | 'agent_started'
  | 'agent_prompt_sent'
  | 'agent_error'
  | 'orca_cli_feature_tip_shown'
  | 'orca_cli_feature_tip_setup_clicked'
  | 'orca_cli_feature_tip_setup_result'
  | 'cmd_j_palette_feature_tip_shown'
  | 'cmd_j_palette_feature_tip_acknowledged'
// Why: strict empty payloads infer a string index signature; ignore index-only keys so they aren't pulled into keyed rosters.
type _KnownPayloadKeys<T> = string extends keyof T ? never : keyof T
type _DerivedCohortExtendedEvents = {
  [N in EventName]: 'nth_repo_added' extends _KnownPayloadKeys<EventMap[N]> ? N : never
}[EventName]
type _CohortExtendedRosterSync = _CohortExtendedRoster extends _DerivedCohortExtendedEvents
  ? _DerivedCohortExtendedEvents extends _CohortExtendedRoster
    ? true
    : never
  : never
const _cohortExtendedRosterSyncCheck: _CohortExtendedRosterSync = true
void _cohortExtendedRosterSyncCheck

export function isCohortExtendedEvent(name: EventName): boolean {
  return COHORT_EXTENDED_SET.has(name)
}

// Events whose schema declares `cohort`: the IPC handler injects cohort only for these — a `.strict()` schema without it would reject the event.
const ONBOARDING_COHORT_SET = eventsWithShapeKey('cohort')
// `NonNullable` strips `undefined` introduced by `cohortSchema`'s `.optional()`.
export type OnboardingCohort = NonNullable<z.infer<typeof cohortSchema>>

// Compile-time roster: dropping `cohort` from any of these fails tsc, rather than silently at runtime (`.optional()` would tolerate that).
type _OnboardingCohortRoster =
  | 'onboarding_started'
  | 'onboarding_step_viewed'
  | 'onboarding_step_completed'
  | 'onboarding_step_skipped'
  | 'onboarding_tour_outcome'
  | 'onboarding_step4_path_clicked'
  | 'onboarding_step4_path_failed'
  | 'onboarding_task_sources_snapshot'
  | 'onboarding_windows_terminal_snapshot'
  | 'onboarding_completed'
  | 'onboarding_dismissed'
  | 'onboarding_agent_picked'
  | 'onboarding_ghostty_discovered'
  | 'onboarding_ghostty_import_clicked'
  | 'onboarding_ghostty_import_failed'
  | 'onboarding_feature_setup_toggled'
  | 'onboarding_feature_setup_run'
  | 'onboarding_feature_setup_terminal_opened'
  | 'onboarding_feature_setup_terminal_interacted'
type _DerivedOnboardingCohortEvents = {
  [N in EventName]: 'cohort' extends _KnownPayloadKeys<EventMap[N]> ? N : never
}[EventName]
type _OnboardingCohortRosterSync = _OnboardingCohortRoster extends _DerivedOnboardingCohortEvents
  ? _DerivedOnboardingCohortEvents extends _OnboardingCohortRoster
    ? true
    : never
  : never
const _onboardingCohortRosterSyncCheck: _OnboardingCohortRosterSync = true
void _onboardingCohortRosterSyncCheck

export function isOnboardingEvent(name: EventName): boolean {
  return ONBOARDING_COHORT_SET.has(name)
}

// No `env` discriminator: every transmitted event is from an official CI build (dev/contributor builds only console-mirror).
// The per-field `.max(64)` is the validator's string-length cap — there is no separate post-parse length check.
export const commonPropsSchema = z
  .object({
    app_version: z.string().max(64),
    platform: z.string().max(64),
    arch: z.string().max(64),
    os_release: z.string().max(64),
    // `.min(1)`: an empty install_id/session_id would collapse unrelated events into one synthetic user/session, corrupting analytics.
    install_id: z.string().min(1).max(64),
    session_id: z.string().min(1).max(64),
    orca_channel: z.enum(['stable', 'rc'])
  })
  .strict()
export type CommonProps = z.infer<typeof commonPropsSchema>

export * from './telemetry-event-shared-enums'
export * from './telemetry-event-core-schemas'
export * from './telemetry-event-onboarding-schemas'
export * from './telemetry-event-education-schemas'
