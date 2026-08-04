import {
  existsSync,
  homedir,
  BACKUP_COUNT,
  backupPath,
  logPersistenceStartupMilestone,
  projectHostSetupCompatibilityStateEqual,
  mergeProjectHostSetupCompatibilityState,
  normalizeWorktreeLinkedItemMetadata,
  gcStaleWorktreeMeta,
  readGithubCacheSnapshot,
  getDefaultPersistedState,
  pruneLocalTerminalScrollbackBuffers,
  pruneWorkspaceSessionBrowserHistory,
  migrateWorkspaceSessionTerminalScrollbackSnapshots,
  backfillFolderScopeConnectionIds,
  clearMissingProjectGroupMemberships
} from './persistence-store-repository-load-api'

export function finalizeLoadedRepositoryState(
  context: any,
  result: any | null,
  fileExistedOnLoad: boolean,
  allowBackupRecovery: boolean
): any {
  const dataFile = context.dataFile
  if (result === null && allowBackupRecovery) {
    let hasBackup = false
    for (let i = 0; i < BACKUP_COUNT; i++) {
      if (existsSync(backupPath(dataFile, i))) {
        hasBackup = true
        break
      }
    }
    if (fileExistedOnLoad || hasBackup) {
      if (context.restoreFromBackup(dataFile)) {
        return context.load(false)
      }
      console.error('[persistence] No usable state file or backup found, using defaults')
    }
  }

  if (result === null) {
    result = getDefaultPersistedState(homedir())
  }

  const workspaceSession = pruneWorkspaceSessionBrowserHistory(
    pruneLocalTerminalScrollbackBuffers(result.workspaceSession, result.repos)
  )
  const migratedScrollback = migrateWorkspaceSessionTerminalScrollbackSnapshots(
    workspaceSession,
    context.terminalScrollbackSnapshotStorage
  )
  if (migratedScrollback.changed) {
    context.loadNeedsSave = true
  }

  const repos = clearMissingProjectGroupMemberships(result.repos, result.projectGroups ?? [])
  const projectHostSetupCompatibility = mergeProjectHostSetupCompatibilityState(result, repos)
  if (!projectHostSetupCompatibilityStateEqual(result, projectHostSetupCompatibility)) {
    context.loadNeedsSave = true
  }

  const folderScopeConnectionMigration = backfillFolderScopeConnectionIds({
    ...result,
    repos,
    ...projectHostSetupCompatibility,
    workspaceSession: migratedScrollback.session
  })
  if (folderScopeConnectionMigration.changed) {
    context.loadNeedsSave = true
  }
  result = folderScopeConnectionMigration.state

  if (normalizeWorktreeLinkedItemMetadata(result)) {
    context.loadNeedsSave = true
  }

  if (gcStaleWorktreeMeta(result) > 0) {
    context.loadNeedsSave = true
  }

  const migrated = context.migrateTabSwitchKeybindings(
    context.migrateTelemetry(result, fileExistedOnLoad),
    fileExistedOnLoad
  )

  const legacyCache = migrated.githubCache
  const hasLegacyCache =
    Object.keys(legacyCache?.pr ?? {}).length > 0 ||
    Object.keys(legacyCache?.issue ?? {}).length > 0
  if (hasLegacyCache) {
    context.loadNeedsSave = true
    context.githubCacheDirty = true
  } else {
    migrated.githubCache = readGithubCacheSnapshot(context.dataFile) ?? migrated.githubCache
  }

  logPersistenceStartupMilestone('persistence-load-done', {
    repos: migrated.repos.length,
    workspaceSessionBytes: Buffer.byteLength(JSON.stringify(migrated.workspaceSession))
  })
  return migrated
}
