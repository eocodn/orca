import type {
  Repo,
  WorkspaceKey
} from '../shared/types'


import {
  removeRepoFromHostWorkspaceSessions,
  removeRepoFromWorkspaceSession
} from './orca-profiles/profile-project-session-state'
import {
  getRepoExecutionHostId,
  parseExecutionHostId,
  LOCAL_EXECUTION_HOST_ID,
  type ExecutionHostId
} from '../shared/execution-host'
import { isLegacyRepoForExternalWorktreeVisibility } from '../shared/worktree-ownership'
import {
  normalizeRepoSourceControlAiOverrides
} from '../shared/source-control-ai'
import {
  parseWorkspaceKey
} from '../shared/workspace-scope'

import {
  removeWorkspaceSessionOwners
} from './persistence-state-phase-8'
import { sanitizeRepoUpdatesForPersistence } from './persistence-state-automation'
import { StorePhase4 } from './persistence-store-settings-state'

export class StorePhase5 extends StorePhase4 {
  reorderReposForHost(orderedIds: string[], hostId: ExecutionHostId): boolean {
    const current = this.state.repos
    const hostRepos = current.filter((repo) => getRepoExecutionHostId(repo) === hostId)
    if (orderedIds.length !== hostRepos.length) {
      return false
    }
    const byId = new Map(hostRepos.map((repo) => [repo.id, repo]))
    if (byId.size !== hostRepos.length) {
      return false
    }
    const seen = new Set<string>()
    const reorderedHostRepos: Repo[] = []
    for (const id of orderedIds) {
      const repo = typeof id === 'string' && !seen.has(id) ? byId.get(id) : undefined
      if (!repo) {
        return false
      }
      seen.add(id)
      reorderedHostRepos.push(repo)
    }
    let nextHostIndex = 0
    this.state.repos = current.map((repo) =>
      getRepoExecutionHostId(repo) === hostId ? reorderedHostRepos[nextHostIndex++] : repo
    )
    this.syncProjectHostSetupCompatibilityState()
    this.scheduleSave()
    return true
  }

  removeProject(id: string): void {
    this.state.repos = this.state.repos.filter((r) => r.id !== id)
    this.syncProjectHostSetupCompatibilityState()
    // Why: presets are repo-scoped and unreachable once the repo is gone, so drop them with it.
    delete this.state.sparsePresetsByRepo[id]
    this.pruneWorktreeStateForRepo(id, null)
    this.state.workspaceSession = removeRepoFromWorkspaceSession(this.state.workspaceSession, id)
    this.state.workspaceSessionsByHostId = removeRepoFromHostWorkspaceSessions(
      this.state.workspaceSessionsByHostId,
      id
    )
    this.scheduleSave()
  }

  // Why: the same repo id can exist on multiple execution hosts; remove only this host's row and metadata, never another host's.
  removeProjectForHost(id: string, hostId: ExecutionHostId): void {
    this.state.repos = this.state.repos.filter(
      (r) => !(r.id === id && getRepoExecutionHostId(r) === hostId)
    )
    const idStillPresent = this.state.repos.some((r) => r.id === id)
    // Why: presets are repo-id-scoped (not host-scoped); drop them only when the last host's copy is gone.
    if (!idStillPresent) {
      delete this.state.sparsePresetsByRepo[id]
    }
    this.syncProjectHostSetupCompatibilityState()
    // Why: prune only this host's worktree metas if the id survives elsewhere; otherwise prune everything (matches removeProject).
    this.pruneWorktreeStateForRepo(id, idStillPresent ? hostId : null)
    if (!idStillPresent) {
      this.state.workspaceSession = removeRepoFromWorkspaceSession(this.state.workspaceSession, id)
      this.state.workspaceSessionsByHostId = removeRepoFromHostWorkspaceSessions(
        this.state.workspaceSessionsByHostId,
        id
      )
    } else if (parseExecutionHostId(hostId)?.kind === 'runtime') {
      const session = this.state.workspaceSessionsByHostId?.[hostId]
      if (session) {
        this.state.workspaceSessionsByHostId = {
          ...this.state.workspaceSessionsByHostId,
          [hostId]: removeRepoFromWorkspaceSession(session, id)
        }
      }
    }
    this.scheduleSave()
  }

  // Prune worktree meta/lineage for a repo id; hostId null prunes all entries, else only that host's (missing meta.hostId = local).
  protected pruneWorktreeStateForRepo(id: string, hostId: ExecutionHostId | null): void {
    const prefix = `${id}::`
    // Why snapshot up front: the first loop deletes metas, so reading meta.hostId live later would misclassify an SSH worktree as local.
    const hostMembership = new Map<string, boolean>()
    const belongsToHost = (key: string): boolean => {
      if (!key.startsWith(prefix)) {
        return false
      }
      if (hostId === null) {
        return true
      }
      const cached = hostMembership.get(key)
      if (cached !== undefined) {
        return cached
      }
      // Why default to local: metas without hostId predate host stamping, so a host-scoped prune skips them rather than risk deleting another host's live meta.
      const metaHostId = this.state.worktreeMeta[key]?.hostId ?? LOCAL_EXECUTION_HOST_ID
      const result = metaHostId === hostId
      hostMembership.set(key, result)
      return result
    }
    // Why: session state (legacy blob + per-host partitions) references worktrees
    // by the same `${repoId}::${path}` owner key; if it is not pruned here, a
    // deleted project's worktrees stay in lastVisitedAtByWorktreeId /
    // sleepingAgentSessionsByPaneKey and get re-materialized into worktreeMeta on
    // the next launch, surfacing as an orphaned "unknown" workspace.
    // worktreeMeta is host-classified via belongsToHost, but session partitions
    // are keyed by host directly. A session owner key carries no host, and the
    // same key can exist in multiple partitions (shared repo id/path across
    // hosts). So for session cleanup we collect every prefix-matching owner key
    // regardless of belongsToHost, and let the per-partition host gating below
    // decide which partition to touch. (belongsToHost still governs
    // worktreeMeta/lineage deletion. Collect before deleting worktreeMeta.)
    const ownerKeysToPrune = new Set<string>()
    const collectPrefixedKeys = (keys: Iterable<string>): void => {
      for (const key of keys) {
        if (key.startsWith(prefix)) {
          ownerKeysToPrune.add(key)
        }
      }
    }
    collectPrefixedKeys(Object.keys(this.state.worktreeMeta))
    collectPrefixedKeys(Object.keys(this.state.workspaceSession?.lastVisitedAtByWorktreeId ?? {}))
    for (const session of Object.values(this.state.workspaceSessionsByHostId ?? {})) {
      collectPrefixedKeys(Object.keys(session?.lastVisitedAtByWorktreeId ?? {}))
    }

    for (const key of Object.keys(this.state.worktreeMeta)) {
      if (belongsToHost(key)) {
        delete this.state.worktreeMeta[key]
      }
    }
    // Why: owner keys are `${repoId}::${path}` and do not carry a host, so a
    // host-scoped prune (hostId != null) must only touch that host's session:
    // the legacy blob is the local host's session, and each
    // workspaceSessionsByHostId partition is one non-local host. Pruning every
    // partition here would wipe a surviving host's tabs, sleeping-agent state,
    // and active-worktree pointer for a shared repo id/path. A full removal
    // (hostId === null) still clears every host.
    const pruneLegacyLocalSession = hostId === null || hostId === LOCAL_EXECUTION_HOST_ID
    const pruneAllHostPartitions = hostId === null
    if (pruneLegacyLocalSession) {
      this.state.workspaceSession = removeWorkspaceSessionOwners(
        this.state.workspaceSession,
        ownerKeysToPrune
      )!
    }
    if (this.state.workspaceSessionsByHostId) {
      for (const [partitionHostId, session] of Object.entries(
        this.state.workspaceSessionsByHostId
      )) {
        if (!pruneAllHostPartitions && partitionHostId !== hostId) {
          continue
        }
        const pruned = removeWorkspaceSessionOwners(session, ownerKeysToPrune)
        if (pruned) {
          this.state.workspaceSessionsByHostId[partitionHostId] = pruned
        }
      }
    }
    for (const [childId, lineage] of Object.entries(this.state.worktreeLineageById)) {
      if (belongsToHost(childId) || belongsToHost(lineage.parentWorktreeId)) {
        delete this.state.worktreeLineageById[childId]
      }
    }
    for (const [childKey, lineage] of Object.entries(this.state.workspaceLineageByChildKey)) {
      const childScope = parseWorkspaceKey(childKey)
      const parentScope = parseWorkspaceKey(lineage.parentWorkspaceKey)
      if (childScope?.type === 'worktree' && belongsToHost(childScope.worktreeId)) {
        delete this.state.workspaceLineageByChildKey[childKey as WorkspaceKey]
        continue
      }
      if (parentScope?.type === 'worktree' && belongsToHost(parentScope.worktreeId)) {
        delete this.state.workspaceLineageByChildKey[childKey as WorkspaceKey]
      }
    }
    this.pruneMobileClientTabSelections(belongsToHost)
  }

  protected pruneMobileClientTabSelections(matchesWorktreeId: (worktreeId: string) => boolean): void {
    for (const [clientNavigationId, selectionsByWorktree] of Object.entries(
      this.state.mobileClientTabSelectionsByDeviceId ?? {}
    )) {
      for (const worktreeId of Object.keys(selectionsByWorktree)) {
        if (matchesWorktreeId(worktreeId)) {
          delete selectionsByWorktree[worktreeId]
        }
      }
      if (Object.keys(selectionsByWorktree).length === 0) {
        delete this.state.mobileClientTabSelectionsByDeviceId?.[clientNavigationId]
      }
    }
  }

  updateRepo(
    id: string,
    updates: Partial<
      Pick<
        Repo,
        | 'displayName'
        | 'badgeColor'
        | 'repoIcon'
        | 'upstream'
        | 'gitRemoteIdentity'
        | 'hookSettings'
        | 'worktreeBaseRef'
        | 'worktreeBasePath'
        | 'kind'
        | 'executionHostId'
        | 'symlinkPaths'
        | 'issueSourcePreference'
        | 'forkSyncMode'
        | 'externalWorktreeVisibility'
        | 'externalWorktreeVisibilityPromptDismissedAt'
        | 'externalWorktreeInboxBaselinePaths'
        | 'importedExternalWorktreePaths'
        | 'projectGroupId'
        | 'projectGroupOrder'
        | 'projectHostSetupMethod'
      >
    > & {
      sourceControlAi?: Repo['sourceControlAi'] | null
      externalWorktreeDiscoverySuppressedAt?: Repo['externalWorktreeDiscoverySuppressedAt'] | null
    },
    hostId?: ExecutionHostId
  ): Repo | null {
    const repo = this.state.repos.find(
      (candidate) =>
        candidate.id === id && (!hostId || getRepoExecutionHostId(candidate) === hostId)
    )
    if (!repo) {
      return null
    }
    const sanitizedUpdates = sanitizeRepoUpdatesForPersistence(updates)
    if ('projectGroupId' in sanitizedUpdates) {
      const nextGroupId = sanitizedUpdates.projectGroupId
      if (
        typeof nextGroupId !== 'string' ||
        nextGroupId.trim().length === 0 ||
        !this.state.projectGroups.some((group) => group.id === nextGroupId)
      ) {
        sanitizedUpdates.projectGroupId = null
      }
    }
    if (
      'projectGroupOrder' in sanitizedUpdates &&
      (typeof sanitizedUpdates.projectGroupOrder !== 'number' ||
        !Number.isFinite(sanitizedUpdates.projectGroupOrder))
    ) {
      delete sanitizedUpdates.projectGroupOrder
    }
    const externalWorktreeVisibilityLegacy =
      'externalWorktreeVisibility' in sanitizedUpdates &&
      repo.externalWorktreeVisibilityLegacy === undefined
        ? isLegacyRepoForExternalWorktreeVisibility(repo)
        : undefined
    // Why: selected repo fields use `undefined` as an explicit clear signal, so delete them before assigning the patch.
    if (
      'issueSourcePreference' in sanitizedUpdates &&
      sanitizedUpdates.issueSourcePreference === undefined
    ) {
      delete repo.issueSourcePreference
      delete sanitizedUpdates.issueSourcePreference
    }
    if ('worktreeBasePath' in sanitizedUpdates && sanitizedUpdates.worktreeBasePath === undefined) {
      delete repo.worktreeBasePath
      delete sanitizedUpdates.worktreeBasePath
    }
    if (
      'externalWorktreeVisibility' in sanitizedUpdates &&
      repo.externalWorktreeVisibilityLegacy === undefined
    ) {
      // Why: old persisted repos have no marker; stamp it on first visibility change so later hide/show keeps legacy safety.
      repo.externalWorktreeVisibilityLegacy = externalWorktreeVisibilityLegacy
    }
    if (
      'externalWorktreeDiscoverySuppressedAt' in sanitizedUpdates &&
      (sanitizedUpdates.externalWorktreeDiscoverySuppressedAt === undefined ||
        sanitizedUpdates.externalWorktreeDiscoverySuppressedAt === null)
    ) {
      delete repo.externalWorktreeDiscoverySuppressedAt
      delete sanitizedUpdates.externalWorktreeDiscoverySuppressedAt
    }
    if (
      'sourceControlAi' in sanitizedUpdates &&
      (sanitizedUpdates.sourceControlAi === undefined || sanitizedUpdates.sourceControlAi === null)
    ) {
      delete repo.sourceControlAi
      delete sanitizedUpdates.sourceControlAi
    } else if ('sourceControlAi' in sanitizedUpdates) {
      const normalizedSourceControlAi = normalizeRepoSourceControlAiOverrides(
        sanitizedUpdates.sourceControlAi
      )
      if (normalizedSourceControlAi === undefined) {
        delete sanitizedUpdates.sourceControlAi
      } else {
        sanitizedUpdates.sourceControlAi = normalizedSourceControlAi
      }
    }
    Object.assign(repo, sanitizedUpdates)
    this.syncProjectHostSetupCompatibilityState()
    this.scheduleSave()
    return this.hydrateRepo(repo)
  }


}
