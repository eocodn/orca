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
import { ACTIVITY_TERMINAL_LOADING_LABEL_DELAY_MS, ACTIVITY_THREAD_RESPONSE_RENDER_PREVIEW_MAX_LENGTH, ACTIVITY_STATUS_GROUP_ORDER, STANDALONE_ACTIVITY_WORKTREE_REPO_ID, absoluteDateFormatter, relativeTimeFormatter, formatAbsoluteDate, formatRelativeTime, findActivityTerminalPane, hasInlineDisplayNoneBetween, hasUnhiddenSiblingPane, truncatePreservingSurrogates, activityThreadResponseRenderPreview, getSelectedActivityTerminalPortalStatus, appendActivityEvent, appendActivityEventsForEntry, buildActivityEvents, buildAgentPaneThreads } from './activity-prototype-page-model'
import type { ThreadReadFilter, ActivityGroupBy, ActivityEventState, ActivityLiveAgentState, ActivityStatusGroupId, ActivityEvent, ActivityLiveAgentSnapshot, AgentPaneThread, ActivityThreadGroup, ActivityTerminalPortalReadiness, ActivityTerminalPortalDomStatus, ActivityTerminalPortalSlotId } from './activity-prototype-page-model'
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
