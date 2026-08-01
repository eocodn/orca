import type { FolderWorkspace, FolderWorkspaceLinkedTask, ProjectGroup } from './types'
import { isTuiAgent } from './tui-agent-config'
import { normalizeStoredTaskSourceContext } from './task-source-context'
import { normalizeWorkspaceLinkedItem } from './workspace-linked-item'
import { isWorkspaceLinkedItemSourceContextMatch } from './workspace-linked-item-source-context'

export function normalizeFolderWorkspaceName(
  name: string | null | undefined,
  fallback = 'Untitled workspace'
): string {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  return trimmed.length > 0 ? trimmed : fallback
}

export function normalizeFolderWorkspaceOperationId(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined
  }
  const operationId = value.trim()
  if (!operationId || operationId.length > 256) {
    throw new Error('folder_workspace_operation_id_invalid')
  }
  return operationId
}

export function normalizeFolderWorkspaceLinkedTask(
  value: unknown
): FolderWorkspaceLinkedTask | null {
  return normalizeWorkspaceLinkedItem(value)
}

const CREATION_FINGERPRINT_KEYS = [
  'projectGroupId',
  'name',
  'folderPath',
  'connectionId',
  'linkedTask',
  'linkedTaskSourceContext',
  'createdWithAgent',
  'pendingFirstAgentMessageRename'
] as const

function normalizeCreationFingerprint(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(value)
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      JSON.stringify(parsed) !== value
    ) {
      return null
    }
    const record = parsed as Record<string, unknown>
    if (
      Object.keys(record).join('\0') !== CREATION_FINGERPRINT_KEYS.join('\0') ||
      typeof record.projectGroupId !== 'string' ||
      typeof record.name !== 'string' ||
      typeof record.folderPath !== 'string' ||
      !(record.connectionId === null || typeof record.connectionId === 'string') ||
      !(record.linkedTask === null || isPlainObject(record.linkedTask)) ||
      !(record.linkedTaskSourceContext === null || isPlainObject(record.linkedTaskSourceContext)) ||
      !(record.createdWithAgent === null || typeof record.createdWithAgent === 'string') ||
      typeof record.pendingFirstAgentMessageRename !== 'boolean'
    ) {
      return null
    }
    return value
  } catch {
    return null
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeFolderWorkspaces(
  value: unknown,
  projectGroups: readonly ProjectGroup[]
): FolderWorkspace[] {
  if (!Array.isArray(value)) {
    return []
  }
  const folderGroups = new Map<string, ProjectGroup>()
  for (const group of projectGroups) {
    if (group.parentPath) {
      folderGroups.set(group.id, group)
    }
  }

  const workspaces: FolderWorkspace[] = []
  const seen = new Set<string>()
  const seenCreationOperationIds = new Set<string>()
  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') {
      continue
    }
    const raw = candidate as Partial<FolderWorkspace>
    const creationFingerprint = normalizeCreationFingerprint(raw.creationFingerprint)
    const creationOperationId =
      typeof raw.creationOperationId === 'string' &&
      raw.creationOperationId.trim().length > 0 &&
      raw.creationOperationId.trim().length <= 256 &&
      creationFingerprint !== null
        ? raw.creationOperationId.trim()
        : null
    if (
      typeof raw.id !== 'string' ||
      raw.id.trim().length === 0 ||
      seen.has(raw.id) ||
      typeof raw.projectGroupId !== 'string' ||
      !folderGroups.has(raw.projectGroupId) ||
      (creationOperationId !== null && seenCreationOperationIds.has(creationOperationId))
    ) {
      continue
    }
    const group = folderGroups.get(raw.projectGroupId)
    const folderPath =
      typeof raw.folderPath === 'string' && raw.folderPath.trim().length > 0
        ? raw.folderPath
        : group?.parentPath
    if (!folderPath) {
      continue
    }
    const now = Date.now()
    const linkedTask = normalizeWorkspaceLinkedItem(raw.linkedTask)
    const linkedTaskSourceContext = normalizeStoredTaskSourceContext(raw.linkedTaskSourceContext)
    seen.add(raw.id)
    if (creationOperationId !== null) {
      seenCreationOperationIds.add(creationOperationId)
    }
    workspaces.push({
      id: raw.id,
      ...(creationOperationId !== null ? { creationOperationId } : {}),
      ...(creationOperationId !== null && creationFingerprint !== null
        ? { creationFingerprint }
        : {}),
      projectGroupId: raw.projectGroupId,
      name: normalizeFolderWorkspaceName(raw.name),
      folderPath,
      connectionId:
        typeof raw.connectionId === 'string'
          ? raw.connectionId
          : raw.connectionId === null
            ? null
            : (group?.connectionId ?? null),
      linkedTask,
      linkedTaskSourceContext: isWorkspaceLinkedItemSourceContextMatch(
        linkedTask,
        linkedTaskSourceContext
      )
        ? linkedTaskSourceContext
        : null,
      comment: typeof raw.comment === 'string' ? raw.comment : '',
      isArchived: raw.isArchived === true,
      isUnread: raw.isUnread === true,
      isPinned: raw.isPinned === true,
      sortOrder:
        typeof raw.sortOrder === 'number' && Number.isFinite(raw.sortOrder) ? raw.sortOrder : now,
      ...(typeof raw.manualOrder === 'number' && Number.isFinite(raw.manualOrder)
        ? { manualOrder: raw.manualOrder }
        : {}),
      ...(typeof raw.workspaceStatus === 'string' && raw.workspaceStatus.trim().length > 0
        ? { workspaceStatus: raw.workspaceStatus }
        : {}),
      ...(isTuiAgent(raw.createdWithAgent) ? { createdWithAgent: raw.createdWithAgent } : {}),
      ...(raw.pendingFirstAgentMessageRename === true
        ? { pendingFirstAgentMessageRename: true }
        : {}),
      ...(typeof raw.firstAgentMessageRenameError === 'string'
        ? { firstAgentMessageRenameError: raw.firstAgentMessageRenameError }
        : raw.firstAgentMessageRenameError === null
          ? { firstAgentMessageRenameError: null }
          : {}),
      lastActivityAt:
        typeof raw.lastActivityAt === 'number' && Number.isFinite(raw.lastActivityAt)
          ? raw.lastActivityAt
          : 0,
      createdAt:
        typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : now,
      updatedAt:
        typeof raw.updatedAt === 'number' && Number.isFinite(raw.updatedAt) ? raw.updatedAt : now
    })
  }
  return workspaces.sort(
    (left, right) => right.sortOrder - left.sortOrder || left.name.localeCompare(right.name)
  )
}
