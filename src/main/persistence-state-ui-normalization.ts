import { resolve } from 'node:path'
import type { Automation, AutomationRun } from '../shared/automations-types'
import { getAutomationLegacyRepoId } from '../shared/automation-run-identity'
import type { PersistedState, Repo, GlobalSettings, OnboardingChecklistState, OnboardingOutcome, OnboardingState } from '../shared/types'
import { LEGACY_DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS, type SshTarget } from '../shared/ssh-types'
import { getDefaultOnboardingState, ONBOARDING_FLOW_VERSION, ONBOARDING_FINAL_STEP } from '../shared/constants'
import { getAutomationContextsForRepo } from './persistence-state-migrations'

export { normalizeRightSidebarTab,
  normalizeWorkspaceLineageByChildKey,
  normalizeRightSidebarExplorerView,
  normalizeNotificationSettings,
  normalizeAutomationRunWorkspaceDisplayName,
  normalizeAutomationRunTerminalPaneKey,
  normalizeAutomationRunTerminalPtyId,
  normalizeAutomationRunOutputSnapshot,
  normalizeAutomationPrecheckResult,
  normalizeAutomationSessionReuse,
  normalizeAutomationSetupDecisionForWorkspaceMode,
  getAutomationContextsForRepo,
  getAutomationSchedulerOwner } from './persistence-state-migrations'

export function backfillLegacyAutomationContexts(
  state: Pick<PersistedState, 'automations' | 'automationRuns' | 'repos' | 'projectHostSetups'>
): {
  state: Pick<PersistedState, 'automations' | 'automationRuns' | 'repos' | 'projectHostSetups'>
  changed: boolean
} {
  let changed = false
  const contextsByAutomationId = new Map<string, Pick<Automation, 'runContext' | 'sourceContext'>>()
  const automations = (state.automations ?? []).map((automation) => {
    const contexts = getAutomationContextsForRepo(
      state.repos.find((repo) => repo.id === getAutomationLegacyRepoId(automation)),
      state.projectHostSetups ?? []
    )
    const next: Automation = { ...automation }
    if (!Object.hasOwn(next, 'runContext')) {
      // Why: pre-host-context automations only stored a repo id; backfill the run target once so dispatch/precheck stop inferring it.
      next.runContext = contexts.runContext
      changed = true
    }
    if (!Object.hasOwn(next, 'sourceContext')) {
      next.sourceContext = contexts.sourceContext
      changed = true
    }
    contextsByAutomationId.set(next.id, {
      runContext: next.runContext ?? null,
      sourceContext: next.sourceContext ?? null
    })
    return next
  })
  const automationRuns = (state.automationRuns ?? []).map((run) => {
    const automationContexts = contextsByAutomationId.get(run.automationId)
    const next: AutomationRun = { ...run }
    if (!Object.hasOwn(next, 'runContext')) {
      next.runContext = automationContexts?.runContext ?? null
      changed = true
    }
    if (!Object.hasOwn(next, 'sourceContext')) {
      next.sourceContext = automationContexts?.sourceContext ?? null
      changed = true
    }
    if (!Object.hasOwn(next, 'terminalPaneKey')) {
      next.terminalPaneKey = null
      changed = true
    }
    if (!Object.hasOwn(next, 'terminalPtyId')) {
      next.terminalPtyId = null
      changed = true
    }
    return next
  })
  if (!changed) {
    return { state, changed: false }
  }
  return {
    state: {
      ...state,
      automations,
      automationRuns
    },
    changed: true
  }
}

export type LegacySshTarget = SshTarget & {
  remoteWorkspaceSyncEnabled?: unknown
  remoteWorkspaceSyncGracePeriodSeconds?: unknown
  experimentalPtySourceCreditV1?: unknown
}

// Why: old targets predate configHost; default to label-based lookup so imported SSH aliases still resolve via ssh -G.
export function normalizeSshTarget(t: SshTarget): SshTarget {
  const target = { ...(t as LegacySshTarget) }
  const legacySyncEnabled = target.remoteWorkspaceSyncEnabled
  const currentGracePeriodSeconds = target.relayGracePeriodSeconds
  const legacyGracePeriodSeconds = target.remoteWorkspaceSyncGracePeriodSeconds
  const systemSshConnectionReuse = target.systemSshConnectionReuse
  // Why: remote sync now follows the SSH relay lifecycle, so retired per-target sync/grace fields are dropped at disk load.
  delete target.remoteWorkspaceSyncEnabled
  delete target.remoteWorkspaceSyncGracePeriodSeconds
  delete target.relayGracePeriodSeconds
  delete target.systemSshConnectionReuse
  delete target.experimentalPtySourceCreditV1
  // Why: prefer the synced grace over stale relayGracePeriodSeconds so a user's "unlimited" (0) survives migration.
  const relayGracePeriodSeconds =
    legacySyncEnabled === true && typeof legacyGracePeriodSeconds === 'number'
      ? legacyGracePeriodSeconds
      : currentGracePeriodSeconds
  const normalized: SshTarget = {
    ...target,
    configHost: target.configHost ?? target.label ?? target.host
  }
  // Why: old SSH form persisted 10800 even without a user choice; treat that legacy default as the new implicit default.
  if (
    relayGracePeriodSeconds !== undefined &&
    relayGracePeriodSeconds !== LEGACY_DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS
  ) {
    normalized.relayGracePeriodSeconds = relayGracePeriodSeconds
  }
  if (systemSshConnectionReuse === false) {
    normalized.systemSshConnectionReuse = false
  }
  return normalized
}

// Why: strict whitelist rejects unknown/bad-typed keys; returns Partial so partial updates don't clobber valid persisted state.
export type SanitizeOnboardingUpdateOptions = {
  migrateLegacyProgress?: boolean
}

export function remapLegacyOnboardingLastCompletedStep(
  lastCompletedStep: number,
  raw: Record<string, unknown>
): number {
  if (raw.outcome === 'completed' && lastCompletedStep >= 4) {
    return ONBOARDING_FINAL_STEP
  }
  // Why: v3 (pre-Windows-terminal-page) step 4 already meant notifications, so resume there, not the inserted Windows step.
  if (raw.flowVersion === 3) {
    return Math.min(4, lastCompletedStep)
  }
  // Why: v2's five-step flow had step 4 = removed agent setup, not completed integrations.
  if (raw.flowVersion === 2) {
    if (lastCompletedStep === 3) {
      return 2
    }
    if (lastCompletedStep >= 4) {
      return 3
    }
    return lastCompletedStep
  }
  if (lastCompletedStep === 3) {
    return 2
  }
  if (lastCompletedStep === 4) {
    return 2
  }
  if (lastCompletedStep >= 5) {
    return 3
  }
  return lastCompletedStep
}

export function sanitizeOnboardingUpdate(
  input: unknown,
  options: SanitizeOnboardingUpdateOptions = {}
): Partial<Omit<OnboardingState, 'checklist'>> & { checklist?: Partial<OnboardingChecklistState> } {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {}
  }
  const raw = input as Record<string, unknown>
  const out: Partial<Omit<OnboardingState, 'checklist'>> & {
    checklist?: Partial<OnboardingChecklistState>
  } = {}

  if ('closedAt' in raw) {
    // Why: NaN/Infinity serialize to null on save, reverting closedAt and reopening the wizard; require a finite timestamp.
    if (typeof raw.closedAt === 'number' && Number.isFinite(raw.closedAt) && raw.closedAt >= 0) {
      out.closedAt = raw.closedAt
    } else if (raw.closedAt === null) {
      out.closedAt = null
    }
    // else: omit — preserve existing persisted value on merge.
  }
  if ('outcome' in raw) {
    const v = raw.outcome
    if (v === 'completed' || v === 'dismissed') {
      out.outcome = v as OnboardingOutcome
    } else if (v === null) {
      out.outcome = null
    }
    // else: omit.
  }
  if ('flowVersion' in raw) {
    const v = raw.flowVersion
    if (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= ONBOARDING_FLOW_VERSION) {
      out.flowVersion = v
    }
    // else: omit.
  }
  if ('lastCompletedStep' in raw) {
    const v = raw.lastCompletedStep
    if (typeof v === 'number' && Number.isInteger(v) && v >= -1) {
      const isLegacyFlow =
        options.migrateLegacyProgress && raw.flowVersion !== ONBOARDING_FLOW_VERSION
      // Why: removing two wizard pages changed step numbering; migrate legacy values before the final-step bound drops them.
      const normalized = isLegacyFlow ? remapLegacyOnboardingLastCompletedStep(v, raw) : v
      if (normalized <= ONBOARDING_FINAL_STEP) {
        out.lastCompletedStep = normalized
      }
    }
    // else: omit.
  }
  if ('checklist' in raw) {
    const rawChecklist = raw.checklist
    if (rawChecklist && typeof rawChecklist === 'object' && !Array.isArray(rawChecklist)) {
      // Why: copy ONLY caller-sent boolean keys so partial updates don't reset other checklist items to false.
      const defaults = getDefaultOnboardingState().checklist
      const rc = rawChecklist as Record<string, unknown>
      const checklist: Partial<OnboardingChecklistState> = {}
      for (const key of Object.keys(defaults) as (keyof OnboardingChecklistState)[]) {
        if (key in rc && typeof rc[key] === 'boolean') {
          checklist[key] = rc[key] as boolean
        }
      }
      out.checklist = checklist
    }
  }
  if (options.migrateLegacyProgress) {
    out.flowVersion = ONBOARDING_FLOW_VERSION
  }
  return out
}

export function normalizeLoadedOnboardingState(
  input: unknown,
  defaults: OnboardingState
): OnboardingState {
  // Why: an existing file with no onboarding block is an upgrade user; backfill as completed so they skip the wizard.
  if (!input) {
    return {
      ...defaults,
      closedAt: Date.now(),
      outcome: 'completed',
      lastCompletedStep: ONBOARDING_FINAL_STEP
    }
  }
  // Why: sanitize persisted onboarding keys so a type-flipped field on disk can't poison in-memory state.
  const sanitized = sanitizeOnboardingUpdate(input, {
    migrateLegacyProgress: true
  })
  // Why: a completed/dismissed outcome means the user left; recover a bad closedAt instead of reopening the checklist.
  const recoveredClosedAt =
    typeof sanitized.closedAt === 'number'
      ? sanitized.closedAt
      : sanitized.outcome !== null && sanitized.outcome !== undefined
        ? Date.now()
        : sanitized.closedAt
  return {
    ...defaults,
    ...sanitized,
    closedAt: recoveredClosedAt ?? defaults.closedAt,
    checklist: {
      ...defaults.checklist,
      ...sanitized.checklist
    }
  }
}

export function resolveSetupGuideSidebarDismissedOnLoad(
  persistedDismissed: unknown,
  onboarding: OnboardingState
): boolean {
  // Why: once onboarding is closed, persisted false is just the old default, not a user opt-in to the sidebar checklist.
  return onboarding.closedAt !== null || persistedDismissed === true
}

// Why: read a settings field removed from GlobalSettings but still on disk; one-shot for the inline-agents migration.
export function readDeprecatedExperimentFlag(parsed: PersistedState | undefined): boolean {
  return (
    (parsed?.settings as { experimentalAgentDashboard?: boolean } | undefined)
      ?.experimentalAgentDashboard === true
  )
}

export function readLegacySidekickFlag(parsed: PersistedState | undefined): boolean | undefined {
  return (parsed?.settings as { experimentalSidekick?: boolean } | undefined)?.experimentalSidekick
}

export function sanitizeRepoUpstream(value: unknown): Repo['upstream'] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (value === null) {
    return null
  }
  if (!value || typeof value !== 'object') {
    return undefined
  }
  const candidate = value as { owner?: unknown; repo?: unknown }
  const owner = typeof candidate.owner === 'string' ? candidate.owner.trim() : ''
  const repo = typeof candidate.repo === 'string' ? candidate.repo.trim() : ''
  return owner && repo ? { owner, repo } : undefined
}
