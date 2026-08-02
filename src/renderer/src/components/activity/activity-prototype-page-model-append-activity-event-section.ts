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
import { ACTIVITY_TERMINAL_LOADING_LABEL_DELAY_MS, ACTIVITY_THREAD_RESPONSE_RENDER_PREVIEW_MAX_LENGTH, ACTIVITY_STATUS_GROUP_ORDER, STANDALONE_ACTIVITY_WORKTREE_REPO_ID, absoluteDateFormatter, relativeTimeFormatter, formatAbsoluteDate, formatRelativeTime, findActivityTerminalPane, hasInlineDisplayNoneBetween, hasUnhiddenSiblingPane, truncatePreservingSurrogates, activityThreadResponseRenderPreview, getSelectedActivityTerminalPortalStatus, useActivityTerminalPortalStatus, otherActivityTerminalSlot, useActivityTerminalLoadingLabel, agentTitle, agentSummary, agentMeta, paneTitleForEntry, paneTitleForEvent, statusPreviewForEntry, isActivityEventState, isActivityLiveAgentState, freshActivityLiveAgentState, standaloneActivityWorktree, EVENTS_PER_PANE_CAP, historyEntrySnapshot, buildAgentPaneThreads } from './activity-prototype-page-model'
import type { ThreadReadFilter, ActivityGroupBy, ActivityEventState, ActivityLiveAgentState, ActivityStatusGroupId, ActivityEvent, ActivityLiveAgentSnapshot, AgentPaneThread, ActivityThreadGroup, ActivityTerminalPortalReadiness, ActivityTerminalPortalDomStatus, ActivityTerminalPortalSlotId } from './activity-prototype-page-model'
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
