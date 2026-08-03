import type {
  ProjectHostSetup,
  WorkspaceSessionState
} from '../shared/types'


import type { SshRemotePtyLease } from '../shared/ssh-types'
import {
  toSshExecutionHostId
} from '../shared/execution-host'
import {
  migrateUiHostScopeSshTargetId,
  migrateWorkspaceSessionSshTargetId
} from './ssh/ssh-target-id-migration'
import {
  isTerminalLeafId
} from '../shared/stable-pane-id'

import { StorePhase12 } from './persistence-store-state-phase-12'

export class StorePhase13 extends StorePhase12 {
  reassignSshTargetId(oldTargetId: string, newTargetId: string): string[] {
    if (oldTargetId === newTargetId) {
      return []
    }
    const oldHostId = toSshExecutionHostId(oldTargetId)
    const newHostId = toSshExecutionHostId(newTargetId)
    const repoIds = new Set<string>()
    for (const repo of this.state.repos) {
      const matchesConnection = repo.connectionId === oldTargetId
      const matchesHost = repo.executionHostId === oldHostId
      if (!matchesConnection && !matchesHost) {
        continue
      }
      if (matchesConnection) {
        repo.connectionId = newTargetId
      }
      // Why: don't stamp executionHostId where it was unset — addRemoteRepoFromPath repos derive the host from connectionId.
      if (matchesHost) {
        repo.executionHostId = newHostId
      }
      repoIds.add(repo.id)
    }
    // Re-point worktree metas whose hostId pointed at the old SSH host.
    let metaChanged = false
    for (const meta of Object.values(this.state.worktreeMeta)) {
      if (meta.hostId === oldHostId) {
        meta.hostId = newHostId
        metaChanged = true
      }
    }
    // Why: any carrier still holding the old id later throws `SSH target not found` (STA-1468); migrate them all.
    let carrierChanged = migrateWorkspaceSessionSshTargetId(
      this.state.workspaceSession,
      oldTargetId,
      newTargetId
    )
    for (const session of Object.values(this.state.workspaceSessionsByHostId ?? {})) {
      if (session && migrateWorkspaceSessionSshTargetId(session, oldTargetId, newTargetId)) {
        carrierChanged = true
      }
    }
    // Why: partitions are read by host id; re-key from the removed id to the new one (keep new if it already exists).
    const partitions = this.state.workspaceSessionsByHostId
    const oldPartition = partitions?.[oldHostId]
    if (partitions && oldPartition) {
      delete partitions[oldHostId]
      partitions[newHostId] ??= oldPartition
      carrierChanged = true
    }
    if (migrateUiHostScopeSshTargetId(this.state.ui, oldTargetId, newTargetId)) {
      carrierChanged = true
    }
    for (const lease of this.state.sshRemotePtyLeases ?? []) {
      if (lease.targetId === oldTargetId) {
        lease.targetId = newTargetId
        carrierChanged = true
      }
    }
    let setupsChanged = false
    const keptSetups: ProjectHostSetup[] = []
    for (const setup of this.state.projectHostSetups) {
      if (setup.hostId !== oldHostId) {
        keptSetups.push(setup)
        continue
      }
      const duplicate = this.state.projectHostSetups.some(
        (entry) =>
          entry !== setup && entry.projectId === setup.projectId && entry.hostId === newHostId
      )
      // Why: drop the old ghost row that would violate (projectId, hostId) uniqueness with the re-added host's setup.
      if (duplicate) {
        setupsChanged = true
        continue
      }
      setup.hostId = newHostId
      setup.updatedAt = Date.now()
      keptSetups.push(setup)
      setupsChanged = true
    }
    if (setupsChanged) {
      this.state.projectHostSetups = keptSetups
    }
    // Why: repo-row and host-setup rewrites affect host-setup compatibility; meta-only rewrites don't, so gate the sync here.
    if (repoIds.size > 0 || setupsChanged) {
      this.syncProjectHostSetupCompatibilityState()
    }
    if (repoIds.size > 0 || metaChanged || carrierChanged || setupsChanged) {
      this.scheduleSave()
    }
    return [...repoIds]
  }

  // ── SSH Remote PTY Leases ──────────────────────────────────────────

  getSshRemotePtyLeases(targetId?: string): SshRemotePtyLease[] {
    const leases = this.state.sshRemotePtyLeases ?? []
    return leases.filter((lease) => targetId === undefined || lease.targetId === targetId)
  }

  upsertSshRemotePtyLease(
    lease: Omit<SshRemotePtyLease, 'createdAt' | 'updatedAt'> &
      Partial<Pick<SshRemotePtyLease, 'createdAt' | 'updatedAt'>>
  ): void {
    this.state.sshRemotePtyLeases ??= []
    const normalizedLease = { ...lease }
    if (normalizedLease.leafId !== undefined && !isTerminalLeafId(normalizedLease.leafId)) {
      delete normalizedLease.leafId
    }
    // Why: store target-local pty ids in leases so reconnect can call relay pty.attach with raw ids (app ids are global).
    normalizedLease.ptyId = this.getRelayPtyIdForSshLeaseStorage(
      normalizedLease.targetId,
      normalizedLease.ptyId
    )
    const now = Date.now()
    const existingIndex = this.state.sshRemotePtyLeases.findIndex(
      (entry) =>
        entry.targetId === normalizedLease.targetId && entry.ptyId === normalizedLease.ptyId
    )
    const existing = existingIndex >= 0 ? this.state.sshRemotePtyLeases[existingIndex] : undefined
    const next: SshRemotePtyLease = {
      ...existing,
      ...normalizedLease,
      createdAt: existing?.createdAt ?? normalizedLease.createdAt ?? now,
      updatedAt: normalizedLease.updatedAt ?? now
    }
    if (existingIndex >= 0) {
      this.state.sshRemotePtyLeases[existingIndex] = next
    } else {
      this.state.sshRemotePtyLeases.push(next)
    }
    this.flush()
  }

  markSshRemotePtyLeases(targetId: string, state: SshRemotePtyLease['state']): void {
    const now = Date.now()
    let changed = false
    const shouldClearBindings = state === 'terminated' || state === 'expired'
    const leasesToClear: SshRemotePtyLease[] = []
    this.state.sshRemotePtyLeases ??= []
    for (const lease of this.state.sshRemotePtyLeases) {
      if (lease.targetId !== targetId) {
        continue
      }
      if (state === 'detached' && lease.state !== 'attached') {
        continue
      }
      if (lease.state !== state) {
        lease.state = state
        lease.updatedAt = now
        if (state === 'attached') {
          lease.lastAttachedAt = now
        } else if (state === 'detached') {
          lease.lastDetachedAt = now
        }
        changed = true
      }
      if (shouldClearBindings) {
        leasesToClear.push(lease)
      }
    }
    const bindingsChanged = shouldClearBindings
      ? this.clearSshRemotePtyBindingsForLeases(targetId, leasesToClear)
      : false
    if (changed || bindingsChanged) {
      this.flush()
    }
  }

  markSshRemotePtyLease(targetId: string, ptyId: string, state: SshRemotePtyLease['state']): void {
    const relayPtyId = this.getRelayPtyIdForSshLeaseStorage(targetId, ptyId)
    const lease = this.state.sshRemotePtyLeases?.find(
      (entry) => entry.targetId === targetId && entry.ptyId === relayPtyId
    )
    if (!lease) {
      return
    }
    const shouldClearBindings = state === 'terminated' || state === 'expired'
    if (lease.state === state) {
      if (shouldClearBindings && this.clearSshRemotePtyBindingsForLeases(targetId, [lease])) {
        this.flush()
      }
      return
    }
    const now = Date.now()
    lease.state = state
    lease.updatedAt = now
    if (state === 'attached') {
      lease.lastAttachedAt = now
    } else if (state === 'detached') {
      lease.lastDetachedAt = now
    }
    if (shouldClearBindings) {
      this.clearSshRemotePtyBindingsForLeases(targetId, [lease])
    }
    this.flush()
  }

  removeSshRemotePtyLease(targetId: string, ptyId: string): void {
    const relayPtyId = this.getRelayPtyIdForSshLeaseStorage(targetId, ptyId)
    const leases = (this.state.sshRemotePtyLeases ?? []).filter(
      (lease) => lease.targetId === targetId && lease.ptyId === relayPtyId
    )
    const before = this.state.sshRemotePtyLeases?.length ?? 0
    this.clearSshRemotePtyBindingsForLeases(targetId, leases)
    this.state.sshRemotePtyLeases = (this.state.sshRemotePtyLeases ?? []).filter(
      (lease) => lease.targetId !== targetId || lease.ptyId !== relayPtyId
    )
    if (this.state.sshRemotePtyLeases.length !== before) {
      this.flush()
    }
  }

  removeSshRemotePtyLeases(targetId: string): void {
    this.state.sshRemotePtyLeases ??= []
    this.clearSshRemotePtyBindingsForTarget(targetId)
    const before = this.state.sshRemotePtyLeases.length
    this.state.sshRemotePtyLeases = this.state.sshRemotePtyLeases.filter(
      (lease) => lease.targetId !== targetId
    )
    if (this.state.sshRemotePtyLeases.length !== before) {
      this.flush()
    }
  }

  protected clearSshRemotePtyBindingsForTarget(targetId: string): void {
    const leases = this.state.sshRemotePtyLeases?.filter((lease) => lease.targetId === targetId)
    this.clearSshRemotePtyBindingsForLeases(targetId, leases ?? [])
  }

  protected clearSshRemotePtyBindingsForLeases(
    targetId: string,
    leases: SshRemotePtyLease[]
  ): boolean {
    if (!leases?.length) {
      return false
    }
    let changed = false
    const sessions = new Set(
      [
        this.state.workspaceSession,
        this.state.workspaceSessionsByHostId?.[toSshExecutionHostId(targetId)]
      ].filter((session): session is WorkspaceSessionState => Boolean(session))
    )
    for (const session of sessions) {
      for (const [worktreeId, tabs] of Object.entries(session.tabsByWorktree ?? {})) {
        for (const tab of tabs) {
          if (
            tab.ptyId &&
            leases.some((lease) =>
              this.sshRemotePtyLeaseMayReferenceBinding(lease, {
                ptyId: tab.ptyId!,
                worktreeId,
                targetId,
                tabId: tab.id
              })
            )
          ) {
            tab.ptyId = null
            changed = true
          }
        }
      }
      for (const [tabId, layout] of Object.entries(session.terminalLayoutsByTabId ?? {})) {
        const bindings = layout.ptyIdsByLeafId
        if (!bindings) {
          continue
        }
        const worktreeId = Object.entries(session.tabsByWorktree ?? {}).find(([, tabs]) =>
          tabs.some((tab) => tab.id === tabId)
        )?.[0]
        const nextBindings = Object.fromEntries(
          Object.entries(bindings).filter(
            ([leafId, ptyId]) =>
              !leases.some((lease) =>
                this.sshRemotePtyLeaseMayReferenceBinding(lease, {
                  ptyId,
                  targetId,
                  worktreeId,
                  tabId,
                  leafId
                })
              )
          )
        )
        if (Object.keys(nextBindings).length !== Object.keys(bindings).length) {
          layout.ptyIdsByLeafId = nextBindings
          changed = true
        }
      }
    }
    if (changed) {
      this.scheduleSave()
    }
    return changed
  }

  // ── Flush (for shutdown) ───────────────────────────────────────────


}
