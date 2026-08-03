import type { PersistedState } from '../shared/types'
import { getDefaultUIState } from '../shared/constants'

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
  normalizeSortBy } from './persistence-state-paths-foundation'

export function normalizeProjectOrderBy(projectOrderBy: unknown): PersistedState['ui']['projectOrderBy'] {
  if (projectOrderBy === 'manual' || projectOrderBy === 'recent') {
    return projectOrderBy
  }
  return getDefaultUIState().projectOrderBy
}
