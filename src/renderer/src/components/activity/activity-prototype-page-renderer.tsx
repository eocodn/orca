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


export type ActivityPrototypePageRenderProps = Record<string, unknown>

export function ActivityPrototypePageRenderer(
  props: ActivityPrototypePageRenderProps
): React.JSX.Element {
  const {
    ActivityPrototypePage,
    activePortalSlotId,
    activePortalTargetEl,
    activityFilterInputRef,
    allThreads,
    compactMode,
    effectiveSelectedPaneKey,
    focusActivityFilter,
    groupBy,
    inactivePortalTargetEl,
    isThreadListResizing,
    onResizeStart,
    query,
    readFilter,
    selectedHasLiveTab,
    selectedThread,
    setActivityPageRef,
    setCompactMode,
    setGroupBy,
    setPrimaryPortalTarget,
    setQuery,
    setReadFilter,
    setSecondaryPortalTarget,
    setSelectedPaneKey,
    showTerminalLoadingLabel,
    stagedThread,
    storeData,
    threadListRef,
    threadListWidth,
    visiblePortalReady,
    visiblePortalUnavailable,
    visibleThread,
    visibleThreadGroups,
    visibleThreads
  } = props as any
  return () => window.removeEventListener('keydown', focusActivityFilter, { capture: true })
  }, [activePortalTargetEl, inactivePortalTargetEl])

  const markThreadRead = (thread: AgentPaneThread): void => {
    storeData.acknowledgeAgents([thread.paneKey])
  }

  const markThreadUnread = (thread: AgentPaneThread): void => {
    storeData.unacknowledgeAgents([thread.paneKey])
  }

  const selectThread = (thread: AgentPaneThread): void => {
    setSelectedPaneKey(thread.paneKey)
    activateActivityThreadTerminal(thread)
  }

  useEffect(() => {
    if (
      !selectedThread ||
      !selectedThread.unread ||
      stagedThread ||
      selectedThread.paneKey !== effectiveSelectedPaneKey
    ) {
      return
    }
    const selectedThreadHasDetailOnlyView =
      !selectedHasLiveTab || selectedThread.migrationUnsupportedPtyId !== undefined
    const selectedThreadIsVisibleTerminal =
      visibleThread?.paneKey === effectiveSelectedPaneKey && visiblePortalReady
    if (selectedThreadHasDetailOnlyView || selectedThreadIsVisibleTerminal) {
      storeData.acknowledgeAgents([selectedThread.paneKey])
    }
  }, [
    selectedHasLiveTab,
    effectiveSelectedPaneKey,
    selectedThread,
    stagedThread,
    storeData,
    visiblePortalReady,
    visibleThread
  ])

  const jumpToWorkspace = (thread: AgentPaneThread): void => {
    if (!revealActivityThreadWorkspace(thread)) {
      return
    }
    markThreadRead(thread)
  }

  const hasUnreadThreads = allThreads.some((thread) => thread.unread)

  const markAllThreadsRead = (): void => {
    const unreadKeys = allThreads.filter((t) => t.unread).map((t) => t.paneKey)
    if (unreadKeys.length === 0) {
      return
    }
    storeData.acknowledgeAgents(unreadKeys)
  }

  // Why (page padding): no top/horizontal padding so the page reaches the window edges; the titlebar and the right pane's title row (pt-2) supply the top spacing.
  return (
    <div ref={setActivityPageRef} className="flex h-full min-h-0 flex-col bg-background pb-3">
      <main className="flex min-h-0 flex-1 overflow-hidden">
        <aside
          ref={threadListRef}
          className="relative flex min-h-0 shrink-0 flex-col border-r border-border"
          style={{ width: threadListWidth }}
        >
          <div className="shrink-0 border-b border-border px-2 pt-2 pb-2">
            <div className="flex items-center gap-2">
              <div className="relative min-w-0 flex-1">
                <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  ref={activityFilterInputRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={translate(
                    'auto.components.activity.ActivityPrototypePage.795cbf26e2',
                    'Filter...'
                  )}
                  className="h-8 w-full pl-7 text-xs"
                />
              </div>
              <Select
                value={groupBy}
                onValueChange={(value) => setGroupBy(value as ActivityGroupBy)}
              >
                <SelectTrigger
                  size="sm"
                  className="h-8 w-[128px] shrink-0 px-2 text-xs"
                  aria-label={translate(
                    'auto.components.activity.ActivityPrototypePage.770d458144',
                    'Group agent activity by'
                  )}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="status">
                    {translate(
                      'auto.components.activity.ActivityPrototypePage.4a3986b200',
                      'Status'
                    )}
                  </SelectItem>
                  <SelectItem value="project">
                    {translate(
                      'auto.components.activity.ActivityPrototypePage.8c3b621ddf',
                      'Project'
                    )}
                  </SelectItem>
                  <SelectItem value="worktree">
                    {translate(
                      'auto.components.activity.ActivityPrototypePage.b29191b3e0',
                      'Worktree'
                    )}
                  </SelectItem>
                  <SelectItem value="agent">
                    {translate(
                      'auto.components.activity.ActivityPrototypePage.f6396e1f85',
                      'Agent'
                    )}
                  </SelectItem>
                </SelectContent>
              </Select>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Toggle
                    pressed={readFilter === 'unread'}
                    onPressedChange={(pressed) => setReadFilter(pressed ? 'unread' : 'all')}
                    variant="outline"
                    size="sm"
                    className={cn(
                      'size-8 shrink-0 p-0',
                      readFilter === 'unread'
                        ? '!border-primary !bg-primary !text-primary-foreground shadow-xs ring-2 ring-primary/35 hover:!bg-primary/90 hover:!text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    )}
                    aria-label={translate(
                      'auto.components.activity.ActivityPrototypePage.d1a88df9a8',
                      'Show unread threads only'
                    )}
                  >
                    <BellDot className="size-3.5" />
                  </Toggle>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {translate(
                    'auto.components.activity.ActivityPrototypePage.d1a88df9a8',
                    'Show unread threads only'
                  )}
                </TooltipContent>
              </Tooltip>
              {/* Why (overflow menu): "Mark all read" is low-frequency and destructive-feeling; behind `…` keeps the toolbar on the frequent Filter + unread toggle. */}
              <ActivityThreadOptionsMenu
                compactMode={compactMode}
                hasUnreadThreads={hasUnreadThreads}
                onCompactModeChange={setCompactMode}
                onMarkAllThreadsRead={markAllThreadsRead}
              />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek">
            {visibleThreadGroups.map((group) => (
              <section
                key={group.key}
                aria-label={translate(
                  'auto.components.activity.ActivityPrototypePage.a2b4437bfb',
                  '{{value0}} activity',
                  { value0: group.label }
                )}
              >
                <ActivityStatusGroupHeader group={group} />
                {group.threads.map((thread) => (
                  <ThreadRow
                    key={thread.paneKey}
                    thread={thread}
                    selected={thread.paneKey === selectedThread?.paneKey}
                    onSelect={() => selectThread(thread)}
                    onJump={() => jumpToWorkspace(thread)}
                    onMarkUnread={() => markThreadUnread(thread)}
                    canJump={storeData.worktreeMap.has(thread.worktree.id)}
                    compactMode={compactMode}
                  />
                ))}
              </section>
            ))}
            {visibleThreads.length === 0 ? (
              <div className="px-3 py-8 text-sm text-muted-foreground">
                {translate(
                  'auto.components.activity.ActivityPrototypePage.7cd632006b',
                  'No agent activity matches these filters.'
                )}
              </div>
            ) : null}
          </div>
          <div
            aria-label={translate(
              'auto.components.activity.ActivityPrototypePage.443690186e',
              'Resize activity thread list'
            )}
            title={translate(
              'auto.components.activity.ActivityPrototypePage.866083500b',
              'Drag to resize'
            )}
            className={cn(
              'group absolute -right-1.5 top-0 z-20 flex h-full w-3 cursor-col-resize items-stretch justify-center',
              isThreadListResizing && 'bg-ring/10'
            )}
            onMouseDown={onResizeStart}
            role="separator"
          >
            <div
              className={cn(
                'h-full w-px bg-border transition-colors group-hover:bg-ring/50',
                isThreadListResizing && 'bg-ring'
              )}
            />
          </div>
        </aside>

        <section className="min-w-0 flex-1 overflow-hidden">
          {selectedThread ? (
            <div className="flex h-full min-h-0 flex-col">
              {/* Why (no header action button): per-card hover actions (Mark unread, Open) are the primary controls now, so the header keeps just the thread identity. */}
              <div className="flex shrink-0 items-start gap-4 border-b border-border px-4 pt-2 pb-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="inline-flex shrink-0 items-start gap-1">
                      <ThreadAgentStateIndicator thread={selectedThread} />
                      <span className="inline-flex shrink-0 pt-[3px]">
                        <AgentIcon
                          agent={agentTypeToIconAgent(selectedThread.agentType)}
                          size={16}
                        />
                      </span>
                    </span>
                    <h2 className="line-clamp-3 break-words text-sm font-semibold leading-snug">
                      {selectedThread.paneTitle}
                    </h2>
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-1.5 pl-11">
                    <EventRepoBadge repo={selectedThread.repo} />
                    <span className="truncate text-xs text-muted-foreground">
                      {selectedThread.worktree.displayName}
                    </span>
                  </div>
                </div>
              </div>
              {/* Why: Terminal stays mounted in the hidden workspace tree; this target moves that existing TerminalPane here instead of spawning a second PTY/xterm owner. */}
              {(() => {
                // Why: retained threads can outlive their tab; portal needs a live TerminalPane to render into.
                if (!selectedHasLiveTab) {
                  return (
                    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
                      <TerminalSquare className="size-7" />
                      {storeData.worktreeMap.has(selectedThread.worktree.id)
                        ? translate(
                            'auto.components.activity.ActivityPrototypePage.afdc2139a8',
                            'Agent terminal closed. Open a new terminal in this workspace to continue.'
                          )
                        : translate(
                            'auto.components.activity.ActivityPrototypePage.22b22034bc',
                            'Standalone terminal unavailable in Activity.'
                          )}
                    </div>
                  )
                }
                return (
                  <div className="relative min-h-0 flex-1 overflow-hidden bg-editor-surface">
                    <div
                      ref={setPrimaryPortalTarget}
                      className={cn(
                        'absolute inset-0 min-h-0 min-w-0',
                        activePortalSlotId === 'primary'
                          ? 'z-10 opacity-100'
                          : 'pointer-events-none z-0 opacity-0'
                      )}
                      aria-hidden={activePortalSlotId !== 'primary'}
                      data-activity-terminal-slot-id="primary"
                    />
                    <div
                      ref={setSecondaryPortalTarget}
                      className={cn(
                        'absolute inset-0 min-h-0 min-w-0',
                        activePortalSlotId === 'secondary'
                          ? 'z-10 opacity-100'
                          : 'pointer-events-none z-0 opacity-0'
                      )}
                      aria-hidden={activePortalSlotId !== 'secondary'}
                      data-activity-terminal-slot-id="secondary"
                    />
                    {visibleThread && !stagedThread && !visiblePortalReady ? (
                      <div
                        className="pointer-events-none absolute inset-0 z-20 bg-editor-surface"
                        aria-hidden="true"
                      >
                        {visiblePortalUnavailable ? (
                          <div className="ml-3 mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-background/85 px-2 py-1 text-xs text-muted-foreground shadow-xs">
                            <span className="h-3 w-1.5 rounded-sm bg-muted-foreground/70" />
                            <span>
                              {translate(
                                'auto.components.activity.ActivityPrototypePage.8de7c5beaa',
                                'Terminal unavailable'
                              )}
                            </span>
                          </div>
                        ) : showTerminalLoadingLabel ? (
                          <div className="ml-3 mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-background/85 px-2 py-1 text-xs text-muted-foreground shadow-xs">
                            <span className="h-3 w-1.5 animate-pulse rounded-sm bg-muted-foreground/70" />
                            <span>
                              {translate(
                                'auto.components.activity.ActivityPrototypePage.1b633f5c1e',
                                'Connecting terminal...'
                              )}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                )
              })()}
            </div>
          ) : (
            <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              {visibleThreads.length === 0 ? (
                <>
                  <MessageSquareText className="size-7" />
                  {translate(
                    'auto.components.activity.ActivityPrototypePage.e3db9892f6',
                    'No activity yet.'
                  )}
                </>
              ) : (
                <>
                  <TerminalSquare className="size-7" />
                  {translate(
                    'auto.components.activity.ActivityPrototypePage.cf780197a1',
                    'Select an agent to view its activity'
                  )}
                </>
              )}
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
