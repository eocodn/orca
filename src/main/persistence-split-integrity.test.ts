import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const readSource = (file: string): string => readFileSync(new URL(file, import.meta.url), 'utf8')

const importedNamesFrom = (source: string, modulePath: string): string => {
  const escapedModulePath = modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return (
    source.match(new RegExp(`import \\{([\\s\\S]*?)\\} from '${escapedModulePath}'`))?.[1] ?? ''
  )
}

describe('persistence split integrity', () => {
  it('keeps the loader dependency members available as module APIs', () => {
    const dependencies = readSource('./persistence-store-repository-load-dependencies.ts')
    const loaderApi = readSource('./persistence-store-repository-load-api.ts')
    const primaryLoader = readSource('./persistence-store-repository-load-primary-state.ts')
    const finalizationLoader = readSource('./persistence-store-repository-load-finalization.ts')
    const dependencyMembers =
      dependencies.match(/export const persistenceLoadDependencies = \{([\s\S]*?)\n\}/)?.[1] ?? ''

    for (const api of [
      'readFileSync',
      'decrypt',
      'normalizeLoadedOnboardingState',
      'logPersistenceStartupMilestone',
      'BACKUP_COUNT',
      'backupPath',
      'mergeProjectHostSetupCompatibilityState',
      'projectHostSetupCompatibilityStateEqual',
      'backfillLegacyAutomationContexts',
      'normalizeWorktreeLinkedItemMetadata',
      'gcStaleWorktreeMeta',
      'readGithubCacheSnapshot'
    ]) {
      expect(loaderApi).toMatch(
        new RegExp('export const \\{[\\s\\S]*\\b' + api + '\\b[\\s\\S]*\\}')
      )
      expect(dependencyMembers).toMatch(new RegExp('\\b' + api + '\\b'))
    }
    expect(dependencies).toMatch(/export const persistenceLoadDependencies/)
    expect(primaryLoader).toMatch(/loadDependencies\.readFileSync/)
    expect(finalizationLoader).toMatch(/from '\.\/persistence-store-repository-load-api'/)

    const finalizationApiImports = importedNamesFrom(
      finalizationLoader,
      './persistence-store-repository-load-api'
    )
    for (const binding of [
      'mergeProjectHostSetupCompatibilityState',
      'projectHostSetupCompatibilityStateEqual',
      'backfillLegacyAutomationContexts',
      'normalizeWorktreeLinkedItemMetadata',
      'gcStaleWorktreeMeta',
      'readGithubCacheSnapshot'
    ]) {
      expect(finalizationApiImports).toMatch(new RegExp('\\b' + binding + '\\b'))
    }
  })

  it('routes primary-state migrations through the load API facade', () => {
    const loaderApi = readSource('./persistence-store-repository-load-api.ts')
    const primaryLoader = readSource('./persistence-store-repository-load-primary-state.ts')
    const bindings = [
      'logPersistenceStartupMilestone',
      'decrypt',
      'decryptOptionalSecret',
      'migrateTerminalScrollbackRows',
      'migrateTerminalTuiScrollSensitivityDefault',
      'normalizeFloatingWorkspaceTrustedCwds',
      'canonicalizePersistedFloatingWorkspaceDirectory',
      'migrateAgentYoloDefaults',
      'normalizeLoadedOnboardingState',
      'normalizeWorkspaceLineageByChildKey',
      'readLegacySidekickFlag',
      'normalizeNotificationSettings',
      'normalizeSortBy',
      'readDeprecatedExperimentFlag',
      'resolveSetupGuideSidebarDismissedOnLoad',
      'normalizeRightSidebarTab',
      'normalizeShowDotfilesByWorktree',
      'parseWorkspaceSessionsByHostId',
      'normalizeSshTarget',
      'normalizeSshRemotePtyLease',
      'normalizeClaudeLivePtySessionIds',
      'normalizeMigrationUnsupportedPtyEntries',
      'normalizeLegacyPaneKeyAliasEntries'
    ]

    const primaryApiImports = importedNamesFrom(
      primaryLoader,
      './persistence-store-repository-load-api'
    )
    for (const binding of bindings) {
      expect(loaderApi).toMatch(new RegExp(`\\b${binding}\\b`))
      expect(primaryApiImports).toMatch(new RegExp(`\\b${binding}\\b`))
    }
  })

  it('keeps StoreFoundation backup and pane-migration bindings imported', () => {
    const foundation = readSource('./persistence-store-foundation.ts')

    const stateFoundationImports = importedNamesFrom(
      foundation,
      './persistence-state-foundation'
    )
    for (const binding of ['BACKUP_COUNT', 'BACKUP_MIN_INTERVAL_MS']) {
      expect(stateFoundationImports).toMatch(new RegExp('\\b' + binding + '\\b'))
    }

    const statePathImports = importedNamesFrom(
      foundation,
      './persistence-state-paths-foundation'
    )
    expect(statePathImports).toMatch(/\bbackupPath\b/)

    const statePhaseImports = importedNamesFrom(foundation, './persistence-state-phase-8')
    expect(statePhaseImports).toMatch(/\bregisterPersistedPaneKeyAlias\b/)

    const sessionMigrationImports = importedNamesFrom(
      foundation,
      './persistence-state-session-migration'
    )
    expect(sessionMigrationImports).toMatch(/\bnormalizePersistedPaneIdentityState\b/)
  })

  it('does not bind a phase superclass twice after the split', () => {
    const phaseFiles = [
      'persistence-store-automation-state.ts',
      'persistence-store-project-state.ts',
      'persistence-store-settings-state.ts',
      'persistence-store-session-state.ts',
      'persistence-store-pty-state.ts',
      'persistence-store-ssh-state.ts',
      'persistence-store-write-lifecycle.ts',
      'persistence-store-state-phase-9.ts',
      'persistence-store-state-phase-10.ts',
      'persistence-store-state-phase-11.ts',
      'persistence-store-state-phase-12.ts',
      'persistence-store-state-phase-13.ts',
      'persistence-store-state-phase-14.ts'
    ]

    for (const file of phaseFiles) {
      const imports = readSource(`./${file}`).match(/^import \{ StorePhase\d+ \} from .+$/gm) ?? []
      expect(imports, file).toHaveLength(1)
    }
  })
})
