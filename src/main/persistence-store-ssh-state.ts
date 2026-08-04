import { randomUUID } from 'node:crypto'
import type { WorktreeMeta, WorktreeLineage } from '../shared/types'

import { normalizeStoredTaskSourceContext } from '../shared/task-source-context'
import { normalizeWorkspaceLinkedItem } from '../shared/workspace-linked-item'
import { isWorkspaceLinkedItemSourceContextMatch } from '../shared/workspace-linked-item-source-context'

import { getWorktreePathBasenameFromId } from '../shared/worktree-id'
import { worktreeWorkspaceKey } from '../shared/workspace-scope'

import { removeWorkspaceSessionOwner, getDefaultWorktreeMeta } from './persistence-state-phase-8'
import { StorePhase6 } from './persistence-store-pty-state'

export class StorePhase7 extends StorePhase6 {
  getWorktreeLineage(worktreeId: string): WorktreeLineage | undefined {
    return this.state.worktreeLineageById[worktreeId]
  }

  getAllWorktreeLineage(): Record<string, WorktreeLineage> {
    return this.state.worktreeLineageById
  }

  setWorktreeLineage(worktreeId: string, lineage: WorktreeLineage): WorktreeLineage {
    this.state.worktreeLineageById[worktreeId] = lineage
    this.scheduleSave()
    return lineage
  }

  removeWorktreeLineage(worktreeId: string): void {
    delete this.state.worktreeLineageById[worktreeId]
    this.scheduleSave()
  }

  /**
   * Re-key every worktreeId-keyed record from `oldWorktreeId` to `newWorktreeId` after the worktree folder (and its
   * `${repoId}::${path}` id) was renamed on disk, so a refresh re-binds state instead of orphaning it. Records the old id on
   * the new meta's `priorWorktreeIds` so session GC/hydration still recognizes PTY sessions minted under it. No-op when ids match.
   * Renderer counterpart: `buildWorktreeRenameState` in store/slices/worktrees.ts.
   */
}
