import { randomUUID } from 'node:crypto'

import type {
  Repo,
  FolderWorkspace
} from '../shared/types'

import {
  normalizeStoredTaskSourceContext
} from '../shared/task-source-context'
import {
  normalizeWorkspaceLinkedItem
} from '../shared/workspace-linked-item'
import { isWorkspaceLinkedItemSourceContextMatch } from '../shared/workspace-linked-item-source-context'

import {
  getNextProjectGroupOrder
} from '../shared/project-groups'
import {
  normalizeFolderWorkspaceName,
  normalizeFolderWorkspaceOperationId
} from '../shared/folder-workspaces'
import {
  folderWorkspaceKey
} from '../shared/workspace-scope'

import {
  removeWorkspaceSessionOwner
} from './persistence-state-phase-8'
import { StorePhase3 } from './persistence-store-automation-state'

export class StorePhase4 extends StorePhase3 {
  createFolderWorkspace(input: {
    projectGroupId: string
    name?: string
    folderPath?: string | null
    linkedTask?: FolderWorkspace['linkedTask']
    linkedTaskSourceContext?: FolderWorkspace['linkedTaskSourceContext']
    connectionId?: string | null
    createdWithAgent?: FolderWorkspace['createdWithAgent']
    pendingFirstAgentMessageRename?: boolean
    operationId?: string
  }): FolderWorkspace {
    const operationId = normalizeFolderWorkspaceOperationId(input.operationId)
    const group = (this.state.projectGroups ?? []).find(
      (entry) => entry.id === input.projectGroupId
    )
    const folderPath =
      typeof input.folderPath === 'string' && input.folderPath.trim().length > 0
        ? input.folderPath
        : group?.parentPath
    if (!group || !folderPath) {
      throw new Error('folder_workspace_project_group_not_found')
    }
    const linkedTask = normalizeWorkspaceLinkedItem(input.linkedTask)
    const sourceContext = normalizeStoredTaskSourceContext(input.linkedTaskSourceContext)
    const name = normalizeFolderWorkspaceName(input.name, `${group.name} workspace`)
    const connectionId = input.connectionId ?? group.connectionId ?? null
    const creationFingerprint = JSON.stringify({
      projectGroupId: group.id,
      name,
      folderPath,
      connectionId,
      linkedTask,
      linkedTaskSourceContext: isWorkspaceLinkedItemSourceContextMatch(linkedTask, sourceContext)
        ? sourceContext
        : null,
      createdWithAgent: input.createdWithAgent ?? null,
      pendingFirstAgentMessageRename:
        input.pendingFirstAgentMessageRename === true && Boolean(input.createdWithAgent)
    })
    if (operationId) {
      const existing = this.getFolderWorkspaceByCreationOperationId(operationId)
      if (existing) {
        if (existing.creationFingerprint !== creationFingerprint) {
          throw new Error('folder_workspace_operation_conflict')
        }
        return existing
      }
      if (this.pendingWrite !== null) {
        throw new Error('folder_workspace_persistence_busy')
      }
    }
    const now = Date.now()
    const workspace: FolderWorkspace = {
      id: randomUUID(),
      ...(operationId ? { creationOperationId: operationId, creationFingerprint } : {}),
      projectGroupId: group.id,
      name,
      folderPath,
      connectionId,
      linkedTask,
      linkedTaskSourceContext: isWorkspaceLinkedItemSourceContextMatch(linkedTask, sourceContext)
        ? sourceContext
        : null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: now,
      ...(input.createdWithAgent ? { createdWithAgent: input.createdWithAgent } : {}),
      ...(input.pendingFirstAgentMessageRename === true && input.createdWithAgent
        ? { pendingFirstAgentMessageRename: true }
        : {}),
      lastActivityAt: 0,
      createdAt: now,
      updatedAt: now
    }
    const previousFolderWorkspaces = this.state.folderWorkspaces ?? []
    this.state.folderWorkspaces = [workspace, ...previousFolderWorkspaces]
    if (operationId) {
      try {
        // The create return is the idempotency acknowledgement boundary. Persist the
        // workspace and its operation binding atomically before a caller can retry.
        this.flushOrThrow()
      } catch (error) {
        this.state.folderWorkspaces = previousFolderWorkspaces
        // flushOrThrow clears the shared debounce timer; restore pending persistence
        // for state that existed before this operation began.
        this.scheduleSave()
        throw error
      }
    } else {
      this.scheduleSave()
    }
    return workspace
  }

  updateFolderWorkspace(
    id: string,
    updates: Partial<
      Pick<
        FolderWorkspace,
        | 'name'
        | 'folderPath'
        | 'linkedTask'
        | 'linkedTaskSourceContext'
        | 'comment'
        | 'isArchived'
        | 'isUnread'
        | 'isPinned'
        | 'sortOrder'
        | 'manualOrder'
        | 'workspaceStatus'
        | 'createdWithAgent'
        | 'pendingFirstAgentMessageRename'
        | 'firstAgentMessageRenameError'
        | 'lastActivityAt'
      >
    >
  ): FolderWorkspace | null {
    const workspace = this.getFolderWorkspace(id)
    if (!workspace) {
      return null
    }
    if (updates.name !== undefined) {
      workspace.name = normalizeFolderWorkspaceName(updates.name, workspace.name)
    }
    if (typeof updates.folderPath === 'string' && updates.folderPath.trim().length > 0) {
      workspace.folderPath = updates.folderPath
    }
    if (updates.linkedTask !== undefined) {
      workspace.linkedTask = normalizeWorkspaceLinkedItem(updates.linkedTask)
      if (
        workspace.linkedTaskSourceContext &&
        !isWorkspaceLinkedItemSourceContextMatch(
          workspace.linkedTask,
          workspace.linkedTaskSourceContext
        )
      ) {
        workspace.linkedTaskSourceContext = null
      }
    }
    if (updates.linkedTaskSourceContext !== undefined) {
      const linkedTaskSourceContext = normalizeStoredTaskSourceContext(
        updates.linkedTaskSourceContext
      )
      workspace.linkedTaskSourceContext = isWorkspaceLinkedItemSourceContextMatch(
        workspace.linkedTask,
        linkedTaskSourceContext
      )
        ? linkedTaskSourceContext
        : null
    }
    if (updates.comment !== undefined) {
      workspace.comment = updates.comment
    }
    if (updates.isArchived !== undefined) {
      workspace.isArchived = updates.isArchived
    }
    if (updates.isUnread !== undefined) {
      workspace.isUnread = updates.isUnread
    }
    if (updates.isPinned !== undefined) {
      workspace.isPinned = updates.isPinned
    }
    if (updates.sortOrder !== undefined && Number.isFinite(updates.sortOrder)) {
      workspace.sortOrder = updates.sortOrder
    }
    if (updates.manualOrder !== undefined) {
      if (Number.isFinite(updates.manualOrder)) {
        workspace.manualOrder = updates.manualOrder
      } else {
        delete workspace.manualOrder
      }
    }
    if (updates.workspaceStatus !== undefined) {
      workspace.workspaceStatus = updates.workspaceStatus
    }
    if (updates.createdWithAgent !== undefined) {
      workspace.createdWithAgent = updates.createdWithAgent
    }
    if (updates.pendingFirstAgentMessageRename !== undefined) {
      workspace.pendingFirstAgentMessageRename = updates.pendingFirstAgentMessageRename
    }
    if (updates.firstAgentMessageRenameError !== undefined) {
      workspace.firstAgentMessageRenameError = updates.firstAgentMessageRenameError
    }
    if (updates.lastActivityAt !== undefined && Number.isFinite(updates.lastActivityAt)) {
      workspace.lastActivityAt = updates.lastActivityAt
    }
    workspace.updatedAt = Date.now()
    this.scheduleSave()
    return workspace
  }

  removeFolderWorkspace(id: string): boolean {
    const before = this.state.folderWorkspaces?.length ?? 0
    if (!(this.state.folderWorkspaces ?? []).some((workspace) => workspace.id === id)) {
      return false
    }
    if (this.pendingWrite !== null) {
      throw new Error('folder_workspace_persistence_busy')
    }
    // Deletion spans workspace, session, lineage, and mobile selection state. A full
    // snapshot keeps that aggregate atomic if the durable acknowledgement write fails.
    const previousState = structuredClone(this.state)
    this.state.folderWorkspaces = (this.state.folderWorkspaces ?? []).filter(
      (workspace) => workspace.id !== id
    )
    if ((this.state.folderWorkspaces?.length ?? 0) === before) {
      return false
    }
    this.state.workspaceSession = removeWorkspaceSessionOwner(
      this.state.workspaceSession,
      folderWorkspaceKey(id)
    )!
    this.removeWorkspaceLineageForFolderParent(id)
    this.pruneMobileClientTabSelections((worktreeId) => worktreeId === folderWorkspaceKey(id))
    try {
      this.flushOrThrow()
    } catch (error) {
      this.state = previousState
      // flushOrThrow clears the shared debounce timer; restore persistence for
      // state that existed before this deletion attempt.
      this.scheduleSave()
      throw error
    }
    return true
  }

  moveProjectToGroup(repoId: string, groupId: string | null, order?: number): Repo | null {
    const repo = this.state.repos.find((entry) => entry.id === repoId)
    if (!repo) {
      return null
    }
    const normalizedGroupId =
      groupId && (this.state.projectGroups ?? []).some((group) => group.id === groupId)
        ? groupId
        : null
    const siblingRepos = this.state.repos.filter((entry) => entry.id !== repoId)
    repo.projectGroupId = normalizedGroupId
    repo.projectGroupOrder =
      typeof order === 'number' && Number.isFinite(order)
        ? order
        : getNextProjectGroupOrder(siblingRepos, normalizedGroupId)
    this.scheduleSave()
    return this.hydrateRepo(repo)
  }

  addRepo(repo: Repo): void {
    this.state.repos.push(repo)
    this.syncProjectHostSetupCompatibilityState()
    this.scheduleSave()
  }

  // Why: return false on a stale permutation (concurrent add/remove) so the caller resyncs instead of persisting an order that drops/duplicates ids.
  reorderRepos(orderedIds: string[]): boolean {
    const current = this.state.repos
    if (orderedIds.length !== current.length) {
      return false
    }
    const seen = new Set<string>()
    for (const id of orderedIds) {
      if (typeof id !== 'string' || seen.has(id)) {
        return false
      }
      seen.add(id)
    }
    const byId = new Map<string, Repo>()
    for (const r of current) {
      byId.set(r.id, r)
    }
    const next: Repo[] = []
    for (const id of orderedIds) {
      const repo = byId.get(id)
      if (!repo) {
        return false
      }
      next.push(repo)
    }
    this.state.repos = next
    this.syncProjectHostSetupCompatibilityState()
    this.scheduleSave()
    return true
  }

  // Why: repo ids are unique only within an execution host; drags persist one permutation per host when local and SSH repos coexist.

}
