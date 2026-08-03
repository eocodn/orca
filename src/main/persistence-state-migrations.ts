import { open } from 'node:fs/promises'
import type { Automation, AutomationPrecheckResult, AutomationRunOutputSnapshot, AutomationSchedulerOwner } from '../shared/automations-types'
import { normalizeAutomationPrecheck } from '../shared/automation-precheck'
import type { PersistedState, ProjectHostSetup, Repo, WorkspaceLineage, WorkspaceKey, NotificationSettings } from '../shared/types'
import { projectHostSetupProjectionFromRepos } from '../shared/project-host-setup-projection'
import { isPluginPanelTabKey } from '../shared/plugins/plugin-manifest'
import { buildTaskSourceContextFromRepo, buildWorkspaceRunContext } from '../shared/task-source-context'
import { getRepoExecutionHostId, parseExecutionHostId } from '../shared/execution-host'
import { getDefaultNotificationSettings, getDefaultUIState } from '../shared/constants'
import { parsePaneKey } from '../shared/stable-pane-id'
import { isWorkspaceKey } from '../shared/workspace-scope'

export { parseWorkspaceSessionsByHostId,
  backupPath,
  buildWorkspaceDirHistoryForUpdate,
  type LegacyTerminalScrollbackSettings,
  LEGACY_TERMINAL_TUI_SCROLL_SENSITIVITY_DEFAULT,
  readLegacyTerminalScrollbackSettings,
  stripLegacyTerminalScrollbackBytes,
  migrateTerminalScrollbackRows,
  migrateTerminalTuiScrollSensitivityDefault,
  getWorkspaceLayoutHistoryKey,
  migrateAgentYoloDefaults,
  normalizeGroupBy,
  normalizeShowDotfilesByWorktree,
  mergeFeatureInteractions,
  mergeContextualTourSeenIds,
  stripMainOwnedTelemetryMarkerFromUI,
  normalizeSortBy,
  normalizeProjectOrderBy } from './persistence-state-paths'

export function normalizeRightSidebarTab(tab: unknown): PersistedState['ui']['rightSidebarTab'] {
  if (
    tab === 'explorer' ||
    tab === 'search' ||
    tab === 'vault' ||
    tab === 'workspaces' ||
    tab === 'pr-checks' ||
    tab === 'source-control' ||
    tab === 'checks' ||
    tab === 'ports'
  ) {
    return tab
  }
  // Why: plugin tabs are open-ended `plugin:<publisher>.<id>/<panel>` keys; validate the
  // shape so a persisted plugin tab doesn't reset to Explorer on restart.
  if (typeof tab === 'string' && isPluginPanelTabKey(tab)) {
    return tab
  }
  return getDefaultUIState().rightSidebarTab
}

export function normalizeWorkspaceLineageByChildKey(
  value: unknown
): Record<WorkspaceKey, WorkspaceLineage> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const normalized: Record<WorkspaceKey, WorkspaceLineage> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!isWorkspaceKey(key) || !entry || typeof entry !== 'object') {
      continue
    }
    const lineage = entry as Partial<WorkspaceLineage>
    const childWorkspaceKey =
      typeof lineage.childWorkspaceKey === 'string' && isWorkspaceKey(lineage.childWorkspaceKey)
        ? lineage.childWorkspaceKey
        : key
    const parentWorkspaceKey = lineage.parentWorkspaceKey
    if (
      !isWorkspaceKey(childWorkspaceKey) ||
      typeof parentWorkspaceKey !== 'string' ||
      !isWorkspaceKey(parentWorkspaceKey) ||
      childWorkspaceKey !== key ||
      childWorkspaceKey === parentWorkspaceKey
    ) {
      continue
    }
    normalized[childWorkspaceKey] = {
      childWorkspaceKey,
      childInstanceId: lineage.childInstanceId ?? null,
      parentWorkspaceKey,
      parentInstanceId: lineage.parentInstanceId ?? null,
      origin: lineage.origin ?? 'cli',
      capture: lineage.capture ?? { source: 'manual-action', confidence: 'inferred' },
      ...(lineage.taskId ? { taskId: lineage.taskId } : {}),
      ...(lineage.orchestrationRunId ? { orchestrationRunId: lineage.orchestrationRunId } : {}),
      ...(lineage.coordinatorHandle ? { coordinatorHandle: lineage.coordinatorHandle } : {}),
      ...(lineage.createdByTerminalHandle
        ? { createdByTerminalHandle: lineage.createdByTerminalHandle }
        : {}),
      createdAt: Number.isFinite(lineage.createdAt) ? Number(lineage.createdAt) : Date.now()
    }
  }
  return normalized
}

export function normalizeRightSidebarExplorerView(
  view: unknown,
  tab?: unknown
): PersistedState['ui']['rightSidebarExplorerView'] {
  // Why: older builds persisted Search as a standalone activity tab.
  if (tab === 'search') {
    return 'search'
  }
  if (view === 'files' || view === 'search') {
    return view
  }
  return getDefaultUIState().rightSidebarExplorerView
}

export function normalizeNotificationSettings(value: unknown): NotificationSettings {
  const defaults = getDefaultNotificationSettings()
  const candidate =
    value && typeof value === 'object' ? (value as Partial<NotificationSettings>) : {}
  const rawSoundId = (candidate as { customSoundId?: unknown }).customSoundId
  const customSoundId =
    rawSoundId === 'system' ||
    rawSoundId === 'two-tone' ||
    rawSoundId === 'bong' ||
    rawSoundId === 'thump' ||
    rawSoundId === 'blip' ||
    rawSoundId === 'sonar' ||
    rawSoundId === 'blop' ||
    rawSoundId === 'ding' ||
    rawSoundId === 'clack' ||
    rawSoundId === 'beep' ||
    rawSoundId === 'custom'
      ? rawSoundId
      : rawSoundId === 'orca' || rawSoundId === 'chime'
        ? 'two-tone'
        : rawSoundId === 'pop'
          ? 'blop'
          : typeof candidate.customSoundPath === 'string'
            ? 'custom'
            : defaults.customSoundId
  const rawVolume = candidate.customSoundVolume
  const customSoundVolume =
    typeof rawVolume === 'number' && Number.isFinite(rawVolume)
      ? Math.min(100, Math.max(0, rawVolume))
      : defaults.customSoundVolume
  return {
    ...defaults,
    ...candidate,
    customSoundId,
    customSoundVolume
  }
}

export function normalizeAutomationRunWorkspaceDisplayName(value: string | null): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export function normalizeAutomationRunTerminalPaneKey(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed && parsePaneKey(trimmed) ? trimmed : null
}

export function normalizeAutomationRunTerminalPtyId(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed || null
}

export function normalizeAutomationRunOutputSnapshot(
  value: AutomationRunOutputSnapshot | null | undefined
): AutomationRunOutputSnapshot | null {
  if (!value || value.format !== 'plain_text') {
    return null
  }
  const content = typeof value.content === 'string' ? value.content : ''
  if (!content.trim()) {
    return null
  }
  return {
    format: 'plain_text',
    content,
    capturedAt:
      typeof value.capturedAt === 'number' && Number.isFinite(value.capturedAt)
        ? value.capturedAt
        : Date.now(),
    truncated: value.truncated === true
  }
}

export function normalizeAutomationPrecheckResult(
  value: AutomationPrecheckResult | null | undefined
): AutomationPrecheckResult | null {
  if (!value || typeof value.command !== 'string' || !value.command.trim()) {
    return null
  }
  const startedAt =
    typeof value.startedAt === 'number' && Number.isFinite(value.startedAt)
      ? value.startedAt
      : Date.now()
  const completedAt =
    typeof value.completedAt === 'number' && Number.isFinite(value.completedAt)
      ? value.completedAt
      : startedAt
  return {
    command: value.command.trim(),
    exitCode:
      typeof value.exitCode === 'number' && Number.isFinite(value.exitCode) ? value.exitCode : null,
    timedOut: value.timedOut === true,
    durationMs:
      typeof value.durationMs === 'number' && Number.isFinite(value.durationMs)
        ? Math.max(0, value.durationMs)
        : Math.max(0, completedAt - startedAt),
    stdout: typeof value.stdout === 'string' ? value.stdout : '',
    stderr: typeof value.stderr === 'string' ? value.stderr : '',
    stdoutTruncated: value.stdoutTruncated === true,
    stderrTruncated: value.stderrTruncated === true,
    error: typeof value.error === 'string' && value.error.trim() ? value.error : null,
    startedAt,
    completedAt
  }
}

export function normalizeAutomationSessionReuse(automation: Automation): Automation {
  const setupDecision = normalizeAutomationSetupDecisionForWorkspaceMode(
    automation.workspaceMode,
    automation.setupDecision
  )
  return {
    ...automation,
    precheck: normalizeAutomationPrecheck(automation.precheck),
    setupDecision,
    reuseSession: automation.workspaceMode === 'existing' && automation.reuseSession === true
  }
}

export function normalizeAutomationSetupDecisionForWorkspaceMode(
  workspaceMode: Automation['workspaceMode'],
  setupDecision: unknown
): Automation['setupDecision'] {
  return workspaceMode === 'new_per_run' && (setupDecision === 'run' || setupDecision === 'skip')
    ? setupDecision
    : undefined
}

export function getAutomationContextsForRepo(
  repo: Repo | undefined,
  projectHostSetups: readonly ProjectHostSetup[]
): Pick<Automation, 'runContext' | 'sourceContext'> {
  if (!repo) {
    return {
      runContext: null,
      sourceContext: null
    }
  }
  const projection = projectHostSetupProjectionFromRepos([repo])
  const projectedProject = projection.projects[0]
  const projectedSetup = projection.setups[0]
  const setup =
    projectHostSetups.find((candidate) => candidate.repoId === repo.id) ?? projectedSetup
  const runContext = setup
    ? buildWorkspaceRunContext({
        projectId: setup.projectId,
        hostId: setup.hostId,
        projectHostSetupId: setup.id,
        repoId: repo.id,
        path: setup.path
      })
    : null
  const providerIdentity = projectedProject?.providerIdentity
  const sourceContext = providerIdentity
    ? buildTaskSourceContextFromRepo({
        provider: providerIdentity.provider,
        projectId: providerIdentity.provider === 'github' ? (setup?.projectId ?? repo.id) : repo.id,
        repo,
        projectHostSetupId: setup?.id,
        providerIdentity
      })
    : null
  return {
    runContext,
    sourceContext
  }
}

export function getAutomationSchedulerOwner(repo: Repo | undefined): AutomationSchedulerOwner {
  if (!repo) {
    return 'local_host_service'
  }
  const host = parseExecutionHostId(getRepoExecutionHostId(repo))
  if (host?.kind === 'ssh') {
    return 'ssh_bridge'
  }
  if (host?.kind === 'runtime') {
    return 'remote_host_service'
  }
  return 'local_host_service'
}
