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
import { ACTIVITY_TERMINAL_LOADING_LABEL_DELAY_MS, ACTIVITY_THREAD_RESPONSE_RENDER_PREVIEW_MAX_LENGTH, ACTIVITY_STATUS_GROUP_ORDER, STANDALONE_ACTIVITY_WORKTREE_REPO_ID, absoluteDateFormatter, relativeTimeFormatter, formatAbsoluteDate, formatRelativeTime, findActivityTerminalPane, hasInlineDisplayNoneBetween, hasUnhiddenSiblingPane, truncatePreservingSurrogates, activityThreadResponseRenderPreview, getSelectedActivityTerminalPortalStatus, useActivityTerminalPortalStatus, otherActivityTerminalSlot, useActivityTerminalLoadingLabel, agentTitle, agentSummary, agentMeta, paneTitleForEntry, paneTitleForEvent, statusPreviewForEntry, isActivityEventState, isActivityLiveAgentState, freshActivityLiveAgentState, standaloneActivityWorktree, EVENTS_PER_PANE_CAP, historyEntrySnapshot, appendActivityEvent, appendActivityEventsForEntry, buildActivityEvents } from './activity-prototype-page-model'
import type { ThreadReadFilter, ActivityGroupBy, ActivityEventState, ActivityLiveAgentState, ActivityStatusGroupId, ActivityEvent, ActivityLiveAgentSnapshot, AgentPaneThread, ActivityThreadGroup, ActivityTerminalPortalReadiness, ActivityTerminalPortalDomStatus, ActivityTerminalPortalSlotId } from './activity-prototype-page-model'
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
