import {
  detectAgentStatusFromTitle,
  isClaudeManagementTitle,
  isShellProcess,
  type AgentStatus
} from '../../shared/agent-detection'
import type { AgentStatusEntry } from '../../shared/agent-status-types'
import type {
  RuntimeSyncedLeaf,
  RuntimeTerminalAgentStatus,
  RuntimeWorktreePsSummary,
  RuntimeWorktreeStatus
} from '../../shared/runtime-types'

export type RuntimeWorktreeStatusLeaf = Pick<RuntimeSyncedLeaf, 'ptyId' | 'paneTitle'> & {
  paneTitleUpdatedAt: number | null
  lastAgentStatus: AgentStatus | null
  lastOscTitle: string | null
  lastOscTitleAt: number | null
}

export type RuntimeWorktreeTitlePty = {
  title: string | null
  titleUpdatedAt: number | null
  lastOscTitle: string | null
  lastOscTitleAt: number | null
}

export function getLeafWorktreeStatus(
  leaf: RuntimeWorktreeStatusLeaf,
  tabTitle: string | null
): RuntimeWorktreeStatus {
  const latestTitle = getLatestAgentCandidateTitle(
    { title: leaf.paneTitle, updatedAt: leaf.paneTitleUpdatedAt },
    { title: leaf.lastOscTitle, updatedAt: leaf.lastOscTitleAt },
    { title: tabTitle, updatedAt: 0 }
  )
  const detected = latestTitle ? detectAgentStatusFromTitle(latestTitle) : leaf.lastAgentStatus
  return getDetectedWorktreeStatus(detected, leaf.ptyId !== null)
}

export function classifyLatestAgentTitle(
  ...titles: { title: string | null | undefined; updatedAt: number | null | undefined }[]
): 'agent' | 'management' | 'neutral' {
  return classifyAgentTitle(getLatestAgentCandidateTitle(...titles))
}

export function getLatestPtyTitle(pty: RuntimeWorktreeTitlePty): string | null {
  return getLatestAgentCandidateTitle(
    { title: pty.title, updatedAt: pty.titleUpdatedAt },
    { title: pty.lastOscTitle, updatedAt: pty.lastOscTitleAt }
  )
}

export function getLatestLeafTitle(
  leaf: RuntimeWorktreeStatusLeaf,
  tabTitle: string | null
): string | null {
  return getLatestAgentCandidateTitle(
    { title: leaf.paneTitle, updatedAt: leaf.paneTitleUpdatedAt },
    { title: leaf.lastOscTitle, updatedAt: leaf.lastOscTitleAt },
    { title: tabTitle, updatedAt: 0 }
  )
}

export function classifyAgentTitle(title: string | null): 'agent' | 'management' | 'neutral' {
  if (!title) {
    return 'neutral'
  }
  if (isClaudeManagementTitle(title)) {
    return 'management'
  }
  return detectAgentStatusFromTitle(title) !== null ? 'agent' : 'neutral'
}

export function terminalTitleBlocksExplicitAgentStatus(title: string | null): boolean {
  return Boolean(title && (isClaudeManagementTitle(title) || isShellProcess(title)))
}

export function getLatestAgentCandidateTitle(
  ...titles: { title: string | null | undefined; updatedAt: number | null | undefined }[]
): string | null {
  return getLatestAgentCandidateTitleInfo(...titles)?.title ?? null
}

export function getLatestAgentCandidateTitleInfo(
  ...titles: { title: string | null | undefined; updatedAt: number | null | undefined }[]
): { title: string; updatedAt: number } | null {
  let latest: { title: string; updatedAt: number } | null = null
  for (const candidate of titles) {
    const title = candidate.title?.trim()
    if (!title) {
      continue
    }
    const updatedAt = candidate.updatedAt ?? 0
    if (!latest || updatedAt > latest.updatedAt) {
      latest = { title, updatedAt }
    }
  }
  return latest
}

export function getSavedTabWorktreeStatus(title: string, hasPty: boolean): RuntimeWorktreeStatus {
  return getDetectedWorktreeStatus(detectAgentStatusFromTitle(title), hasPty)
}

export function getDetectedWorktreeStatus(
  detected: AgentStatus | null,
  hasPty: boolean
): RuntimeWorktreeStatus {
  if (detected === 'permission') {
    return 'permission'
  }
  if (detected === 'working') {
    return 'working'
  }
  return hasPty ? 'active' : 'inactive'
}

export function mapExplicitAgentStateToRuntimeTerminalStatus(
  state: AgentStatusEntry['state']
): NonNullable<RuntimeTerminalAgentStatus['status']> {
  switch (state) {
    case 'blocked':
    case 'waiting':
      return 'permission'
    case 'working':
      return 'working'
    case 'done':
      return 'idle'
  }
}

export const WORKTREE_STATUS_PRIORITY: Record<RuntimeWorktreeStatus, number> = {
  inactive: 0,
  active: 1,
  done: 2,
  working: 3,
  permission: 4
}

export function mergeWorktreeStatus(
  current: RuntimeWorktreeStatus,
  next: RuntimeWorktreeStatus
): RuntimeWorktreeStatus {
  return WORKTREE_STATUS_PRIORITY[next] > WORKTREE_STATUS_PRIORITY[current] ? next : current
}

export function maxTimestamp(left: number | null, right: number | null): number | null {
  if (left === null) {
    return right
  }
  if (right === null) {
    return left
  }
  return Math.max(left, right)
}

export function compareWorktreePs(
  left: RuntimeWorktreePsSummary,
  right: RuntimeWorktreePsSummary
): number {
  if (left.isPinned !== right.isPinned) {
    return left.isPinned ? -1 : 1
  }
  if (left.unread !== right.unread) {
    return left.unread ? -1 : 1
  }
  if (left.hasHostSidebarActivity !== right.hasHostSidebarActivity) {
    return left.hasHostSidebarActivity ? -1 : 1
  }
  const leftLast = left.lastOutputAt ?? -1
  const rightLast = right.lastOutputAt ?? -1
  if (leftLast !== rightLast) {
    return rightLast - leftLast
  }
  if (left.liveTerminalCount !== right.liveTerminalCount) {
    return right.liveTerminalCount - left.liveTerminalCount
  }
  return left.path.localeCompare(right.path)
}
