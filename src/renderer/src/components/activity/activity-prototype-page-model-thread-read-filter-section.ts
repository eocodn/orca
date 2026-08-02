// Concrete surface implementation for ActivityPrototypePage.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  Bell,
  BellDot,
  ExternalLink,
  MessageSquareText,
  MoreVertical,
  Search,
  TerminalSquare
} from 'lucide-react'

import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { AgentIcon } from '@/lib/agent-catalog'
import {
  agentTypeToIconAgent,
  formatAgentTypeLabel,
  isExplicitAgentStatusFresh
} from '@/lib/agent-status'
import { activateTabAndFocusPane } from '@/lib/activate-tab-and-focus-pane'
import { activateAndRevealWorktree } from '@/lib/worktree-activation'
import { useAppStore } from '@/store'
import type { RetainedAgentEntry } from '@/store/slices/agent-status'
import { getRepoMapFromState, getWorktreeMapFromState } from '@/store/selectors'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { Button } from '@/components/ui/button'
import { RepoBadgeMark } from '@/components/repo/RepoBadgeLabel'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { FilledBellIcon } from '../sidebar/WorktreeCardHelpers'
import CommentMarkdown from '../sidebar/CommentMarkdown'
import {
  setActivityTerminalPortals,
  type ActivityTerminalPortalTarget
} from './activity-terminal-portal'
import {
  reconcileActivityPortalThreads,
  resolveActivityPortalSwap
} from './activity-portal-thread-reconciliation'
import {
  createActivityPortalReadinessLatch,
  type ActivityPortalReadinessStatus
} from './activity-portal-readiness-oscillation'
import type { Repo, TerminalTab, Worktree } from '../../../../shared/types'
import { FLOATING_TERMINAL_WORKTREE_ID } from '../../../../shared/constants'
import {
  AGENT_STATUS_STALE_AFTER_MS,
  type AgentStateHistoryEntry,
  type AgentStatusEntry,
  type AgentStatusState,
  type AgentType,
  type MigrationUnsupportedPtyEntry
} from '../../../../shared/agent-status-types'
import { parsePaneKey } from '../../../../shared/stable-pane-id'
import { isClipboardTextByteLengthOverLimit } from '../../../../shared/clipboard-text'
import { migrationUnsupportedToAgentStatusEntry } from '@/lib/migration-unsupported-agent-entry'
import { translate } from '@/i18n/i18n'
import {
  getActivityThreadTaskTitle,
  getActivityThreadWorkspaceTitle,
  resolveActivityThreadStatusPreview
} from '@/lib/activity-thread-display'
import { getAgentRowPrimaryText } from '@/lib/agent-row-primary-text'
import { useActivityTerminalPortalStatus, otherActivityTerminalSlot, useActivityTerminalLoadingLabel, agentTitle, agentSummary, agentMeta, paneTitleForEntry, paneTitleForEvent, statusPreviewForEntry, isActivityEventState, isActivityLiveAgentState, freshActivityLiveAgentState, standaloneActivityWorktree, EVENTS_PER_PANE_CAP, historyEntrySnapshot, appendActivityEvent, appendActivityEventsForEntry, buildActivityEvents, buildAgentPaneThreads } from './activity-prototype-page-model'
export type ThreadReadFilter = 'all' | 'unread'
export type ActivityGroupBy = 'status' | 'project' | 'worktree' | 'agent'
export type ActivityEventState = Extract<AgentStatusState, 'done' | 'blocked' | 'waiting'>
export type ActivityLiveAgentState = Extract<AgentStatusState, 'working' | 'blocked' | 'waiting'>
export type ActivityStatusGroupId = 'working' | 'blocked' | 'waiting' | 'done' | 'interrupted'
export type ActivityEvent = {
  id: string
  state: ActivityEventState
  timestamp: number
  worktree: Worktree
  repo: Repo | null
  entry: AgentStatusEntry
  tab: TerminalTab
  agentType: AgentType
  agentAlive: boolean
  migrationUnsupportedPtyId?: string
  unread: boolean
}
export type ActivityLiveAgentSnapshot = {
  state: ActivityLiveAgentState
  timestamp: number
  worktree: Worktree
  repo: Repo | null
  entry: AgentStatusEntry
  tab: TerminalTab
  agentType: AgentType
}

// Why: keyed per agent pane (tab + leaf id), not per workspace, so the list shows one row per agent; paneKey is `${tabId}:${leafId}`.
export type AgentPaneThread = {
  paneKey: string
  paneTitle: string
  worktree: Worktree
  repo: Repo | null
  tab: TerminalTab
  agentType: AgentType
  currentAgentState: ActivityLiveAgentState | null
  currentAgentEntry: AgentStatusEntry | null
  responsePreview: string
  latestTimestamp: number
  latestEvent: ActivityEvent | null
  events: ActivityEvent[]
  migrationUnsupportedPtyId?: string
  unread: boolean
}
export type ActivityThreadGroup = {
  key: string
  id?: ActivityStatusGroupId
  label: string
  state?: AgentStatusState
  threads: AgentPaneThread[]
}
export type ActivityTerminalPortalReadiness = {
  target: HTMLElement | null
  paneKey: string | null
  status: ActivityPortalReadinessStatus
}
export type ActivityTerminalPortalDomStatus = {
  ready: boolean
  unavailable: boolean
}
export type ActivityTerminalPortalSlotId = 'primary' | 'secondary'
export const ACTIVITY_TERMINAL_LOADING_LABEL_DELAY_MS = 180
export const ACTIVITY_THREAD_RESPONSE_RENDER_PREVIEW_MAX_LENGTH = 320
export const ACTIVITY_STATUS_GROUP_ORDER: ActivityStatusGroupId[] = [
  'working',
  'blocked',
  'waiting',
  'done',
  'interrupted'
]
export const STANDALONE_ACTIVITY_WORKTREE_REPO_ID = '__activity_standalone__'
export const absoluteDateFormatter = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
})
export const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
export function formatAbsoluteDate(timestamp: number): string {
  return absoluteDateFormatter.format(new Date(timestamp))
}
export function formatRelativeTime(timestamp: number): string {
  const diffMs = timestamp - Date.now()
  const diffMinutes = Math.round(diffMs / 60_000)
  if (Math.abs(diffMinutes) < 60) {
    return relativeTimeFormatter.format(diffMinutes, 'minute')
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return relativeTimeFormatter.format(diffHours, 'hour')
  }
  const diffDays = Math.round(diffHours / 24)
  return relativeTimeFormatter.format(diffDays, 'day')
}
export function findActivityTerminalPane(
  root: HTMLElement,
  leafId: string
): { foundAnyPane: boolean; pane: HTMLElement | null } {
  let foundAnyPane = false
  for (const candidate of root.querySelectorAll<HTMLElement>('[data-leaf-id]')) {
    foundAnyPane = true
    if (candidate.dataset.leafId === leafId) {
      return { foundAnyPane, pane: candidate }
    }
  }
  return { foundAnyPane, pane: null }
}
export function hasInlineDisplayNoneBetween(element: HTMLElement, root: HTMLElement): boolean {
  let current: HTMLElement | null = element
  while (current) {
    if (current.style.display === 'none') {
      return true
    }
    if (current === root) {
      return false
    }
    current = current.parentElement
  }
  return false
}
export function hasUnhiddenSiblingPane(root: HTMLElement, selectedPane: HTMLElement): boolean {
  for (const candidate of root.querySelectorAll<HTMLElement>('[data-leaf-id]')) {
    if (candidate !== selectedPane && !hasInlineDisplayNoneBetween(candidate, root)) {
      return true
    }
  }
  return false
}
export function truncatePreservingSurrogates(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value
  }
  const truncated = value.slice(0, maxLength)
  const lastCode = truncated.charCodeAt(truncated.length - 1)
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
    return truncated.slice(0, -1)
  }
  return truncated
}
export function activityThreadResponseRenderPreview({
  responsePreview
}: {
  responsePreview: string
}): string {
  const trimmed = responsePreview.trim()
  if (trimmed.length <= ACTIVITY_THREAD_RESPONSE_RENDER_PREVIEW_MAX_LENGTH) {
    return trimmed
  }
  return `${truncatePreservingSurrogates(
    trimmed,
    ACTIVITY_THREAD_RESPONSE_RENDER_PREVIEW_MAX_LENGTH
  ).trimEnd()}...`
}
export function getSelectedActivityTerminalPortalStatus(
  target: HTMLElement,
  paneKey: string
): ActivityTerminalPortalDomStatus {
  const parsed = parsePaneKey(paneKey)
  if (!parsed) {
    return { ready: false, unavailable: true }
  }
  let selectedRoot: HTMLElement | null = null
  for (const candidate of target.querySelectorAll<HTMLElement>('[data-terminal-tab-id]')) {
    if (candidate.dataset.terminalTabId === parsed.tabId) {
      selectedRoot = candidate
      break
    }
  }
  if (!selectedRoot) {
    return { ready: false, unavailable: false }
  }

  const { foundAnyPane, pane: selectedPane } = findActivityTerminalPane(selectedRoot, parsed.leafId)
  if (!selectedPane) {
    return { ready: false, unavailable: foundAnyPane }
  }

  const unavailable = hasInlineDisplayNoneBetween(selectedPane, selectedRoot)
  const hasUnisolatedSibling = hasUnhiddenSiblingPane(selectedRoot, selectedPane)
  const isVisibleRoot =
    !unavailable && (selectedPane.offsetParent !== null || selectedPane.getClientRects().length > 0)
  const hasPtyBinding =
    selectedPane.hasAttribute('data-pty-id') ||
    selectedPane.querySelector<HTMLElement>('[data-pty-id]') !== null
  const hasXtermScreen = selectedPane.querySelector<HTMLElement>('.xterm-screen') !== null
  return {
    ready: isVisibleRoot && !hasUnisolatedSibling && hasPtyBinding && hasXtermScreen,
    unavailable
  }
}
