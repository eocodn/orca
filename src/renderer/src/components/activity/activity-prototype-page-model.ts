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

export function useActivityTerminalPortalStatus(
  target: HTMLElement | null,
  paneKey: string | null,
  forceUnavailable = false
): ActivityTerminalPortalReadiness['status'] {
  const [readiness, setReadiness] = useState<ActivityTerminalPortalReadiness>({
    target: null,
    paneKey: null,
    status: 'loading'
  })

  useLayoutEffect(() => {
    let disposed = false
    let readinessFrame: number | null = null
    let pendingStatus: ActivityTerminalPortalReadiness['status'] | null = null

    // Why: subscription churn can otherwise chain layout-effect updates past React's root-wide limit.
    const scheduleReadiness = (status: ActivityTerminalPortalReadiness['status']): void => {
      if (disposed) {
        return
      }
      pendingStatus = status
      if (readinessFrame !== null) {
        return
      }
      readinessFrame = requestAnimationFrame(() => {
        readinessFrame = null
        const nextStatus = pendingStatus
        pendingStatus = null
        if (disposed || nextStatus === null) {
          return
        }
        setReadiness((prev) =>
          prev.target === target && prev.paneKey === paneKey && prev.status === nextStatus
            ? prev
            : { target, paneKey, status: nextStatus }
        )
      })
    }

    const disposeFrame = (): void => {
      disposed = true
      if (readinessFrame !== null) {
        cancelAnimationFrame(readinessFrame)
        readinessFrame = null
      }
    }

    if (!target || !paneKey) {
      scheduleReadiness('loading')
      return disposeFrame
    }
    if (forceUnavailable) {
      scheduleReadiness('unavailable')
      return disposeFrame
    }

    const readinessLatch = createActivityPortalReadinessLatch()

    const updateReadiness = (status: ActivityTerminalPortalReadiness['status']): void => {
      scheduleReadiness(readinessLatch.next(status))
    }

    const checkReadiness = (): void => {
      const status = getSelectedActivityTerminalPortalStatus(target, paneKey)
      if (status.unavailable) {
        updateReadiness('unavailable')
        return
      }
      if (status.ready) {
        updateReadiness('ready')
        return
      }
      updateReadiness('loading')
    }

    checkReadiness()

    const observer = new MutationObserver(checkReadiness)
    observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-terminal-tab-id', 'data-leaf-id', 'data-pty-id', 'style']
    })

    return () => {
      disposeFrame()
      observer.disconnect()
    }
  }, [target, paneKey, forceUnavailable])

  return readiness.target === target && readiness.paneKey === paneKey ? readiness.status : 'loading'
}

export function otherActivityTerminalSlot(
  slotId: ActivityTerminalPortalSlotId
): ActivityTerminalPortalSlotId {
  return slotId === 'primary' ? 'secondary' : 'primary'
}

export function useActivityTerminalLoadingLabel(loading: boolean): boolean {
  const [visible, setVisible] = useState(false)
  const [visibleLoading, setVisibleLoading] = useState(loading)

  if (visibleLoading !== loading) {
    setVisibleLoading(loading)
    if (visible) {
      setVisible(false)
    }
  }

  useEffect(() => {
    if (!loading) {
      return
    }
    const timer = setTimeout(() => setVisible(true), ACTIVITY_TERMINAL_LOADING_LABEL_DELAY_MS)
    return () => clearTimeout(timer)
  }, [loading])

  return loading && visible
}

export function agentTitle(event: ActivityEvent): string {
  if (event.state === 'done') {
    return event.entry.interrupted ? 'Agent interrupted' : 'Agent finished'
  }
  return event.state === 'waiting' ? 'Agent waiting for input' : 'Agent needs input'
}

export function agentSummary(event: ActivityEvent): string {
  const prompt = getAgentRowPrimaryText(event.entry)
  if (event.state === 'done') {
    const message = event.entry.lastAssistantMessage?.trim()
    return message || prompt || 'Completed the current turn.'
  }
  return prompt || event.entry.lastAssistantMessage?.trim() || 'The agent paused for user input.'
}

export function agentMeta(event: ActivityEvent): string {
  const agent = formatAgentTypeLabel(event.agentType)
  if (event.state === 'done') {
    return event.entry.interrupted ? `${agent} interrupted` : `${agent} completed`
  }
  return event.state === 'waiting' ? `${agent} waiting` : `${agent} blocked`
}

// Why: rows need a stable task identity across follow-up turns; the live turn prompt ("yes", "ok proceed") must not replace the task title.
export function paneTitleForEntry(
  entry: AgentStatusEntry,
  tab: TerminalTab,
  generatedTitlesEnabled: boolean
): string {
  return getActivityThreadTaskTitle({ entry, tab, generatedTitlesEnabled })
}

export function paneTitleForEvent(event: ActivityEvent, generatedTitlesEnabled: boolean): string {
  return paneTitleForEntry(event.entry, event.tab, generatedTitlesEnabled)
}

export function statusPreviewForEntry(
  entry: AgentStatusEntry,
  agentState?: AgentStatusState | null,
  previousPreview?: string
): string {
  return resolveActivityThreadStatusPreview(entry, agentState, previousPreview)
}

export function isActivityEventState(state: AgentStatusState): state is ActivityEventState {
  return state === 'done' || state === 'blocked' || state === 'waiting'
}

export function isActivityLiveAgentState(state: AgentStatusState): state is ActivityLiveAgentState {
  return state === 'working' || state === 'blocked' || state === 'waiting'
}

export function freshActivityLiveAgentState(
  entry: AgentStatusEntry,
  now: number
): ActivityLiveAgentState | null {
  if (!isActivityLiveAgentState(entry.state)) {
    return null
  }
  return isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS) ? entry.state : null
}

export function standaloneActivityWorktree(worktreeId: string): Worktree {
  const displayName =
    worktreeId === FLOATING_TERMINAL_WORKTREE_ID ? 'Floating terminal' : 'Standalone terminal'
  return {
    id: worktreeId,
    repoId: STANDALONE_ACTIVITY_WORKTREE_REPO_ID,
    path: '',
    head: '',
    branch: displayName,
    isBare: false,
    isMainWorktree: false,
    displayName,
    comment: '',
    linkedIssue: null,
    linkedPR: null,
    linkedLinearIssue: null,
    isArchived: false,
    isUnread: false,
    isPinned: false,
    sortOrder: 0,
    lastActivityAt: 0
  }
}

// Why: per-pane cap guarantees each agent appears in the left list even when one pane has a long history.
export const EVENTS_PER_PANE_CAP = 5

export function historyEntrySnapshot(
  entry: AgentStatusEntry,
  history: AgentStateHistoryEntry
): AgentStatusEntry {
  return {
    ...entry,
    state: history.state,
    prompt: history.prompt,
    updatedAt: history.startedAt,
    stateStartedAt: history.startedAt,
    stateHistory: [],
    toolName: undefined,
    toolInput: undefined,
    lastAssistantMessage: undefined,
    interrupted: history.interrupted
  }
}

export function appendActivityEvent(args: {
  events: ActivityEvent[]
  seenEventIds: Set<string>
  state: ActivityEventState
  timestamp: number
  worktree: Worktree
  repo: Repo | null
  entry: AgentStatusEntry
  tab: TerminalTab
  agentType: AgentType
  agentAlive: boolean
  acknowledgedAt: number
  migrationUnsupportedPtyId?: string
}): void {
  const id = `agent:${args.entry.paneKey}:${args.state}:${args.timestamp}`
  if (args.seenEventIds.has(id)) {
    return
  }
  args.seenEventIds.add(id)
  args.events.push({
    id,
    state: args.state,
    timestamp: args.timestamp,
    worktree: args.worktree,
    repo: args.repo,
    entry: args.entry,
    tab: args.tab,
    agentType: args.agentType,
    agentAlive: args.agentAlive,
    migrationUnsupportedPtyId: args.migrationUnsupportedPtyId,
    unread: args.acknowledgedAt < args.timestamp
  })
}

export function appendActivityEventsForEntry(args: {
  events: ActivityEvent[]
  seenEventIds: Set<string>
  entry: AgentStatusEntry
  worktree: Worktree
  repo: Repo | null
  tab: TerminalTab
  agentType: AgentType
  agentAlive: boolean
  acknowledgedAt: number
  migrationUnsupportedPtyId?: string
}): void {
  // Why: Activity is append-only; when a pane continues (done→working), stateHistory is the only record of the previous done/blocking event.
  for (const history of args.entry.stateHistory) {
    if (!isActivityEventState(history.state)) {
      continue
    }
    appendActivityEvent({
      ...args,
      state: history.state,
      timestamp: history.startedAt,
      entry: historyEntrySnapshot(args.entry, history)
    })
  }

  if (!isActivityEventState(args.entry.state)) {
    return
  }
  appendActivityEvent({
    ...args,
    state: args.entry.state,
    timestamp: args.entry.stateStartedAt
  })
}

export function buildActivityEvents(args: {
  agentStatusByPaneKey: Record<string, AgentStatusEntry>
  migrationUnsupportedByPtyId?: Record<string, MigrationUnsupportedPtyEntry>
  retainedAgentsByPaneKey: Record<string, RetainedAgentEntry>
  tabsByWorktree: Record<string, TerminalTab[]>
  worktreeMap: Map<string, Worktree>
  repoMap: Map<string, Repo>
  acknowledgedAgentsByPaneKey: Record<string, number>
  now: number
}): {
  events: ActivityEvent[]
  liveAgentByPaneKey: Record<string, ActivityLiveAgentSnapshot>
} {
  const events: ActivityEvent[] = []
  const seenEventIds = new Set<string>()
  const tabContext = new Map<string, { worktree: Worktree; tab: TerminalTab }>()
  const liveAgentByPaneKey: Record<string, ActivityLiveAgentSnapshot> = {}

  for (const [worktreeId, tabs] of Object.entries(args.tabsByWorktree)) {
    const worktree = args.worktreeMap.get(worktreeId) ?? standaloneActivityWorktree(worktreeId)
    for (const tab of tabs) {
      tabContext.set(tab.id, { worktree, tab })
    }
  }

  for (const [paneKey, entry] of Object.entries(args.agentStatusByPaneKey)) {
    const parsed = parsePaneKey(paneKey)
    if (!parsed) {
      continue
    }
    const context = tabContext.get(parsed.tabId)
    if (!context) {
      continue
    }
    const ackAt = args.acknowledgedAgentsByPaneKey[paneKey] ?? 0
    // Why: live status is separate from history; a fresh working turn updates the thread without counting as an unread done/blocked/waiting event.
    const liveState = freshActivityLiveAgentState(entry, args.now)
    if (liveState) {
      liveAgentByPaneKey[paneKey] = {
        state: liveState,
        timestamp: entry.stateStartedAt,
        worktree: context.worktree,
        repo: args.repoMap.get(context.worktree.repoId) ?? null,
        entry,
        tab: context.tab,
        agentType: entry.agentType ?? 'unknown'
      }
    }
    appendActivityEventsForEntry({
      events,
      seenEventIds,
      worktree: context.worktree,
      repo: args.repoMap.get(context.worktree.repoId) ?? null,
      entry,
      tab: context.tab,
      agentType: entry.agentType ?? 'unknown',
      agentAlive: true,
      acknowledgedAt: ackAt
    })
  }

  for (const unsupported of Object.values(args.migrationUnsupportedByPtyId ?? {})) {
    const entry = migrationUnsupportedToAgentStatusEntry(unsupported)
    if (!entry) {
      continue
    }
    const parsed = parsePaneKey(entry.paneKey)
    if (!parsed) {
      continue
    }
    const context = tabContext.get(parsed.tabId)
    if (!context) {
      continue
    }
    const ackAt = args.acknowledgedAgentsByPaneKey[entry.paneKey] ?? 0
    liveAgentByPaneKey[entry.paneKey] = {
      state: 'blocked',
      timestamp: entry.stateStartedAt,
      worktree: context.worktree,
      repo: args.repoMap.get(context.worktree.repoId) ?? null,
      entry,
      tab: context.tab,
      agentType: entry.agentType ?? 'unknown'
    }
    appendActivityEventsForEntry({
      events,
      seenEventIds,
      worktree: context.worktree,
      repo: args.repoMap.get(context.worktree.repoId) ?? null,
      entry,
      tab: context.tab,
      agentType: entry.agentType ?? 'unknown',
      agentAlive: false,
      acknowledgedAt: ackAt,
      migrationUnsupportedPtyId: unsupported.ptyId
    })
  }

  for (const [paneKey, retained] of Object.entries(args.retainedAgentsByPaneKey)) {
    if (!parsePaneKey(paneKey)) {
      continue
    }
    const worktree =
      args.worktreeMap.get(retained.worktreeId) ??
      (args.tabsByWorktree[retained.worktreeId]
        ? standaloneActivityWorktree(retained.worktreeId)
        : null)
    if (!worktree) {
      continue
    }
    const ackAt = args.acknowledgedAgentsByPaneKey[paneKey] ?? 0
    appendActivityEventsForEntry({
      events,
      seenEventIds,
      worktree,
      repo: args.repoMap.get(worktree.repoId) ?? null,
      entry: retained.entry,
      tab: retained.tab,
      agentType: retained.agentType,
      agentAlive: false,
      acknowledgedAt: ackAt
    })
  }

  const sorted = events.sort((a, b) => b.timestamp - a.timestamp)
  const perPaneCount = new Map<string, number>()
  const includedEventIds = new Set<string>()
  const capped: ActivityEvent[] = []
  // Why: reserve each pane's newest event before the global 80-event cap so the validator's >16 panes × ≥5 events can't push a pane out of the window and hide it.
  for (const event of sorted) {
    const paneKey = event.entry.paneKey
    if (perPaneCount.has(paneKey)) {
      continue
    }
    if (capped.length >= 80) {
      break
    }
    perPaneCount.set(paneKey, 1)
    includedEventIds.add(event.id)
    capped.push(event)
  }
  for (const event of sorted) {
    if (includedEventIds.has(event.id)) {
      continue
    }
    if (capped.length >= 80) {
      break
    }
    const paneKey = event.entry.paneKey
    const count = perPaneCount.get(paneKey) ?? 0
    if (count >= EVENTS_PER_PANE_CAP) {
      continue
    }
    perPaneCount.set(paneKey, count + 1)
    includedEventIds.add(event.id)
    capped.push(event)
  }
  return { events: capped.sort((a, b) => b.timestamp - a.timestamp), liveAgentByPaneKey }
}

export function buildAgentPaneThreads(args: {
  events: ActivityEvent[]
  liveAgentByPaneKey: Record<string, ActivityLiveAgentSnapshot>
  generatedTitlesEnabled?: boolean
}): AgentPaneThread[] {
  const generatedTitlesEnabled = args.generatedTitlesEnabled === true
  const byPaneKey = new Map<string, AgentPaneThread>()
  for (const event of args.events) {
    const paneKey = event.entry.paneKey
    const existing = byPaneKey.get(paneKey)
    if (!existing) {
      byPaneKey.set(paneKey, {
        paneKey,
        paneTitle: paneTitleForEvent(event, generatedTitlesEnabled),
        worktree: event.worktree,
        repo: event.repo,
        tab: event.tab,
        agentType: event.agentType,
        currentAgentState: null,
        currentAgentEntry: null,
        responsePreview: statusPreviewForEntry(event.entry, event.state),
        latestTimestamp: event.timestamp,
        latestEvent: event,
        events: [event],
        migrationUnsupportedPtyId: event.migrationUnsupportedPtyId,
        unread: event.unread
      })
      continue
    }
    existing.events.push(event)
    existing.unread = existing.unread || event.unread
    existing.migrationUnsupportedPtyId =
      existing.migrationUnsupportedPtyId ?? event.migrationUnsupportedPtyId
    if (!existing.latestEvent || event.timestamp > existing.latestEvent.timestamp) {
      existing.latestEvent = event
      existing.paneTitle = paneTitleForEvent(event, generatedTitlesEnabled)
      existing.agentType = event.agentType
      existing.tab = event.tab
      existing.responsePreview = statusPreviewForEntry(
        event.entry,
        event.state,
        existing.responsePreview
      )
      existing.latestTimestamp = event.timestamp
    }
  }

  for (const [paneKey, liveAgent] of Object.entries(args.liveAgentByPaneKey)) {
    const existing = byPaneKey.get(paneKey)
    if (!existing) {
      byPaneKey.set(paneKey, {
        paneKey,
        paneTitle: paneTitleForEntry(liveAgent.entry, liveAgent.tab, generatedTitlesEnabled),
        worktree: liveAgent.worktree,
        repo: liveAgent.repo,
        tab: liveAgent.tab,
        agentType: liveAgent.agentType,
        currentAgentState: liveAgent.state,
        currentAgentEntry: liveAgent.entry,
        responsePreview: statusPreviewForEntry(liveAgent.entry, liveAgent.state),
        latestTimestamp: liveAgent.timestamp,
        latestEvent: null,
        events: [],
        unread: false
      })
      continue
    }
    // Why: row title/time/target must follow the active turn (not historical events) so a running agent never shows the previous prompt as primary.
    existing.paneTitle = paneTitleForEntry(liveAgent.entry, liveAgent.tab, generatedTitlesEnabled)
    existing.worktree = liveAgent.worktree
    existing.repo = liveAgent.repo
    existing.tab = liveAgent.tab
    existing.agentType = liveAgent.agentType
    existing.currentAgentState = liveAgent.state
    existing.currentAgentEntry = liveAgent.entry
    existing.responsePreview = statusPreviewForEntry(
      liveAgent.entry,
      liveAgent.state,
      existing.responsePreview
    )
    existing.latestTimestamp = liveAgent.timestamp
  }

  return Array.from(byPaneKey.values())
    .map((thread) => ({
      ...thread,
      events: [...thread.events].sort((a, b) => b.timestamp - a.timestamp)
    }))
    .sort((a, b) => b.latestTimestamp - a.latestTimestamp)
}


