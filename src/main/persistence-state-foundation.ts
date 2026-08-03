import { app, safeStorage } from 'electron'
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  unlinkSync,
  copyFileSync,
  statSync,
  realpathSync
} from 'node:fs'
import { rename, mkdir, rm, copyFile, open } from 'node:fs/promises'
import { renameDurableSync, writeFileDurableSync } from './durable-file-write'
import { join, dirname, isAbsolute, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { createHash, randomUUID } from 'node:crypto'
import type {
  Automation,
  AutomationCreateInput,
  AutomationDispatchResult,
  AutomationPrecheckResult,
  AutomationRunOutputSnapshot,
  AutomationRun,
  AutomationSchedulerOwner,
  AutomationRunTrigger,
  AutomationUpdateInput
} from '../shared/automations-types'
import {
  latestAutomationOccurrenceAtOrBefore,
  nextAutomationOccurrenceAfter
} from '../shared/automation-schedules'
import { getAutomationLegacyRepoId } from '../shared/automation-run-identity'
import { normalizeAutomationPrecheck } from '../shared/automation-precheck'
import type {
  PersistedState,
  Project,
  ProjectUpdateArgs,
  ProjectHostSetup,
  ProjectHostSetupCreateArgs,
  ProjectHostSetupCreateResult,
  ProjectHostSetupDeleteArgs,
  ProjectHostSetupDeleteResult,
  ProjectHostSetupUpdateArgs,
  ProjectHostSetupUpdateResult,
  RepoProjectHostSetupMethod,
  Repo,
  ProjectGroup,
  FolderWorkspace,
  SparsePreset,
  PersistedMobileClientTabSelections,
  WorktreeMeta,
  WorktreeLineage,
  WorkspaceLineage,
  WorkspaceKey,
  GlobalSettings,
  OrcaWorkspaceLayout,
  NotificationSettings,
  OnboardingChecklistState,
  OnboardingOutcome,
  OnboardingState,
  LegacyPaneKeyAliasEntry,
  TerminalPaneLayoutNode,
  TerminalLayoutSnapshot,
  TerminalTab,
  WorkspaceSessionPatch,
  WorkspaceSessionState
} from '../shared/types'
import {
  deriveGlobalWindowsRuntimeDefaultFromLegacySettings,
  normalizeProjectRuntimePreference
} from '../shared/project-execution-runtime'
import { projectHostSetupProjectionFromRepos } from '../shared/project-host-setup-projection'
import { isPluginPanelTabKey } from '../shared/plugins/plugin-manifest'
import type { GitRemoteIdentity } from '../shared/git-remote-identity'
import {
  areTaskSourceContextsEqual,
  buildTaskSourceContextFromRepo,
  buildWorkspaceRunContext,
  normalizeStoredTaskSourceContext
} from '../shared/task-source-context'
import {
  areWorkspaceLinkedItemsEqual,
  normalizeWorkspaceLinkedItem
} from '../shared/workspace-linked-item'
import { isWorkspaceLinkedItemSourceContextMatch } from '../shared/workspace-linked-item-source-context'
import type { MigrationUnsupportedPtyEntry } from '../shared/agent-status-types'
import { MOBILE_PAIRING_USERDATA_FILES } from './runtime/mobile-pairing-files'
import { normalizePersistedMobileClientTabSelections } from './runtime/client-session-tab-selection-persistence'
import { sanitizeWorkspaceSessionTerminalRetirements } from './runtime/mobile-session-terminal-persistence-retirement'
import {
  removeRepoFromHostWorkspaceSessions,
  removeRepoFromWorkspaceSession
} from './orca-profiles/profile-project-session-state'
import { hardenExistingSecureFile } from '../shared/secure-file'
import {
  LEGACY_DEFAULT_SSH_RELAY_GRACE_PERIOD_SECONDS,
  type RemovedSshTargetTombstone,
  type SshRemotePtyLease,
  type SshTarget
} from '../shared/ssh-types'
import { isFolderRepo } from '../shared/repo-kind'
import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  normalizeExecutionHostOrder,
  normalizeExecutionHostId,
  normalizeVisibleExecutionHostIds,
  toSshExecutionHostId,
  type ExecutionHostId
} from '../shared/execution-host'
import {
  getDefaultPersistedState,
  getDefaultNotificationSettings,
  getDefaultOnboardingState,
  getDefaultVoiceSettings,
  getDefaultUIState,
  getDefaultRepoHookSettings,
  getDefaultWorkspaceSession,
  getWorktreeCardModeProperties,
  isDefaultedCompactWorktreeCardProperties,
  normalizeAgentActivityDisplayMode,
  normalizeWorktreeCardProperties,
  ONBOARDING_FLOW_VERSION,
  ONBOARDING_FINAL_STEP
} from '../shared/constants'
import { parseWorkspaceSession } from '../shared/workspace-session-schema'
import { normalizeUsagePercentageDisplay } from '../shared/usage-percentage-display'
import { normalizeStatusBarUsageMode } from '../shared/status-bar-usage-mode'
import { isExistingPersistedProfile } from '../shared/project-order-manual-default-notice'
import { resolveUsagePercentageDisplayChangeNoticeDismissed } from '../shared/usage-percentage-display-change-notice'
import { normalizePRBotAuthorOverrides } from '../shared/pr-bot-author-overrides'
import { toRelaySshPtyId } from './providers/ssh-pty-id'
import {
  migrateUiHostScopeSshTargetId,
  migrateWorkspaceSessionSshTargetId
} from './ssh/ssh-target-id-migration'
import { isWslUncPath } from '../shared/wsl-paths'
import {
  isTerminalLeafId,
  makePaneKey,
  parseLegacyNumericPaneKey,
  parsePaneKey
} from '../shared/stable-pane-id'
import {
  setMigrationUnsupportedPty,
  setMigrationUnsupportedPtyPersistenceListener
} from './agent-hooks/migration-unsupported-pty-state'
import { agentHookServer } from './agent-hooks/server'
import { pruneLocalTerminalScrollbackBuffers } from '../shared/workspace-session-terminal-buffers'
import {
  backfillAutomationRunNumbers,
  nextAutomationRunNumber,
  pruneAutomationRuns
} from '../shared/automation-run-retention'
import { pruneWorkspaceSessionBrowserHistory } from '../shared/workspace-session-browser-history'
import {
  FOLDER_WORKSPACE_INSTANCE_SEPARATOR,
  getRepoIdFromWorktreeId,
  getWorktreePathBasenameFromId
} from '../shared/worktree-id'
import {
  isPathInsideOrEqual,
  isWindowsAbsolutePathLike,
  normalizeRuntimePathForComparison
} from '../shared/cross-platform-path'
import { normalizeTerminalQuickCommands } from '../shared/terminal-quick-commands'
import { normalizeTaskProviderSettings } from '../shared/task-providers'
import { normalizeAutoRenameBranchFromWorkDefaultOn } from '../shared/auto-rename-branch-from-work-settings'
import { normalizeOpenInApplications } from '../shared/open-in-applications'
import { normalizeTerminalShortcutPolicy } from '../shared/keybindings'
import { normalizeSourceControlGroupOrder } from '../shared/source-control-group-order'
import { normalizeAppIconId } from '../shared/app-icon'
import { normalizeTerminalCustomThemes } from '../shared/terminal-custom-themes'
import {
  legacyTerminalScrollbackBytesToRows,
  normalizeDesktopTerminalScrollbackRows
} from '../shared/terminal-scrollback-policy'
import {
  compareFeatureInteractionUsageBuckets,
  getFeatureInteractionCategory,
  getFeatureInteractionUsageBucket,
  normalizeFeatureInteractions,
  normalizeFeatureInteractionTelemetryBuckets,
  type FeatureInteractionId
} from '../shared/feature-interactions'
import { normalizeContextualTourIds } from '../shared/contextual-tours'
import { normalizeFeatureTipIds } from '../shared/feature-tips'
import {
  parseCodexResetCreditAttemptLedger,
  type CodexResetCreditAttemptLedger
} from '../shared/codex-reset-credit-attempt-ledger'
import { normalizeManualRepoOrder } from '../shared/manual-repo-order'
import {
  DEFAULT_WORKSPACE_STATUS_ID,
  clampWorkspaceBoardColumnWidth,
  clampWorkspaceBoardOpacity,
  normalizePersistedWorkspaceStatuses,
  normalizeWorkspaceStatuses
} from '../shared/workspace-statuses'
import { clampMarkdownTocPanelWidth } from '../shared/markdown-toc-panel-width'
import { clampCombinedDiffFileTreeWidth } from '../shared/combined-diff-file-tree-width'
import { isLegacyRepoForExternalWorktreeVisibility } from '../shared/worktree-ownership'
import { sanitizeRepoIcon } from '../shared/repo-icon'
import { normalizeRepoBadgeColor } from '../shared/repo-badge-color'
import {
  clearMissingProjectGroupMemberships,
  createProjectGroup,
  getNextProjectGroupOrder,
  getProjectGroupSubtreeIds,
  normalizeProjectGroupName,
  normalizeProjectGroups
} from '../shared/project-groups'
import { createNestedProjectGroupResolver } from './project-groups/nested-repo-import'
import {
  mergeLegacyCommitMessageAiIntoSourceControlAi,
  normalizeRepoSourceControlAiOverrides,
  normalizeSourceControlAiSettings,
  projectSourceControlAiToLegacyCommitMessageAi,
  sourceControlAiSettingsFromLegacy
} from '../shared/source-control-ai'
import {
  DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES,
  SOURCE_CONTROL_TEXT_ACTION_IDS
} from '../shared/source-control-ai-actions'
import { normalizeDisabledTuiAgents } from '../shared/tui-agent-selection'
import {
  DEFAULT_TUI_AGENT_ARGS,
  DEFAULT_TUI_AGENT_ENV,
  hasUnsupportedTuiAgentArgs,
  normalizeTuiAgentArgsRecord,
  normalizeTuiAgentEnvRecord
} from '../shared/tui-agent-launch-defaults'
import { normalizeTerminalCursorStyleDefault } from '../shared/terminal-cursor-style-settings'
import {
  normalizeOsc52ClipboardDefaultOn,
  osc52ClipboardDefaultOnOverridesPersistedOff
} from '../shared/osc52-clipboard-settings'
import { normalizeTerminalLineHeight } from '../shared/terminal-line-height-settings'
import { normalizeUiLanguage } from '../shared/ui-language'
import { normalizeBrowserPageZoomLevel } from '../shared/browser-page-zoom'
import { persistedUIValuesEqual } from '../shared/persisted-ui-equality'
import { ActiveViewPreference } from './active-view-preference'
import {
  normalizeFolderWorkspaceName,
  normalizeFolderWorkspaceOperationId,
  normalizeFolderWorkspaces
} from '../shared/folder-workspaces'
import {
  folderWorkspaceKey,
  isWorkspaceKey,
  parseWorkspaceKey,
  worktreeWorkspaceKey
} from '../shared/workspace-scope'
import {
  collectTerminalScrollbackSnapshotRefs,
  deleteTerminalScrollbackSnapshotSync,
  getProfileTerminalScrollbackSnapshotRoot,
  migrateWorkspaceSessionTerminalScrollbackSnapshots,
  readTerminalScrollbackSnapshotSync,
  type TerminalScrollbackSnapshotStorage
} from './terminal-scrollback-snapshots'
import { track } from './telemetry/client'
import { getCohortAtEmit } from './telemetry/cohort-classifier'
import { isStartupDiagnosticsEnabled, logStartupDiagnostic } from './startup/startup-diagnostics'
import {
  cloneLayoutNode,
  cloneLayoutWithLeafIds,
  collectLayoutLeafCounts,
  collectLayoutLeafIdsInOrder,
  findWorktreeIdForTab,
  firstLayoutLeafId,
  leafRecordEquivalent,
  layoutContainsLeafId,
  preserveMissingLeafRecordEntries,
  remapLeafRecordForPersistence
} from './persistence-layout-records'

export function encrypt(plaintext: string): string {
  if (!plaintext || !safeStorage.isEncryptionAvailable()) {
    return plaintext
  }
  try {
    return safeStorage.encryptString(plaintext).toString('base64')
  } catch (err) {
    console.error('[persistence] Encryption failed:', err)
    return plaintext
  }
}

export function decrypt(ciphertext: string): string {
  if (!ciphertext || !safeStorage.isEncryptionAvailable()) {
    return ciphertext
  }
  try {
    return safeStorage.decryptString(Buffer.from(ciphertext, 'base64'))
  } catch {
    // Why: decrypt failure usually means plaintext (pre-encryption) or a changed keychain; return raw so the cookie survives upgrade.
    console.warn(
      '[persistence] safeStorage decryption failed — returning ciphertext as-is. Possible keychain reset.'
    )
    return ciphertext
  }
}

export function decryptOptionalSecret(value: string | null | undefined): string | null {
  return value ? decrypt(value) : null
}

export function retireLegacyInstructionsForClearedTextActionRecipes(
  sourceControlAi: GlobalSettings['sourceControlAi'],
  previousSettings: GlobalSettings
): GlobalSettings['sourceControlAi'] {
  if (!sourceControlAi?.actions) {
    return sourceControlAi
  }

  const previousSourceControlAi = normalizeSourceControlAiSettings(
    previousSettings.sourceControlAi,
    previousSettings.commitMessageAi
  )
  let instructionsByOperation = sourceControlAi.instructionsByOperation
  let changed = false
  for (const actionId of SOURCE_CONTROL_TEXT_ACTION_IDS) {
    if (
      sourceControlAi.actions[actionId]?.commandInputTemplate !==
      DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES[actionId]
    ) {
      continue
    }
    if (
      previousSourceControlAi.actions?.[actionId]?.commandInputTemplate ===
        DEFAULT_SOURCE_CONTROL_ACTION_COMMAND_TEMPLATES[actionId] ||
      instructionsByOperation?.[actionId] !==
        previousSourceControlAi.instructionsByOperation[actionId]
    ) {
      continue
    }
    if (instructionsByOperation?.[actionId] === '') {
      continue
    }
    // Why: {basePrompt} is the explicit clear state; an empty instruction shadows rollback commitMessageAi.customPrompt on normalize/project.
    instructionsByOperation = { ...instructionsByOperation, [actionId]: '' }
    changed = true
  }

  return changed ? { ...sourceControlAi, instructionsByOperation } : sourceControlAi
}

// Why capture once (not a module const, not per-call): a const resolves before configureDevUserDataPath() redirects userData (dev/prod collide);
// per-call resolves after app.setName('Orca') flips path case and loses data on case-sensitive FS. index.ts calls initDataPath() at the right moment.
export let _dataFile: string | null = null
export let _userDataDir: string | null = null

export function initDataPath(): void {
  const userDataDir = app.getPath('userData')
  _userDataDir = userDataDir
  _dataFile = join(userDataDir, 'orca-data.json')
}

export function getDataFile(): string {
  if (!_dataFile) {
    // Safety fallback — should not be hit in normal startup.
    const userDataDir = app.getPath('userData')
    _userDataDir = userDataDir
    _dataFile = join(userDataDir, 'orca-data.json')
  }
  return _dataFile
}

// Why a sidecar: githubCache refreshes every poll and would rewrite the whole multi-MB orca-data.json each cycle.
// Snapshotted best-effort at quit for instant badges next launch; safe to lose.
export function getGithubCacheFile(dataFile = getDataFile()): string {
  return join(dirname(dataFile), 'orca-github-cache.json')
}

// Why: worktrees deleted outside Orca orphan their worktreeMeta, so the map grew monotonically (63% dead on a heavy install).
// GC stays narrow: local-host entries only (a local existsSync would falsely condemn SSH/WSL remote paths) and only after a 30-day idle grace.
export const WORKTREE_META_GC_GRACE_MS = 30 * 24 * 60 * 60 * 1000

export function gcStaleWorktreeMeta(state: PersistedState): number {
  // Why: a hand-corrupted "worktreeMeta": null overrides the defaults merge; normalize here instead of throwing.
  state.worktreeMeta ??= {}
  const repoById = new Map(state.repos.map((repo) => [repo.id, repo]))
  const projectIds = new Set((state.projects ?? []).map((project) => project.id))
  const now = Date.now()
  let removed = 0
  for (const key of Object.keys(state.worktreeMeta)) {
    // Why: folder-project workspace instances (keyed repoId::path::workspace:<uuid>) ARE the workspace record, not a checkout row; skip them.
    if (key.includes(FOLDER_WORKSPACE_INSTANCE_SEPARATOR)) {
      continue
    }
    const separator = key.indexOf('::')
    if (separator === -1) {
      continue
    }
    const ownerId = key.slice(0, separator)
    const worktreePath = key.slice(separator + 2)
    const meta = state.worktreeMeta[key]
    const repo = repoById.get(ownerId)
    if (repo) {
      if (repo.connectionId || getRepoExecutionHostId(repo) !== LOCAL_EXECUTION_HOST_ID) {
        continue
      }
    } else if (projectIds.has(ownerId)) {
      // Project-owned metas keep their own project/host lifecycle; leave them alone.
      continue
    }
    // Unowned entries (repo removed before metas were pruned) fall through to the same missing-path + idle-grace gate.
    if (meta?.hostId && meta.hostId !== LOCAL_EXECUTION_HOST_ID) {
      continue
    }
    if (!isAbsolute(worktreePath) || isWslUncPath(worktreePath)) {
      continue
    }
    // Why: WSL worktrees on Windows carry Linux-style paths that Windows existsSync can't probe and would falsely condemn.
    if (process.platform === 'win32' && !isWindowsAbsolutePathLike(worktreePath)) {
      continue
    }
    // Why keep timestamp-less entries: without timestamps we can't prove the 30-day grace elapsed (measured dead entries all had them).
    // Grace is checked before existsSync so active entries skip the stat fan-out (and its slow-NFS tail).
    const newestTouch = Math.max(meta?.lastActivityAt ?? 0, meta?.createdAt ?? 0)
    if (newestTouch === 0 || now - newestTouch < WORKTREE_META_GC_GRACE_MS) {
      continue
    }
    if (existsSync(worktreePath)) {
      continue
    }
    delete state.worktreeMeta[key]
    delete state.worktreeLineageById[key]
    delete state.workspaceLineageByChildKey[worktreeWorkspaceKey(key)]
    removed++
  }
  return removed
}

export function normalizeWorktreeLinkedItemMetadata(state: PersistedState): boolean {
  let changed = false
  const rawWorktreeMeta = state.worktreeMeta as unknown
  if (
    typeof rawWorktreeMeta !== 'object' ||
    rawWorktreeMeta === null ||
    Array.isArray(rawWorktreeMeta)
  ) {
    state.worktreeMeta = {}
    changed = rawWorktreeMeta !== undefined
  }
  for (const [key, meta] of Object.entries(state.worktreeMeta)) {
    // Why: hand-corrupted non-object entries are a real input class; drop them here because gcStaleWorktreeMeta
    // keeps timestamp-less keys forever and every downstream consumer trusts the Record<string, WorktreeMeta> type.
    if (typeof meta !== 'object' || meta === null || Array.isArray(meta)) {
      delete state.worktreeMeta[key]
      // Companions go with it, matching gcStaleWorktreeMeta/removeWorktreeMeta; a stranded lineage row would
      // otherwise re-attach to a worktree recreated at the same repoId::path.
      delete state.worktreeLineageById[key]
      delete state.workspaceLineageByChildKey[worktreeWorkspaceKey(key)]
      changed = true
      continue
    }
    const linkedWorkItem = normalizeWorkspaceLinkedItem(meta.linkedWorkItem)
    const sourceContext = normalizeStoredTaskSourceContext(meta.linkedTaskSourceContext)
    const linkedTaskSourceContext = isWorkspaceLinkedItemSourceContextMatch(
      linkedWorkItem,
      sourceContext
    )
      ? sourceContext
      : null
    if (!areWorkspaceLinkedItemsEqual(meta.linkedWorkItem, linkedWorkItem)) {
      meta.linkedWorkItem = linkedWorkItem
      changed = true
    }
    if (!areTaskSourceContextsEqual(meta.linkedTaskSourceContext, linkedTaskSourceContext)) {
      meta.linkedTaskSourceContext = linkedTaskSourceContext
      changed = true
    }
  }
  return changed
}

export function readGithubCacheSnapshot(dataFile: string): PersistedState['githubCache'] | null {
  try {
    const parsed = JSON.parse(readFileSync(getGithubCacheFile(dataFile), 'utf-8')) as unknown
    const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
      typeof value === 'object' && value !== null && !Array.isArray(value)
    if (
      isPlainRecord(parsed) &&
      isPlainRecord((parsed as { pr?: unknown }).pr) &&
      isPlainRecord((parsed as { issue?: unknown }).issue)
    ) {
      return parsed as PersistedState['githubCache']
    }
  } catch {
    // Missing or corrupt snapshot: start with an empty cache and refetch.
  }
  return null
}

/**
 * Return the userData directory captured at initDataPath() time, before app.setName() can change how app.getPath('userData') resolves.
 *
 * Subsystems sharing storage with orca-data.json read this instead of resolving late, which on case-sensitive FS can lose paired devices.
 */
export function getCanonicalUserDataPath(): string {
  if (!_userDataDir) {
    // Safety fallback — should not be hit in normal startup.
    _userDataDir = app.getPath('userData')
  }
  return _userDataDir
}

/**
 * Copy legacy mobile pairing credentials into the canonical userData directory.
 *
 * Copies the registry and E2EE keypair forward as a pair so an update doesn't force a re-pair or mix devices with the wrong key.
 */
export function migrateMobilePairingDataToCanonicalUserDataPath(sourceUserDataDir: string): void {
  const targetUserDataDir = getCanonicalUserDataPath()
  if (resolve(sourceUserDataDir) === resolve(targetUserDataDir)) {
    return
  }

  const migrations = MOBILE_PAIRING_USERDATA_FILES.map((fileName) => ({
    sourcePath: join(sourceUserDataDir, fileName),
    targetPath: join(targetUserDataDir, fileName)
  }))
  if (migrations.some(({ sourcePath }) => !existsSync(sourcePath))) {
    return
  }
  if (migrations.some(({ targetPath }) => existsSync(targetPath))) {
    return
  }

  mkdirSync(targetUserDataDir, { recursive: true })
  for (const { sourcePath, targetPath } of migrations) {
    copyFileSync(sourcePath, targetPath)
    // Why: copyFileSync drops Windows ACLs, so re-assert current-user-only on these credential copies (device tokens, E2EE key).
    hardenExistingSecureFile(targetPath)
  }
}

// Why (issue #1158): keep 5 rolling backups at >=1h spacing so a corrupt/empty write leaves an earlier copy recoverable.
export const BACKUP_COUNT = 5
export const BACKUP_MIN_INTERVAL_MS = 60 * 60 * 1000
export const WORKSPACE_SESSION_PATCH_FULL_NORMALIZATION_KEYS = new Set<keyof WorkspaceSessionState>([
  'tabsByWorktree',
  'terminalLayoutsByTabId'
])

export function logPersistenceStartupMilestone(
  event: string,
  details: Record<string, unknown> = {}
): void {
  if (isStartupDiagnosticsEnabled()) {
    logStartupDiagnostic(event, { t: Math.round(performance.now()), ...details })
  }
}

export function workspaceSessionPatchNeedsFullNormalization(patch: WorkspaceSessionPatch): boolean {
  return Object.keys(patch).some((key) =>
    WORKSPACE_SESSION_PATCH_FULL_NORMALIZATION_KEYS.has(key as keyof WorkspaceSessionState)
  )
}

/** Normalize non-'local' host partitions; 'local' (the legacy workspaceSession blob) is dropped so the two surfaces never diverge.
 *  Each partition is zod-validated independently, so one corrupt host drops to defaults without taking out the others. Idempotent. */
