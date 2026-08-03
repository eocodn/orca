// Concrete surface implementation for ActivityPrototypePage.tsx
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  BellDot,
  MessageSquareText,
  Search,
  TerminalSquare
} from 'lucide-react'

import { AgentIcon } from '@/lib/agent-catalog'
import {
  agentTypeToIconAgent,
  formatAgentTypeLabel,
  isExplicitAgentStatusFresh
} from '@/lib/agent-status'
import { useAppStore } from '@/store'
import type { RetainedAgentEntry } from '@/store/slices/agent-status'
import { getRepoMapFromState, getWorktreeMapFromState } from '@/store/selectors'
import { useSidebarResize } from '@/hooks/useSidebarResize'
import { Button } from '@/components/ui/button'
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
import { isClipboardTextByteLengthOverLimit } from '../../../../shared/clipboard-text'
import { migrationUnsupportedToAgentStatusEntry } from '@/lib/migration-unsupported-agent-entry'
import { translate } from '@/i18n/i18n'
import {
  getActivityThreadTaskTitle,
  getActivityThreadWorkspaceTitle,
  resolveActivityThreadStatusPreview
} from '@/lib/activity-thread-display'
import { getAgentRowPrimaryText } from '@/lib/agent-row-primary-text'
import {
  activateActivityThreadTerminal,
  revealActivityThreadWorkspace
} from './activity-prototype-page-actions'

import {
  ThreadReadFilter,
  ActivityGroupBy,
  ActivityEventState,
  ActivityLiveAgentState,
  ActivityStatusGroupId,
  ActivityEvent,
  ActivityLiveAgentSnapshot,
  AgentPaneThread,
  ActivityThreadGroup,
  ActivityTerminalPortalReadiness,
  ActivityTerminalPortalDomStatus,
  ActivityTerminalPortalSlotId,
  ACTIVITY_TERMINAL_LOADING_LABEL_DELAY_MS,
  ACTIVITY_THREAD_RESPONSE_RENDER_PREVIEW_MAX_LENGTH,
  ACTIVITY_STATUS_GROUP_ORDER,
  STANDALONE_ACTIVITY_WORKTREE_REPO_ID,
  absoluteDateFormatter,
  relativeTimeFormatter,
  formatAbsoluteDate,
  formatRelativeTime,
  findActivityTerminalPane,
  hasInlineDisplayNoneBetween,
  hasUnhiddenSiblingPane,
  truncatePreservingSurrogates,
  activityThreadResponseRenderPreview,
  getSelectedActivityTerminalPortalStatus,
  useActivityTerminalPortalStatus,
  otherActivityTerminalSlot,
  useActivityTerminalLoadingLabel,
  agentTitle,
  agentSummary,
  agentMeta,
  paneTitleForEntry,
  paneTitleForEvent,
  statusPreviewForEntry,
  isActivityEventState,
  isActivityLiveAgentState,
  freshActivityLiveAgentState,
  standaloneActivityWorktree,
  EVENTS_PER_PANE_CAP,
  historyEntrySnapshot,
  appendActivityEvent,
  appendActivityEventsForEntry,
  buildActivityEvents,
  buildAgentPaneThreads,
} from './activity-prototype-page-model'

import {
  ACTIVITY_SEARCH_QUERY_MAX_BYTES,
  ActivityStatusGroupHeader,
  ActivityThreadOptionsMenu,
  EventRepoBadge,
  ThreadAgentStateIndicator,
  ThreadRow,
  activityThreadMatchesSearchQuery,
  buildActivityThreadGroups,
  getActivityThreadGroup,
  groupActivityThreadsByStatus,
  handleActivityFilterFocusShortcut,
  isActivityFilterFocusShortcut,
  isActivitySearchQueryTooLarge,
  shouldIgnoreActivityFilterFocusShortcutTarget
} from './activity-thread-list-surface'

export {
  ACTIVITY_SEARCH_QUERY_MAX_BYTES,
  activityThreadMatchesSearchQuery,
  buildActivityThreadGroups,
  getActivityThreadGroup,
  groupActivityThreadsByStatus,
  handleActivityFilterFocusShortcut,
  isActivityFilterFocusShortcut,
  isActivitySearchQueryTooLarge,
  shouldIgnoreActivityFilterFocusShortcutTarget
} from './activity-thread-list-surface'

import { ActivityPrototypePageRenderer } from './activity-prototype-page-renderer'

export default function ActivityPrototypePage(): React.JSX.Element {
  const [readFilter, setReadFilter] = useState<ThreadReadFilter>('all')
  const [groupBy, setGroupBy] = useState<ActivityGroupBy>('status')
  const [query, setQuery] = useState('')
  const activityFilterInputRef = useRef<HTMLInputElement | null>(null)
  const [compactMode, setCompactMode] = useState(false)
  const [selectedPaneKey, setSelectedPaneKey] = useState<string | null>(null)
  const [displayedPaneKey, setDisplayedPaneKey] = useState<string | null>(null)
  const [activePortalSlotId, setActivePortalSlotId] =
    useState<ActivityTerminalPortalSlotId>('primary')
  const [primaryPortalTargetEl, setPrimaryPortalTargetEl] = useState<HTMLElement | null>(null)
  const [secondaryPortalTargetEl, setSecondaryPortalTargetEl] = useState<HTMLElement | null>(null)
  // Why (default width): thread cards are the primary surface; 480px lets prompts fill line-clamp-3 and keeps the per-card actions readable.
  const [threadListWidth, setThreadListWidth] = useState(480)
  const {
    containerRef: threadListRef,
    isResizing: isThreadListResizing,
    onResizeStart
  } = useSidebarResize<HTMLDivElement>({
    isOpen: true,
    width: threadListWidth,
    minWidth: 320,
    maxWidth: 720,
    deltaSign: 1,
    setWidth: setThreadListWidth
  })

  const storeData = useAppStore(
    useShallow((s) => ({
      agentStatusByPaneKey: s.agentStatusByPaneKey,
      migrationUnsupportedByPtyId: s.migrationUnsupportedByPtyId,
      retainedAgentsByPaneKey: s.retainedAgentsByPaneKey,
      tabsByWorktree: s.tabsByWorktree,
      worktreeMap: getWorktreeMapFromState(s),
      repoMap: getRepoMapFromState(s),
      acknowledgedAgentsByPaneKey: s.acknowledgedAgentsByPaneKey,
      acknowledgeAgents: s.acknowledgeAgents,
      unacknowledgeAgents: s.unacknowledgeAgents,
      generatedTitlesEnabled: s.settings?.tabAutoGenerateTitle === true
    }))
  )
  // Why: agentStatusEpoch is a dep (not used in the body) so the memo recomputes when freshness boundaries expire even without new PTY data.
  const agentStatusEpoch = useAppStore((s) => s.agentStatusEpoch)

  const { events: allEvents, liveAgentByPaneKey } = useMemo(
    () =>
      buildActivityEvents({
        agentStatusByPaneKey: storeData.agentStatusByPaneKey,
        migrationUnsupportedByPtyId: storeData.migrationUnsupportedByPtyId,
        retainedAgentsByPaneKey: storeData.retainedAgentsByPaneKey,
        tabsByWorktree: storeData.tabsByWorktree,
        worktreeMap: storeData.worktreeMap,
        repoMap: storeData.repoMap,
        acknowledgedAgentsByPaneKey: storeData.acknowledgedAgentsByPaneKey,
        // Why: Date.now() is read in the memo body (not a dep) so stale-decay recomputes when agentStatusEpoch ticks, not on wall-clock time.
        now: Date.now()
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storeData, agentStatusEpoch]
  )

  const allThreads = useMemo(
    () =>
      buildAgentPaneThreads({
        events: allEvents,
        liveAgentByPaneKey,
        generatedTitlesEnabled: storeData.generatedTitlesEnabled
      }),
    [allEvents, liveAgentByPaneKey, storeData.generatedTitlesEnabled]
  )
  const selectedPaneKeyIsLive =
    selectedPaneKey === null || allThreads.some((thread) => thread.paneKey === selectedPaneKey)
  const effectiveSelectedPaneKey = selectedPaneKeyIsLive ? selectedPaneKey : null
  if (!selectedPaneKeyIsLive) {
    // Why: rows disappear when agent retention or tab state changes; clear stale selection before detail/portal rendering targets it.
    setSelectedPaneKey(null)
  }

  const visibleThreads = useMemo(() => {
    const normalizedQuery = isActivitySearchQueryTooLarge(query) ? null : query.trim().toLowerCase()
    return allThreads.filter((thread) => {
      // Why: keep the just-selected thread visible after auto-mark-read flips it to read, else unread-only mode makes the clicked row vanish from the list.
      if (
        readFilter === 'unread' &&
        !thread.unread &&
        thread.paneKey !== effectiveSelectedPaneKey
      ) {
        return false
      }
      if (normalizedQuery === null) {
        return false
      }
      return activityThreadMatchesSearchQuery({ thread, searchQuery: normalizedQuery })
    })
  }, [allThreads, readFilter, query, effectiveSelectedPaneKey])
  const visibleThreadGroups = useMemo(
    () => buildActivityThreadGroups(visibleThreads, groupBy),
    [visibleThreads, groupBy]
  )

  const selectedThread = effectiveSelectedPaneKey
    ? (allThreads.find((thread) => thread.paneKey === effectiveSelectedPaneKey) ?? null)
    : null
  const selectedTabId = selectedThread?.tab.id ?? null
  // Why: repo-less terminal buckets can produce Activity rows, but the workspace Terminal tree only portals real worktrees.
  const selectedHasLiveTab =
    selectedThread && selectedTabId && storeData.worktreeMap.has(selectedThread.worktree.id)
      ? (storeData.tabsByWorktree[selectedThread.worktree.id] ?? []).some(
          (tab) => tab.id === selectedTabId
        )
      : false
  const displayedThread = displayedPaneKey
    ? (allThreads.find((thread) => thread.paneKey === displayedPaneKey) ?? null)
    : null
  const displayedTabId = displayedThread?.tab.id ?? null
  const displayedHasLiveTab =
    displayedThread && displayedTabId && storeData.worktreeMap.has(displayedThread.worktree.id)
      ? (storeData.tabsByWorktree[displayedThread.worktree.id] ?? []).some(
          (tab) => tab.id === displayedTabId
        )
      : false
  const { visibleThread, stagedThread } = reconcileActivityPortalThreads({
    selectedThread,
    displayedThread,
    selectedHasLiveTab: Boolean(selectedHasLiveTab),
    displayedHasLiveTab: Boolean(displayedHasLiveTab)
  })
  const inactivePortalSlotId = otherActivityTerminalSlot(activePortalSlotId)
  const portalTargetBySlot = {
    primary: primaryPortalTargetEl,
    secondary: secondaryPortalTargetEl
  } satisfies Record<ActivityTerminalPortalSlotId, HTMLElement | null>
  const activePortalTargetEl = portalTargetBySlot[activePortalSlotId]
  const inactivePortalTargetEl = portalTargetBySlot[inactivePortalSlotId]
  const visiblePortalStatus = useActivityTerminalPortalStatus(
    activePortalTargetEl,
    visibleThread?.paneKey ?? null,
    visibleThread?.migrationUnsupportedPtyId !== undefined
  )
  const stagedPortalStatus = useActivityTerminalPortalStatus(
    inactivePortalTargetEl,
    stagedThread?.paneKey ?? null,
    stagedThread?.migrationUnsupportedPtyId !== undefined
  )
  const visiblePortalReady = visiblePortalStatus === 'ready'
  const visiblePortalUnavailable = visiblePortalStatus === 'unavailable'
  const stagedPortalReady = stagedPortalStatus === 'ready'
  const stagedPortalUnavailable = stagedPortalStatus === 'unavailable'
  const showTerminalLoadingLabel = useActivityTerminalLoadingLabel(
    Boolean(visibleThread && !stagedThread && !visiblePortalReady)
  )

  const setPrimaryPortalTarget = useCallback((target: HTMLElement | null): void => {
    setPrimaryPortalTargetEl(target)
  }, [])

  const setSecondaryPortalTarget = useCallback((target: HTMLElement | null): void => {
    setSecondaryPortalTargetEl(target)
  }, [])

  // Why (no flash): anchor the portal to the selected thread's ids; selectThread's multi-step store update can briefly reflect a stale "last active tab" (wrong-terminal flash).
  // Why useMemo: stable descriptor identity so subscribers keep React.memo bail-outs; inactive descriptor stages the next terminal at the same size.
  const portalDescriptors = useMemo(() => {
    const descriptors: ActivityTerminalPortalTarget[] = []
    if (visibleThread && activePortalTargetEl) {
      descriptors.push({
        slotId: activePortalSlotId,
        requestToken: `${activePortalSlotId}:${visibleThread.paneKey}`,
        target: activePortalTargetEl,
        worktreeId: visibleThread.worktree.id,
        tabId: visibleThread.tab.id,
        paneKey: visibleThread.paneKey,
        forceUnavailable: visibleThread.migrationUnsupportedPtyId !== undefined,
        active: true
      })
    }
    if (stagedThread && inactivePortalTargetEl) {
      descriptors.push({
        slotId: inactivePortalSlotId,
        requestToken: `${inactivePortalSlotId}:${stagedThread.paneKey}`,
        target: inactivePortalTargetEl,
        worktreeId: stagedThread.worktree.id,
        tabId: stagedThread.tab.id,
        paneKey: stagedThread.paneKey,
        forceUnavailable: stagedThread.migrationUnsupportedPtyId !== undefined,
        active: false
      })
    }
    return descriptors
  }, [
    activePortalSlotId,
    activePortalTargetEl,
    inactivePortalSlotId,
    inactivePortalTargetEl,
    stagedThread,
    visibleThread
  ])

  useLayoutEffect(() => {
    const swap = resolveActivityPortalSwap({
      selectedThread,
      selectedHasLiveTab: Boolean(selectedHasLiveTab),
      visibleThread,
      stagedThread,
      visiblePortalReady,
      stagedPortalReady,
      stagedPortalUnavailable
    })
    if (swap?.kind === 'clear') {
      setDisplayedPaneKey(null)
      return
    }
    if (swap?.kind === 'swap-staged') {
      // Why: a stale selected pane must swap to the unavailable state, not leave the previous pane visible under the new row.
      setActivePortalSlotId(inactivePortalSlotId)
      setDisplayedPaneKey(swap.paneKey)
      return
    }
    if (swap?.kind === 'settle-visible') {
      setDisplayedPaneKey(swap.paneKey)
    }
  }, [
    inactivePortalSlotId,
    selectedHasLiveTab,
    selectedThread,
    stagedPortalUnavailable,
    stagedPortalReady,
    stagedThread,
    visiblePortalReady,
    visibleThread
  ])

  // Why useLayoutEffect (not useEffect): publish before paint so Terminal's portal subscriber rerenders in the same commit, else the stale target flashes on screen.
  // Why no cleanup-to-null on each change: it forces the portal through null on every switch, flashing the workspace pane; null only on unmount (effect below).
  // oxlint-disable-next-line react-doctor/no-derived-state-effect -- Why: this publishes portal descriptors to Terminal's external portal store before paint.
  useLayoutEffect(() => {
    setActivityTerminalPortals(portalDescriptors)
  }, [portalDescriptors])

  const setActivityPageRef = useCallback((node: HTMLDivElement | null): void => {
    if (!node) {
      // Why: portal cleanup must happen only on page unmount; clearing on descriptor changes flashes the workspace pane behind the activity slot.
      setActivityTerminalPortals([])
    }
  }, [])

  const focusActivityFilter = useCallback((event: KeyboardEvent): void => {
    handleActivityFilterFocusShortcut({
      activeElement: document.activeElement,
      event,
      input: activityFilterInputRef.current,
      terminalPortalTargets: [activePortalTargetEl, inactivePortalTargetEl]
    })
  }, [activePortalTargetEl, inactivePortalTargetEl])

  useEffect(() => {
    window.addEventListener('keydown', focusActivityFilter, { capture: true })
    return () => window.removeEventListener('keydown', focusActivityFilter, { capture: true })
  }, [focusActivityFilter])

  return <ActivityPrototypePageRenderer {...{ ActivityPrototypePage, activePortalSlotId, activePortalTargetEl, activityFilterInputRef, allThreads, compactMode, effectiveSelectedPaneKey, focusActivityFilter, groupBy, inactivePortalTargetEl, isThreadListResizing, onResizeStart, query, readFilter, selectedHasLiveTab, selectedThread, setActivityPageRef, setCompactMode, setGroupBy, setPrimaryPortalTarget, setQuery, setReadFilter, setSecondaryPortalTarget, setSelectedPaneKey, showTerminalLoadingLabel, stagedThread, storeData, threadListRef, threadListWidth, visiblePortalReady, visiblePortalUnavailable, visibleThread, visibleThreadGroups, visibleThreads }} />
}
