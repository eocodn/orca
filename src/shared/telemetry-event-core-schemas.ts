
import { z } from 'zod'
import { FEATURE_WALL_MAX_DWELL_MS } from './feature-wall-telemetry'
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
import { appStarSourceSchema } from './gh-star-source'
import {
  starNagAgentBucketSchema,
  starNagOutcomeSchema,
  starNagPromptModeSchema,
  starNagPromptSourceSchema
} from './star-nag-telemetry'
import * as shared from './telemetry-event-shared-enums'
const {
  agentKindSchema,
  errorClassSchema,
  repoMethodSchema,
  workspaceSourceSchema,
  launchSourceSchema,
  requestKindSchema,
  featureWallTileIdSchema,
  featureWallOpenSourceSchema,
  featureWallWorkflowIdSchema,
  featureWallTourDepthStepSchema,
  featureWallExitActionSchema,
  optInViaSchema,
  settingsChangedKeySchema
} = shared

export const nthRepoAddedSchema = z.number().int().nonnegative().optional()

export const appOpenedSchema = z.object({ nth_repo_added: nthRepoAddedSchema }).strict()

export const featureInteractionIdSchema = z.enum(FEATURE_INTERACTION_IDS)
export const featureInteractionCategorySchema = z.enum(FEATURE_INTERACTION_CATEGORIES)
export const featureInteractionUsageBucketSchema = z.enum(FEATURE_INTERACTION_USAGE_BUCKETS)
export const featureInteractionUsageBucketSourceSchema = z.enum([
  'crossed_now',
  'observed_existing'
])
export const featureInteractionUsageBucketReachedSchema = z
  .object({
    feature_id: featureInteractionIdSchema,
    feature_category: featureInteractionCategorySchema,
    count_bucket: featureInteractionUsageBucketSchema,
    bucket_source: featureInteractionUsageBucketSourceSchema,
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()
  .refine((value) => getFeatureInteractionCategory(value.feature_id) === value.feature_category, {
    message: 'feature_category must match feature_id',
    path: ['feature_category']
  })

export const repoAddedSchema = z
  // Why: `.optional()` so paths that can't detect git-ness validate cleanly; never default-guess `false` — omit instead.
  .object({
    method: repoMethodSchema,
    is_git_repo: z.boolean().optional(),
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()

export const appStarredOrcaSchema = z
  .object({
    source: appStarSourceSchema,
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()

export const starNagOutcomeEventSchema = z
  .object({
    outcome: starNagOutcomeSchema,
    source: starNagPromptSourceSchema,
    mode: starNagPromptModeSchema,
    threshold: z.number().int().positive(),
    agents_since_baseline: z.number().int().nonnegative(),
    agents_since_baseline_bucket: starNagAgentBucketSchema,
    nth_repo_added: nthRepoAddedSchema,
    next_threshold: z.number().int().positive().optional(),
    cooldown_days: z.number().int().positive().optional()
  })
  .strict()
  .refine(
    (payload) =>
      payload.next_threshold === undefined ||
      payload.outcome === 'dismissed' ||
      payload.outcome === 'later',
    {
      message: 'next_threshold is only valid for later or dismissed outcomes',
      path: ['next_threshold']
    }
  )
  .refine(
    (payload) =>
      payload.cooldown_days === undefined ||
      payload.outcome === 'later' ||
      payload.outcome === 'dismissed',
    {
      message: 'cooldown_days is only valid for later or dismissed outcomes',
      path: ['cooldown_days']
    }
  )

export const workspaceCreatedSchema = z
  .object({
    source: workspaceSourceSchema,
    from_existing_branch: z.boolean(),
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()

export const agentStartedSchema = z
  .object({
    agent_kind: agentKindSchema,
    launch_source: launchSourceSchema,
    request_kind: requestKindSchema,
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()
export const agentPromptSentSchema = z
  .object({
    agent_kind: agentKindSchema,
    launch_source: launchSourceSchema,
    request_kind: requestKindSchema,
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()

// Enum-only by design: `.strict()` blocks `error_message`/`error_stack`, keeping raw user/path content off the wire.
export const agentErrorSchema = z
  .object({
    error_class: errorClassSchema,
    agent_kind: agentKindSchema,
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()

// Why: daemon start-failure signal (fleet-wide outage like v1.4.129-rc.1); enum-only so raw stderr never reaches the wire.
export const daemonStartFailedSchema = z.object({ error_class: errorClassSchema }).strict()

export const runtimeRpcStartErrorClassSchema = z.enum([
  'permission_denied',
  'address_in_use',
  'storage_unavailable',
  'invalid_path',
  'unknown'
])
export type RuntimeRpcStartErrorClass = z.infer<typeof runtimeRpcStartErrorClassSchema>

// Why: runtime discovery failures can contain user paths; keep telemetry to closed filesystem/socket categories.
export const runtimeRpcStartFailedSchema = z
  .object({ error_class: runtimeRpcStartErrorClassSchema })
  .strict()

// Why: a deadlocked main thread never crashes, so it produces no crash report and no user report
// beyond "it froze" — incidence has been unmeasurable. `self_recovered` splits stalls that cleared
// from ones that never did, which is the number that decides whether auto-recovery is ever safe to
// build: every self-recovered stall is a kill that design would have gotten wrong. `unresponsive_ms`
// is the observed silence, kept raw so the 45s threshold can be calibrated against real tails.
export const mainThreadHangDetectedSchema = z
  .object({
    unresponsive_ms: z.number().int().nonnegative(),
    self_recovered: z.boolean()
  })
  .strict()

// Why: daemon replace/retire lifecycle signal — issue #7936 was undiagnosable without asking a user for daemon.log.
// Enum-only + bucketed session count so no paths, raw versions, or exact counts reach the wire.
// The union keeps each reason pinned to its transition, so a death can't be reported as a replace.
export const daemonLifecycleSchema = z.discriminatedUnion('transition', [
  z
    .object({
      transition: z.literal(DAEMON_LIFECYCLE_TRANSITIONS[0]),
      reason: z.enum(DAEMON_REPLACE_REASONS),
      live_session_count_bucket: z.enum(DAEMON_LIFECYCLE_SESSION_BUCKETS)
    })
    .strict(),
  z
    .object({
      transition: z.literal(DAEMON_LIFECYCLE_TRANSITIONS[1]),
      reason: z.enum(DAEMON_RETIRE_REASONS),
      live_session_count_bucket: z.enum(DAEMON_LIFECYCLE_SESSION_BUCKETS)
    })
    .strict()
])

export const daemonAuditEligibilitySchema = z
  .object({
    state: z.enum(DAEMON_AUDIT_STATE_VALUES),
    reason: z.enum(DAEMON_AUDIT_REASON_VALUES),
    trigger: z.enum(DAEMON_AUDIT_TRIGGER_VALUES),
    evidence_sources: z.array(z.enum(DAEMON_EVIDENCE_SOURCE_VALUES)).min(1).max(12),
    protocol_generation: z.number().int().positive().max(1_000),
    provider: z.literal('local-daemon'),
    endpoint_kind: z.enum(['unix-socket', 'windows-named-pipe']),
    profile_scope: z.enum(['configured', 'unspecified']),
    exact_incarnation: z.enum([
      'endpoint-identity',
      'endpoint-identity-linux-ticks',
      'unavailable'
    ]),
    reachability: z.enum(['authenticated', 'disconnected', 'unknown']),
    inventory_authority: z.enum(['authoritative', 'unavailable']),
    process_liveness: z.enum(['present', 'gone', 'unknown']),
    process_reason: z.enum(DAEMON_AUDIT_PROCESS_REASON_VALUES).nullable(),
    endpoint_state: z.enum(['missing', 'named-pipe', 'non-socket', 'socket', 'unknown'])
  })
  .strict()

// Rollout signal for granting Codex hook trust via codex app-server RPCs
// instead of Orca's self-computed trusted_hash. `fallback`/`verify_failed`
// spikes mean the RPC lane is not taking; steady-state ledger skips are not
// reported (they would only measure launch volume). `lane` attributes the
// grant surface (real ~/.codex vs managed home); `error_class`/`verify_class`
// are closed classifications so `error` fallbacks are diagnosable in the
// field — e.g. `binary-missing` = codex CLI absent, no rollout impact.
export const codexTrustGrantSchema = z
  .object({
    outcome: z.enum(['granted', 'fallback', 'verify_failed']),
    host_kind: z.enum(['native', 'wsl']),
    lane: z.enum(['real-home', 'managed']),
    fallback_reason: z
      .enum([
        'disabled',
        'no-managed-entries',
        'unsupported',
        'unsupported-cached',
        'verify-failed',
        'retry-cached',
        'error'
      ])
      .optional(),
    error_class: z
      .enum(['binary-missing', 'timeout', 'entry-failed', 'early-exit', 'rpc-failed', 'unexpected'])
      .optional(),
    verify_class: z
      .enum([
        'list-mismatch',
        'post-grant-untrusted',
        'post-grant-mismatch',
        'unexpected-key',
        'duplicate-key',
        'coverage'
      ])
      .optional()
  })
  .strict()

export const settingsChangedSchema = z
  .object({
    setting_key: settingsChangedKeySchema,
    value_kind: z.enum(['bool', 'enum'])
  })
  .strict()

export const telemetryOptedInSchema = z.object({ via: optInViaSchema }).strict()
export const telemetryOptedOutSchema = z.object({ via: optInViaSchema }).strict()

export const orcaCliFeatureTipSourceSchema = z.enum(['app_open', 'manual'])
export const orcaCliFeatureTipShownSchema = z
  .object({
    source: orcaCliFeatureTipSourceSchema,
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()
export const orcaCliFeatureTipSetupClickedSchema = z
  .object({
    source: orcaCliFeatureTipSourceSchema,
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()
export const orcaCliFeatureTipSetupResultSchema = z
  .object({
    source: orcaCliFeatureTipSourceSchema,
    result: z.enum(['installed', 'needs_attention', 'dev_preview', 'failed']),
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()

export const cmdJPaletteFeatureTipShownSchema = z
  .object({
    source: orcaCliFeatureTipSourceSchema,
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()
export const cmdJPaletteFeatureTipAcknowledgedSchema = z
  .object({
    source: orcaCliFeatureTipSourceSchema,
    nth_repo_added: nthRepoAddedSchema
  })
  .strict()

export const featureWallOpenedSchema = z
  .object({
    source: featureWallOpenSourceSchema
  })
  .strict()
export const featureWallClosedSchema = z
  .object({
    dwell_ms: z.number().int().min(0).max(FEATURE_WALL_MAX_DWELL_MS),
    source: featureWallOpenSourceSchema.optional(),
    exit_action: featureWallExitActionSchema.optional(),
    furthest_step: featureWallTourDepthStepSchema.optional(),
    last_group_id: featureWallWorkflowIdSchema.optional(),
    visited_workflow_count: z.number().int().min(0).max(5).optional(),
    visited_substep_count: z.number().int().min(0).max(9).optional(),
    completed_workflow_count: z.number().int().min(0).max(5).optional(),
    completed_substep_count: z.number().int().min(0).max(9).optional()
  })
  .strict()
export const featureWallTileFocusedSchema = z
  .object({
    tile_id: featureWallTileIdSchema
  })
  .strict()
export const featureWallTileClickedSchema = z
  .object({
    tile_id: featureWallTileIdSchema
  })
  .strict()
export const featureWallGroupSelectedSchema = z
  .object({
    group_id: featureWallWorkflowIdSchema,
    source: featureWallOpenSourceSchema
  })
  .strict()
export const featureWallFeatureSelectedSchema = z
  .object({
    group_id: featureWallWorkflowIdSchema,
    tile_id: featureWallTileIdSchema,
    source: featureWallOpenSourceSchema
  })
  .strict()
export const featureWallDocsClickedSchema = z
  .object({
    group_id: featureWallWorkflowIdSchema,
    tile_id: featureWallTileIdSchema,
    source: featureWallOpenSourceSchema
  })
  .strict()
