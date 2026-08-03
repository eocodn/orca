import type { PersistedState, GlobalSettings, OrcaWorkspaceLayout, WorkspaceSessionState } from '../shared/types'
import { LOCAL_EXECUTION_HOST_ID, normalizeExecutionHostId, type ExecutionHostId } from '../shared/execution-host'
import { getDefaultUIState } from '../shared/constants'
import { parseWorkspaceSession } from '../shared/workspace-session-schema'
import { normalizeRuntimePathForComparison } from '../shared/cross-platform-path'
import { legacyTerminalScrollbackBytesToRows, normalizeDesktopTerminalScrollbackRows } from '../shared/terminal-scrollback-policy'
import { normalizeFeatureInteractions } from '../shared/feature-interactions'
import { normalizeContextualTourIds } from '../shared/contextual-tours'
import { DEFAULT_TUI_AGENT_ARGS, DEFAULT_TUI_AGENT_ENV, normalizeTuiAgentArgsRecord, normalizeTuiAgentEnvRecord } from '../shared/tui-agent-launch-defaults'

export { encrypt,
  decrypt,
  decryptOptionalSecret,
  retireLegacyInstructionsForClearedTextActionRecipes,
  _dataFile,
  _userDataDir,
  initDataPath,
  getDataFile,
  getGithubCacheFile,
  WORKTREE_META_GC_GRACE_MS,
  gcStaleWorktreeMeta,
  normalizeWorktreeLinkedItemMetadata,
  readGithubCacheSnapshot,
  getCanonicalUserDataPath,
  migrateMobilePairingDataToCanonicalUserDataPath,
  BACKUP_COUNT,
  BACKUP_MIN_INTERVAL_MS,
  WORKSPACE_SESSION_PATCH_FULL_NORMALIZATION_KEYS,
  logPersistenceStartupMilestone,
  workspaceSessionPatchNeedsFullNormalization } from './persistence-state-foundation'

export function parseWorkspaceSessionsByHostId(
  raw: unknown,
  defaults: WorkspaceSessionState
): Partial<Record<ExecutionHostId, WorkspaceSessionState>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {}
  }
  const partitions: Partial<Record<ExecutionHostId, WorkspaceSessionState>> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const hostId = normalizeExecutionHostId(key)
    // Why: 'local' lives in workspaceSession; a local/invalid key here is legacy noise that must not shadow the canonical partition.
    if (!hostId || hostId === LOCAL_EXECUTION_HOST_ID) {
      continue
    }
    const result = parseWorkspaceSession(value)
    if (!result.ok) {
      console.error(
        `[persistence] Corrupt workspace session for host ${hostId}, using defaults:`,
        result.error
      )
      continue
    }
    partitions[hostId] = { ...defaults, ...result.value }
  }
  return partitions
}

export function backupPath(dataFile: string, index: number): string {
  return `${dataFile}.bak.${index}`
}

export function buildWorkspaceDirHistoryForUpdate(
  current: GlobalSettings,
  updates: Partial<GlobalSettings>
): OrcaWorkspaceLayout[] | null {
  if (!('workspaceDir' in updates) && !('nestWorkspaces' in updates)) {
    return null
  }
  const nextPath = updates.workspaceDir ?? current.workspaceDir
  const nextNestWorkspaces = updates.nestWorkspaces ?? current.nestWorkspaces
  if (
    normalizeRuntimePathForComparison(nextPath) ===
      normalizeRuntimePathForComparison(current.workspaceDir) &&
    nextNestWorkspaces === current.nestWorkspaces
  ) {
    return null
  }

  const previousLayout = {
    path: current.workspaceDir,
    nestWorkspaces: current.nestWorkspaces
  }
  const existing = current.workspaceDirHistory ?? []
  const next = [...existing]
  const previousKey = getWorkspaceLayoutHistoryKey(previousLayout)
  if (!next.some((layout) => getWorkspaceLayoutHistoryKey(layout) === previousKey)) {
    next.push(previousLayout)
  }
  return next
}

export type LegacyTerminalScrollbackSettings = {
  terminalScrollbackRows?: unknown
  terminalScrollbackBytes?: unknown
}

export const LEGACY_TERMINAL_TUI_SCROLL_SENSITIVITY_DEFAULT = 3

export function readLegacyTerminalScrollbackSettings(settings: unknown): LegacyTerminalScrollbackSettings {
  return settings && typeof settings === 'object'
    ? (settings as LegacyTerminalScrollbackSettings)
    : {}
}

export function stripLegacyTerminalScrollbackBytes(
  settings: Partial<GlobalSettings> | undefined
): Partial<GlobalSettings> {
  const { terminalScrollbackBytes: _legacyScrollbackBytes, ...rest } = (settings ??
    {}) as Partial<GlobalSettings> & { terminalScrollbackBytes?: unknown }
  void _legacyScrollbackBytes
  return rest
}

export function migrateTerminalScrollbackRows(settings: unknown): {
  rows: number
  needsSave: boolean
} {
  const legacySettings = readLegacyTerminalScrollbackSettings(settings)
  const hasRows = Object.prototype.hasOwnProperty.call(legacySettings, 'terminalScrollbackRows')
  const hasLegacyBytes = Object.prototype.hasOwnProperty.call(
    legacySettings,
    'terminalScrollbackBytes'
  )
  const rows = hasRows
    ? normalizeDesktopTerminalScrollbackRows(legacySettings.terminalScrollbackRows)
    : legacyTerminalScrollbackBytesToRows(legacySettings.terminalScrollbackBytes)

  return {
    rows,
    needsSave: !hasRows || hasLegacyBytes || legacySettings.terminalScrollbackRows !== rows
  }
}

export function migrateTerminalTuiScrollSensitivityDefault(settings: GlobalSettings | undefined): {
  settings: Pick<
    GlobalSettings,
    'terminalTuiScrollSensitivity' | 'terminalTuiScrollSensitivityDefaultedToOne'
  >
  needsSave: boolean
} {
  const alreadyDefaultedToOne = settings?.terminalTuiScrollSensitivityDefaultedToOne === true
  const current = settings?.terminalTuiScrollSensitivity
  const shouldMoveInheritedDefault =
    !alreadyDefaultedToOne &&
    (current === undefined || current === LEGACY_TERMINAL_TUI_SCROLL_SENSITIVITY_DEFAULT)
  const terminalTuiScrollSensitivity = shouldMoveInheritedDefault ? 1 : (current ?? 1)

  return {
    settings: {
      terminalTuiScrollSensitivity,
      terminalTuiScrollSensitivityDefaultedToOne: true
    },
    needsSave: !alreadyDefaultedToOne || current === undefined
  }
}

export function getWorkspaceLayoutHistoryKey(layout: OrcaWorkspaceLayout): string {
  return `${normalizeRuntimePathForComparison(layout.path)}:${layout.nestWorkspaces}`
}

export function migrateAgentYoloDefaults(
  settings: GlobalSettings | undefined
): Pick<GlobalSettings, 'agentDefaultArgs' | 'agentDefaultEnv' | 'agentYoloDefaultsMigrated'> {
  const existingArgs = normalizeTuiAgentArgsRecord(settings?.agentDefaultArgs)
  const existingEnv = normalizeTuiAgentEnvRecord(settings?.agentDefaultEnv)
  if (settings?.agentYoloDefaultsMigrated === true) {
    return {
      agentDefaultArgs: existingArgs,
      agentDefaultEnv: existingEnv,
      agentYoloDefaultsMigrated: true
    }
  }

  const commandOverrides = settings?.agentCmdOverrides ?? {}
  const migratedArgs = { ...existingArgs }
  for (const [agent, args] of Object.entries(DEFAULT_TUI_AGENT_ARGS)) {
    if (agent in migratedArgs) {
      continue
    }
    if (agent in commandOverrides) {
      migratedArgs[agent as keyof typeof DEFAULT_TUI_AGENT_ARGS] = ''
      continue
    }
    migratedArgs[agent as keyof typeof DEFAULT_TUI_AGENT_ARGS] = args
  }

  const migratedEnv = { ...existingEnv }
  for (const [agent, env] of Object.entries(DEFAULT_TUI_AGENT_ENV)) {
    if (agent in migratedEnv) {
      continue
    }
    if (agent in commandOverrides) {
      migratedEnv[agent as keyof typeof DEFAULT_TUI_AGENT_ENV] = {}
      continue
    }
    migratedEnv[agent as keyof typeof DEFAULT_TUI_AGENT_ENV] = { ...env }
  }

  return {
    // Why: legacy users could only customize launch defaults via command overrides, so those agents count as already user-owned.
    agentDefaultArgs: migratedArgs,
    agentDefaultEnv: migratedEnv,
    agentYoloDefaultsMigrated: true
  }
}

export function normalizeGroupBy(groupBy: unknown): PersistedState['ui']['groupBy'] {
  if (
    groupBy === 'none' ||
    groupBy === 'workspace-status' ||
    groupBy === 'repo' ||
    groupBy === 'pr-status'
  ) {
    return groupBy
  }
  if (groupBy === 'flat') {
    return 'none'
  }
  return getDefaultUIState().groupBy
}

export function normalizeShowDotfilesByWorktree(value: unknown): Record<string, boolean> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const out: Record<string, boolean> = {}
  for (const [worktreeId, showDotfiles] of Object.entries(value as Record<string, unknown>)) {
    if (
      !worktreeId ||
      worktreeId === '__proto__' ||
      worktreeId === 'constructor' ||
      worktreeId === 'prototype' ||
      typeof showDotfiles !== 'boolean'
    ) {
      continue
    }
    out[worktreeId] = showDotfiles
  }
  return out
}

export function mergeFeatureInteractions(
  current: PersistedState['ui']['featureInteractions'],
  incoming: PersistedState['ui']['featureInteractions']
): PersistedState['ui']['featureInteractions'] {
  const currentNormalized = normalizeFeatureInteractions(current)
  const incomingNormalized = normalizeFeatureInteractions(incoming)
  const merged = { ...currentNormalized }
  for (const [id, incomingRecord] of Object.entries(incomingNormalized)) {
    const currentRecord = currentNormalized[id as keyof typeof currentNormalized]
    merged[id as keyof typeof merged] = currentRecord
      ? {
          firstInteractedAt: Math.min(
            currentRecord.firstInteractedAt,
            incomingRecord.firstInteractedAt
          ),
          interactionCount: Math.max(
            currentRecord.interactionCount,
            incomingRecord.interactionCount
          )
        }
      : incomingRecord
  }
  return merged
}

export function mergeContextualTourSeenIds(
  current: PersistedState['ui']['contextualToursSeenIds'],
  incoming: PersistedState['ui']['contextualToursSeenIds']
): PersistedState['ui']['contextualToursSeenIds'] {
  const merged = new Set(normalizeContextualTourIds(current))
  for (const id of normalizeContextualTourIds(incoming)) {
    merged.add(id)
  }
  return [...merged]
}

export function stripMainOwnedTelemetryMarkerFromUI(
  value: Partial<PersistedState['ui']> | undefined
): Partial<PersistedState['ui']> {
  if (!value || typeof value !== 'object') {
    return {}
  }
  const { featureInteractionTelemetryBuckets: _reserved, ...ui } = value as Partial<
    PersistedState['ui']
  > & {
    featureInteractionTelemetryBuckets?: unknown
  }
  void _reserved
  return ui
}

export function normalizeSortBy(sortBy: unknown): PersistedState['ui']['sortBy'] {
  if (
    sortBy === 'smart' ||
    sortBy === 'recent' ||
    sortBy === 'repo' ||
    sortBy === 'name' ||
    sortBy === 'manual'
  ) {
    return sortBy
  }
  return getDefaultUIState().sortBy
}
