import type {
  WorkspaceSessionState
} from '../shared/types'


import type { RemovedSshTargetTombstone, SshTarget } from '../shared/ssh-types'
import {
  LOCAL_EXECUTION_HOST_ID
} from '../shared/execution-host'
import {
  isTerminalLeafId
} from '../shared/stable-pane-id'
import {
  getRepoIdFromWorktreeId
} from '../shared/worktree-id'
import {
  cloneLayoutNode,
  layoutContainsLeafId
} from './persistence-layout-records'
import {
  cloneWorkspaceSessionState,
  createMinimalPersistedTerminalTab
} from './persistence-state-ssh'
import { normalizeSshTarget } from './persistence-state-ui-normalization'
import {
  MAX_CLAUDE_LIVE_PTY_SESSION_IDS,
  MAX_REMOVED_SSH_TARGET_TOMBSTONES
} from './persistence-state-session-migration'

import { StorePhase11 } from './persistence-store-state-phase-11'

export class StorePhase12 extends StorePhase11 {
  persistPtyBinding(
    args: {
      worktreeId: string
      tabId: string
      leafId: string
      ptyId: string
      incarnationId?: string
      startupCwd?: string
    },
    hostId?: string | null
  ): { rollbackIfCurrent: () => boolean } {
    const resolvedHostId = this.resolveHostId(hostId)
    const session = this.getWorkspaceSession(resolvedHostId)
    if (resolvedHostId !== LOCAL_EXECUTION_HOST_ID) {
      this.state.workspaceSessionsByHostId = {
        ...this.state.workspaceSessionsByHostId,
        [resolvedHostId]: session
      }
    }
    const sessionBeforeBinding = cloneWorkspaceSessionState(session)
    const paneKey = `${args.tabId}:${args.leafId}`
    let terminalMembershipChanged = false
    const advanceTopologyAfterMembershipChange = (): void => {
      const repoId = getRepoIdFromWorktreeId(args.worktreeId)
      const currentRevision = session.terminalTopologyRevisionByRepoId?.[repoId] ?? 0
      if (!terminalMembershipChanged || currentRevision <= 0) {
        return
      }
      // Why: a real host-admitted spawn after a retirement must be distinguishable from a stale renderer replay.
      session.terminalTopologyRevisionByRepoId = {
        ...session.terminalTopologyRevisionByRepoId,
        [repoId]: currentRevision + 1
      }
    }
    const assignSession = (value: WorkspaceSessionState): void => {
      if (resolvedHostId === LOCAL_EXECUTION_HOST_ID) {
        this.state.workspaceSession = value
      } else {
        this.state.workspaceSessionsByHostId = {
          ...this.state.workspaceSessionsByHostId,
          [resolvedHostId]: value
        }
      }
    }
    const restoreSession = (): void => assignSession(sessionBeforeBinding)
    const flushWithRollbackReceipt = (): { rollbackIfCurrent: () => boolean } => {
      try {
        this.flushOrThrow()
      } catch (err) {
        restoreSession()
        if (!this.writesFrozen) {
          this.scheduleSave()
        }
        throw err
      }
      const sessionAfterBinding = cloneWorkspaceSessionState(
        this.getWorkspaceSession(resolvedHostId)
      )
      const serializedAfterBinding = JSON.stringify(sessionAfterBinding)
      return Object.freeze({
        rollbackIfCurrent: (): boolean => {
          const current = cloneWorkspaceSessionState(this.getWorkspaceSession(resolvedHostId))
          if (JSON.stringify(current) !== serializedAfterBinding) {
            return false
          }
          assignSession(cloneWorkspaceSessionState(sessionBeforeBinding))
          try {
            this.flushOrThrow()
            return true
          } catch {
            // Why: keep memory on the pre-spawn state while the normal save queue retries the durable rollback.
            assignSession(sessionBeforeBinding)
            if (!this.writesFrozen) {
              this.scheduleSave()
            }
            return false
          }
        }
      })
    }
    if (args.incarnationId) {
      session.terminalPtyIncarnationsByPaneKey = {
        ...session.terminalPtyIncarnationsByPaneKey,
        [paneKey]: args.incarnationId
      }
      if (session.terminalSurfaceTombstonesByPaneKey?.[paneKey]) {
        session.terminalSurfaceTombstonesByPaneKey = {
          ...session.terminalSurfaceTombstonesByPaneKey
        }
        delete session.terminalSurfaceTombstonesByPaneKey[paneKey]
      }
    }
    const tabs = session.tabsByWorktree?.[args.worktreeId]
    const tab = tabs?.find((t) => t.id === args.tabId)
    if (tab) {
      tab.ptyId = args.ptyId
    } else {
      terminalMembershipChanged = true
      // Why: pty:spawn can beat the debounced writer; persist a minimal tab so hydration won't prune the binding as orphaned.
      const nextTabs = [
        ...(tabs ?? []),
        createMinimalPersistedTerminalTab({
          ...args,
          existingTabCount: tabs?.length ?? 0
        })
      ]
      session.tabsByWorktree = {
        ...session.tabsByWorktree,
        [args.worktreeId]: nextTabs
      }
      session.activeWorktreeId ??= args.worktreeId
      session.activeTabId ??= args.tabId
      session.activeTabIdByWorktree = {
        ...session.activeTabIdByWorktree,
        [args.worktreeId]: session.activeTabIdByWorktree?.[args.worktreeId] ?? args.tabId
      }
    }
    if (!isTerminalLeafId(args.leafId)) {
      // Why: keep legacy renderer-local pane ids out of durable leaf-keyed layout state after the UUID migration.
      advanceTopologyAfterMembershipChange()
      return flushWithRollbackReceipt()
    }
    const layout = session.terminalLayoutsByTabId?.[args.tabId]
    if (layout) {
      if (!layout.root) {
        terminalMembershipChanged = true
        // Why: createTab can persist an empty layout before TerminalPane mounts; the sync binding still needs a durable root.
        layout.root = { type: 'leaf', leafId: args.leafId }
        layout.activeLeafId = args.leafId
        layout.expandedLeafId = null
      } else if (!layoutContainsLeafId(layout.root, args.leafId)) {
        terminalMembershipChanged = true
        // Why: splitPane spawns before its snapshot reaches main; add a minimal leaf so a crash can't strand the pane's binding.
        layout.root = {
          type: 'split',
          direction: 'vertical',
          first: cloneLayoutNode(layout.root),
          second: { type: 'leaf', leafId: args.leafId }
        }
        layout.activeLeafId = args.leafId
        if (layout.expandedLeafId && !layoutContainsLeafId(layout.root, layout.expandedLeafId)) {
          layout.expandedLeafId = null
        }
      }
      layout.ptyIdsByLeafId = {
        ...layout.ptyIdsByLeafId,
        [args.leafId]: args.ptyId
      }
    } else {
      terminalMembershipChanged = true
      // Why: first tab spawn — persist a minimal layout so a SIGKILL before the renderer snapshot can't lose ptyIdsByLeafId.
      session.terminalLayoutsByTabId = {
        ...session.terminalLayoutsByTabId,
        [args.tabId]: {
          root: { type: 'leaf', leafId: args.leafId },
          activeLeafId: args.leafId,
          expandedLeafId: null,
          ptyIdsByLeafId: { [args.leafId]: args.ptyId }
        }
      }
    }
    advanceTopologyAfterMembershipChange()
    return flushWithRollbackReceipt()
  }

  // ── SSH Targets ────────────────────────────────────────────────────

  getSshTargets(): SshTarget[] {
    return (this.state.sshTargets ?? []).map(normalizeSshTarget)
  }

  getSshTarget(id: string): SshTarget | undefined {
    const target = this.state.sshTargets?.find((t) => t.id === id)
    return target ? normalizeSshTarget(target) : undefined
  }

  addSshTarget(target: SshTarget): void {
    this.state.sshTargets ??= []
    this.state.sshTargets.push(normalizeSshTarget(target))
    this.scheduleSave()
  }

  updateSshTarget(id: string, updates: Partial<Omit<SshTarget, 'id'>>): SshTarget | null {
    const target = this.state.sshTargets?.find((t) => t.id === id)
    if (!target) {
      return null
    }
    const normalized = normalizeSshTarget({ ...target, ...updates })
    Object.assign(target, updates, normalized)
    if (!Object.hasOwn(normalized, 'relayGracePeriodSeconds')) {
      delete target.relayGracePeriodSeconds
    }
    if (!Object.hasOwn(normalized, 'systemSshConnectionReuse')) {
      delete target.systemSshConnectionReuse
    }
    this.scheduleSave()
    return { ...target }
  }

  removeSshTarget(id: string): void {
    if (!this.state.sshTargets) {
      return
    }
    this.state.sshTargets = this.state.sshTargets.filter((t) => t.id !== id)
    this.scheduleSave()
  }

  // ── Live Claude PTY sessions ───────────────────────────────────────

  getClaudeLivePtySessionIds(): string[] {
    return [...(this.state.claudeLivePtySessionIds ?? [])]
  }

  addClaudeLivePtySessionId(sessionId: string): void {
    if (sessionId.length === 0 || sessionId.length > 512) {
      return
    }
    const ids = this.state.claudeLivePtySessionIds ?? []
    if (ids.includes(sessionId)) {
      return
    }
    // Why: drop oldest at the cap — stale ids get pruned against the daemon at startup, so only recency matters.
    this.state.claudeLivePtySessionIds = [...ids, sessionId].slice(-MAX_CLAUDE_LIVE_PTY_SESSION_IDS)
    // Why: flush sync so a force-quit right after a Claude spawn still seeds the live-PTY gate next launch.
    this.flush()
  }

  removeClaudeLivePtySessionId(sessionId: string): void {
    const ids = this.state.claudeLivePtySessionIds ?? []
    if (!ids.includes(sessionId)) {
      return
    }
    this.state.claudeLivePtySessionIds = ids.filter((id) => id !== sessionId)
    this.scheduleSave()
  }

  getDeletedSshConfigAliases(): string[] {
    return [...(this.state.deletedSshConfigAliases ?? [])]
  }

  addDeletedSshConfigAlias(alias: string): void {
    this.state.deletedSshConfigAliases ??= []
    if (!this.state.deletedSshConfigAliases.includes(alias)) {
      this.state.deletedSshConfigAliases.push(alias)
      this.scheduleSave()
    }
  }

  removeDeletedSshConfigAlias(alias: string): void {
    const current = this.state.deletedSshConfigAliases
    if (!current || !current.includes(alias)) {
      return
    }
    this.state.deletedSshConfigAliases = current.filter((entry) => entry !== alias)
    this.scheduleSave()
  }

  clearDeletedSshConfigAliases(): void {
    if (this.state.deletedSshConfigAliases && this.state.deletedSshConfigAliases.length > 0) {
      this.state.deletedSshConfigAliases = []
      this.scheduleSave()
    }
  }

  getRemovedSshTargetTombstones(): RemovedSshTargetTombstone[] {
    return [...(this.state.removedSshTargetTombstones ?? [])]
  }

  addRemovedSshTargetTombstone(tombstone: RemovedSshTargetTombstone): void {
    const existing = this.state.removedSshTargetTombstones ?? []
    // Why: dedupe by oldTargetId so re-removing the same id can't stack duplicate tombstones; newest wins.
    const filtered = existing.filter((t) => t.oldTargetId !== tombstone.oldTargetId)
    // Cap the history so pathological churn can't grow the state file unbounded.
    this.state.removedSshTargetTombstones = [...filtered, tombstone].slice(
      -MAX_REMOVED_SSH_TARGET_TOMBSTONES
    )
    this.scheduleSave()
  }

  removeRemovedSshTargetTombstone(oldTargetId: string): void {
    const existing = this.state.removedSshTargetTombstones
    if (!existing?.some((t) => t.oldTargetId === oldTargetId)) {
      return
    }
    this.state.removedSshTargetTombstones = existing.filter((t) => t.oldTargetId !== oldTargetId)
    this.scheduleSave()
  }

  /**
   * Re-point every repo and worktree meta pinned to a removed SSH target id onto
   * a re-added target's id so orphaned workspaces reattach. Returns re-pointed repo ids.
   */

}
