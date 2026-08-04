import type {
  ProjectHostSetup,
  ProjectHostSetupUpdateArgs,
  Repo,
  SparsePreset,
  PersistedMobileClientTabSelections
} from '../shared/types'


import { isFolderRepo } from '../shared/repo-kind'
import {
  getDefaultRepoHookSettings
} from '../shared/constants'
import { sanitizeRepoIcon } from '../shared/repo-icon'
import {
  normalizeRepoSourceControlAiOverrides
} from '../shared/source-control-ai'

import {
  mergeProjectHostSetupCompatibilityState
} from './persistence-state-ssh'
import {
  sanitizeGitRemoteIdentity,
  sanitizeForkSyncMode,
  sanitizeRepoProjectHostSetupMethod,
  sanitizeRepoUpstream
} from './persistence-state-repo-sanitization'
import type { Store } from './persistence'
import { StorePhase5 } from './persistence-store-session-state'

export class StorePhase6 extends StorePhase5 {
  protected syncProjectHostSetupCompatibilityState(): void {
    const compatibilityState = mergeProjectHostSetupCompatibilityState(this.state, this.state.repos)
    this.state.projects = compatibilityState.projects
    this.state.projectHostSetups = compatibilityState.projectHostSetups
  }

  protected updateRepoBackedProjectHostSetup(
    setup: ProjectHostSetup,
    repo: Repo,
    updates: ProjectHostSetupUpdateArgs['updates']
  ): { setup: ProjectHostSetup; repo: Repo } | null {
    if (updates.path !== undefined && updates.path !== repo.path) {
      throw new Error(
        'Repo-backed project host setup paths must be changed by re-importing the project.'
      )
    }
    if (updates.setupState !== undefined && updates.setupState !== 'ready') {
      throw new Error('Repo-backed project host setups cannot be marked unavailable.')
    }
    const repoUpdates: Parameters<Store['updateRepo']>[1] = {}
    if (updates.displayName !== undefined) {
      repoUpdates.displayName = updates.displayName
    }
    if (updates.worktreeBasePath !== undefined) {
      repoUpdates.worktreeBasePath = updates.worktreeBasePath
    }
    if (updates.kind !== undefined) {
      repoUpdates.kind = updates.kind
    }
    if (updates.setupMethod === 'provisioned') {
      throw new Error('Repo-backed project host setups cannot be marked provisioned.')
    }
    if (updates.setupMethod !== undefined && updates.setupMethod !== 'legacy-repo') {
      repoUpdates.projectHostSetupMethod = updates.setupMethod
    }
    const updatedRepo =
      Object.keys(repoUpdates).length > 0 ? this.updateRepo(repo.id, repoUpdates) : repo
    if (!updatedRepo) {
      return null
    }
    return {
      setup: this.state.projectHostSetups.find((entry) => entry.id === setup.id) ?? setup,
      repo: updatedRepo
    }
  }

  protected updateIndependentProjectHostSetup(
    setup: ProjectHostSetup,
    updates: ProjectHostSetupUpdateArgs['updates']
  ): ProjectHostSetup {
    if (updates.displayName !== undefined) {
      setup.displayName = updates.displayName.trim() || setup.displayName
    }
    if (updates.path !== undefined) {
      setup.path = updates.path.trim() || setup.path
    }
    if (updates.worktreeBasePath !== undefined) {
      const worktreeBasePath = updates.worktreeBasePath.trim()
      if (worktreeBasePath) {
        setup.worktreeBasePath = worktreeBasePath
      } else {
        delete setup.worktreeBasePath
      }
    }
    if (updates.kind !== undefined) {
      setup.kind = updates.kind
    }
    if (updates.gitUsername !== undefined) {
      const gitUsername = updates.gitUsername.trim()
      if (gitUsername) {
        setup.gitUsername = gitUsername
      } else {
        delete setup.gitUsername
      }
    }
    if (updates.setupState !== undefined) {
      setup.setupState = updates.setupState
    }
    if (updates.setupMethod !== undefined) {
      setup.setupMethod = updates.setupMethod
    }
    setup.updatedAt = Date.now()
    this.scheduleSave()
    return setup
  }

  protected hydrateRepo(repo: Repo): Repo {
    const {
      repoIcon: rawRepoIcon,
      upstream: rawUpstream,
      gitRemoteIdentity: rawGitRemoteIdentity,
      sourceControlAi: rawSourceControlAi,
      projectHostSetupMethod: rawProjectHostSetupMethod,
      forkSyncMode: rawForkSyncMode,
      ...repoWithoutIcon
    } = repo
    const repoIcon = sanitizeRepoIcon(rawRepoIcon)
    const upstream = sanitizeRepoUpstream(rawUpstream)
    const gitRemoteIdentity = sanitizeGitRemoteIdentity(rawGitRemoteIdentity)
    const sourceControlAi = normalizeRepoSourceControlAiOverrides(rawSourceControlAi)
    const projectHostSetupMethod = sanitizeRepoProjectHostSetupMethod(rawProjectHostSetupMethod)
    const forkSyncMode = sanitizeForkSyncMode(rawForkSyncMode)
    // Why: never spawn git/gh username resolution in hydration — a stuck probe froze Windows startup for minutes (issue #7225); read only cache/persisted value.
    const gitUsername = isFolderRepo(repo)
      ? ''
      : (this.gitUsernameCache.get(repo.path) ?? repo.gitUsername ?? '')

    return {
      ...repoWithoutIcon,
      ...(repoIcon !== undefined ? { repoIcon } : {}),
      ...(upstream !== undefined ? { upstream } : {}),
      ...(gitRemoteIdentity !== undefined ? { gitRemoteIdentity } : {}),
      ...(sourceControlAi !== undefined ? { sourceControlAi } : {}),
      ...(projectHostSetupMethod !== undefined ? { projectHostSetupMethod } : {}),
      ...(forkSyncMode !== undefined ? { forkSyncMode } : {}),
      kind: isFolderRepo(repo) ? 'folder' : 'git',
      gitUsername,
      hookSettings: {
        ...getDefaultRepoHookSettings(),
        ...repo.hookSettings,
        scripts: {
          ...getDefaultRepoHookSettings().scripts,
          ...repo.hookSettings?.scripts
        }
      }
    }
  }

  // ── Sparse Presets ─────────────────────────────────────────────────

  // ── Mobile client tab selections ──────────────────────────────────

  getMobileClientTabSelections(): PersistedMobileClientTabSelections {
    return this.state.mobileClientTabSelectionsByDeviceId ?? {}
  }

  setMobileClientTabSelections(next: PersistedMobileClientTabSelections): void {
    this.state.mobileClientTabSelectionsByDeviceId = next
    this.scheduleSave()
  }

  getSparsePresets(repoId: string): SparsePreset[] {
    return [...(this.state.sparsePresetsByRepo[repoId] ?? [])].sort((left, right) =>
      left.name.localeCompare(right.name)
    )
  }

  saveSparsePreset(preset: SparsePreset): SparsePreset {
    const existing = this.state.sparsePresetsByRepo[preset.repoId] ?? []
    const index = existing.findIndex((entry) => entry.id === preset.id)
    this.state.sparsePresetsByRepo[preset.repoId] =
      index === -1
        ? [...existing, preset]
        : existing.map((entry, i) => (i === index ? preset : entry))
    this.scheduleSave()
    return preset
  }

  removeSparsePreset(repoId: string, presetId: string): void {
    const existing = this.state.sparsePresetsByRepo[repoId] ?? []
    this.state.sparsePresetsByRepo[repoId] = existing.filter((entry) => entry.id !== presetId)
    this.scheduleSave()
  }

}
