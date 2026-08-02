import React from 'react'
import { Bell, ExternalLink, MoreVertical } from 'lucide-react'
import { AgentStateDot } from '@/components/AgentStateDot'
import { AgentIcon } from '@/lib/agent-catalog'
import { agentTypeToIconAgent, formatAgentTypeLabel, agentStateLabel } from '@/lib/agent-status'
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
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { FilledBellIcon } from '../sidebar/WorktreeCardHelpers'
import CommentMarkdown from '../sidebar/CommentMarkdown'
import { isClipboardTextByteLengthOverLimit } from '../../../../shared/clipboard-text'
import type { AgentStatusState } from '../../../../shared/agent-status-types'
import type { Repo } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import { getAgentRowPrimaryText } from '@/lib/agent-row-primary-text'
import {
  ActivityGroupBy,
  ActivityStatusGroupId,
  ActivityThreadGroup,
  ACTIVITY_STATUS_GROUP_ORDER,
  AgentPaneThread,
  activityThreadResponseRenderPreview,
  agentMeta,
  agentSummary,
  agentTitle
} from './activity-prototype-page-model'
import {
  formatAbsoluteDate,
  formatRelativeTime,
  getActivityThreadWorkspaceTitle
} from '@/lib/activity-thread-display'

function EventTime({ timestamp }: { timestamp: number }): React.JSX.Element {
  const absolute = formatAbsoluteDate(timestamp)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label={absolute}
          onClick={(event) => event.stopPropagation()}
        >
          {formatRelativeTime(timestamp)}
        </button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={6}>
        {absolute}
      </TooltipContent>
    </Tooltip>
  )
}

export function ActivityThreadOptionsMenu({
  compactMode,
  hasUnreadThreads,
  onCompactModeChange,
  onMarkAllThreadsRead
}: {
  compactMode: boolean
  hasUnreadThreads: boolean
  onCompactModeChange: (compactMode: boolean) => void
  onMarkAllThreadsRead: () => void
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          {/* Why: keep Tooltip and Dropdown from composing refs onto the same button (Radix setRef crash loop). */}
          <span className="inline-flex shrink-0">
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="size-8 shrink-0 border-input bg-transparent p-0 text-muted-foreground shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-transparent dark:hover:bg-accent dark:hover:text-accent-foreground"
                aria-label={translate(
                  'auto.components.activity.ActivityPrototypePage.db8a1878b5',
                  'Thread list options'
                )}
              >
                <MoreVertical className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
          </span>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {translate('auto.components.activity.ActivityPrototypePage.a472a14700', 'More options')}
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="end" sideOffset={6}>
        <DropdownMenuCheckboxItem
          checked={compactMode}
          onCheckedChange={(checked) => onCompactModeChange(checked === true)}
          onSelect={(event) => event.preventDefault()}
        >
          {translate('auto.components.activity.ActivityPrototypePage.f70e4bec47', 'Compact mode')}
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onMarkAllThreadsRead} disabled={!hasUnreadThreads}>
          {translate('auto.components.activity.ActivityPrototypePage.023ff75afe', 'Mark all read')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function ActivityProjectLabel({ repo }: { repo: Repo | null }): React.JSX.Element {
  const label =
    repo?.displayName?.trim() ||
    translate('auto.components.activity.ActivityPrototypePage.5651b216c6', 'Unknown project')
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {repo ? <RepoBadgeMark color={repo.badgeColor} /> : null}
      <span
        className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-foreground"
        title={label}
      >
        {label}
      </span>
    </div>
  )
}

export function EventRepoBadge({ repo }: { repo: Repo | null }): React.JSX.Element | null {
  if (!repo) {
    return null
  }
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-1.5 rounded-[4px] border border-border bg-accent px-1.5 py-0.5 dark:border-border/60 dark:bg-accent/50">
      <RepoBadgeMark color={repo.badgeColor} />
      <span className="max-w-[6rem] truncate text-[10px] font-semibold leading-none text-foreground lowercase">
        {repo.displayName}
      </span>
    </div>
  )
}

function threadAgentState(thread: AgentPaneThread): AgentStatusState {
  return thread.currentAgentState ?? thread.latestEvent?.state ?? 'done'
}

function threadAgentStateLabel(thread: AgentPaneThread): string {
  const state = threadAgentState(thread)
  if (!thread.currentAgentState && state === 'done' && thread.latestEvent?.entry.interrupted) {
    return 'Interrupted'
  }
  return agentStateLabel(state)
}

export function getActivityThreadGroup(
  thread: AgentPaneThread,
  groupBy: ActivityGroupBy
): { key: string; label: string } {
  if (groupBy === 'status') {
    const state = threadAgentState(thread)
    if (!thread.currentAgentState && state === 'done' && thread.latestEvent?.entry.interrupted) {
      return { key: 'done:interrupted', label: threadAgentStateLabel(thread) }
    }
    return { key: state, label: threadAgentStateLabel(thread) }
  }
  if (groupBy === 'project') {
    return thread.repo
      ? { key: `project:${thread.repo.id}`, label: thread.repo.displayName }
      : {
          key: 'project:unknown',
          label: translate(
            'auto.components.activity.ActivityPrototypePage.5651b216c6',
            'Unknown project'
          )
        }
  }
  if (groupBy === 'worktree') {
    return { key: `worktree:${thread.worktree.id}`, label: thread.worktree.displayName }
  }
  return { key: `agent:${thread.agentType}`, label: formatAgentTypeLabel(thread.agentType) }
}

export function buildActivityThreadGroups(
  threads: AgentPaneThread[],
  groupBy: ActivityGroupBy
): ActivityThreadGroup[] {
  const groups: ActivityThreadGroup[] = []
  const groupIndexByKey = new Map<string, number>()
  for (const thread of threads) {
    const group = getActivityThreadGroup(thread, groupBy)
    const existingIndex = groupIndexByKey.get(group.key)
    if (existingIndex === undefined) {
      groups.push({ key: group.key, label: group.label, threads: [thread] })
      groupIndexByKey.set(group.key, groups.length - 1)
      continue
    }
    groups[existingIndex].threads.push(thread)
  }
  return groups
}

function threadStatusGroupId(thread: AgentPaneThread): ActivityStatusGroupId {
  const state = threadAgentState(thread)
  if (!thread.currentAgentState && state === 'done' && thread.latestEvent?.entry.interrupted) {
    return 'interrupted'
  }
  return state === 'working' || state === 'blocked' || state === 'waiting' ? state : 'done'
}

function threadStatusGroupState(id: ActivityStatusGroupId): AgentStatusState {
  return id === 'interrupted' ? 'done' : id
}

function threadStatusGroupLabel(id: ActivityStatusGroupId): string {
  if (id === 'interrupted') {
    return 'Interrupted'
  }
  return agentStateLabel(threadStatusGroupState(id))
}

export function groupActivityThreadsByStatus(threads: AgentPaneThread[]): ActivityThreadGroup[] {
  const groups = new Map<ActivityStatusGroupId, AgentPaneThread[]>()
  for (const thread of threads) {
    const groupId = threadStatusGroupId(thread)
    groups.set(groupId, [...(groups.get(groupId) ?? []), thread])
  }
  return ACTIVITY_STATUS_GROUP_ORDER.flatMap((id) => {
    const groupThreads = groups.get(id) ?? []
    if (groupThreads.length === 0) {
      return []
    }
    return [
      {
        key: id,
        id,
        label: threadStatusGroupLabel(id),
        state: threadStatusGroupState(id),
        threads: groupThreads
      }
    ]
  })
}

function threadSearchText(thread: AgentPaneThread): string {
  const latest = thread.latestEvent
  const stateLabel = threadAgentStateLabel(thread)
  const currentPrompt = thread.currentAgentEntry
    ? getAgentRowPrimaryText(thread.currentAgentEntry)
    : ''
  const rawCurrentPrompt = thread.currentAgentEntry?.prompt.trim() ?? ''
  const currentSummary = thread.currentAgentEntry?.lastAssistantMessage?.trim() ?? ''
  const latestEventText = latest
    ? `${agentTitle(latest)} ${agentSummary(latest)} ${agentMeta(latest)}`
    : ''
  return `${thread.paneTitle} ${getActivityThreadWorkspaceTitle(thread.worktree)} ${thread.worktree.branch ?? ''} ${thread.repo?.displayName ?? ''} ${formatAgentTypeLabel(thread.agentType)} ${stateLabel} ${currentPrompt} ${rawCurrentPrompt} ${currentSummary} ${thread.responsePreview} ${latestEventText}`.toLowerCase()
}

export const ACTIVITY_SEARCH_QUERY_MAX_BYTES = 2 * 1024

export function isActivitySearchQueryTooLarge(
  query: string,
  maxBytes = ACTIVITY_SEARCH_QUERY_MAX_BYTES
): boolean {
  return isClipboardTextByteLengthOverLimit(query, maxBytes)
}

export function activityThreadMatchesSearchQuery({
  thread,
  searchQuery
}: {
  thread: AgentPaneThread
  searchQuery: string
}): boolean {
  if (isActivitySearchQueryTooLarge(searchQuery)) {
    return false
  }
  const trimmedQuery = searchQuery.trim()
  if (!trimmedQuery) {
    return true
  }
  return threadSearchText(thread).includes(trimmedQuery.toLowerCase())
}

export function isActivityFilterFocusShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey'>,
  isMac = navigator.userAgent.includes('Mac')
): boolean {
  if (event.key.toLowerCase() !== 'f' || event.shiftKey || event.altKey) {
    return false
  }
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
}

export function shouldIgnoreActivityFilterFocusShortcutTarget(
  target: Element | null,
  terminalPortalTargets: (HTMLElement | null)[]
): boolean {
  if (!target) {
    return false
  }
  // Why: workspace terminal stays mounted while Activity is open; only the Activity-portaled terminal keeps Cmd/Ctrl+F for terminal search.
  return terminalPortalTargets.some((portalTarget) => portalTarget?.contains(target) ?? false)
}

export function handleActivityFilterFocusShortcut({
  activeElement,
  event,
  input,
  isMac,
  terminalPortalTargets
}: {
  activeElement: Element | null
  event: Pick<
    KeyboardEvent,
    | 'altKey'
    | 'ctrlKey'
    | 'key'
    | 'metaKey'
    | 'preventDefault'
    | 'shiftKey'
    | 'stopImmediatePropagation'
    | 'stopPropagation'
  >
  input: Pick<HTMLInputElement, 'focus' | 'select'> | null
  isMac?: boolean
  terminalPortalTargets: (HTMLElement | null)[]
}): boolean {
  if (shouldIgnoreActivityFilterFocusShortcutTarget(activeElement, terminalPortalTargets)) {
    return false
  }
  if (!isActivityFilterFocusShortcut(event, isMac)) {
    return false
  }
  if (!input) {
    return false
  }
  event.preventDefault()
  // Why: hidden workspace xterms can retain focus behind Activity; stop the chord before xterm forwards it to a local/SSH PTY.
  event.stopPropagation()
  event.stopImmediatePropagation()
  input.focus()
  input.select()
  return true
}


export function ThreadAgentStateIndicator({ thread }: { thread: AgentPaneThread }): React.JSX.Element {
  const state = threadAgentState(thread)
  const label = threadAgentStateLabel(thread)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
          <AgentStateDot state={state} size="md" />
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}

export function ActivityStatusGroupHeader({ group }: { group: ActivityThreadGroup }): React.JSX.Element {
  return (
    <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 px-3 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      {group.state ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center">
          <AgentStateDot state={group.state} size="sm" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
        {group.label}
      </span>
      <span className="rounded-full border border-border bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
        {group.threads.length}
      </span>
    </div>
  )
}

function isEventFromNestedInteractiveElement(
  target: EventTarget | null,
  currentTarget: HTMLElement
): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const interactiveTarget = target.closest(
    'a, button, input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])'
  )
  return (
    interactiveTarget instanceof HTMLElement &&
    interactiveTarget !== currentTarget &&
    currentTarget.contains(interactiveTarget)
  )
}

export function ThreadRow({
  thread,
  selected,
  onSelect,
  onJump,
  onMarkUnread,
  canJump,
  compactMode
}: {
  thread: AgentPaneThread
  selected: boolean
  onSelect: () => void
  onJump: () => void
  onMarkUnread: () => void
  canJump: boolean
  compactMode: boolean
}): React.JSX.Element {
  const renderedResponsePreview = activityThreadResponseRenderPreview({
    responsePreview: thread.responsePreview
  })
  const workspaceTitle = getActivityThreadWorkspaceTitle(thread.worktree)
  const taskTitle = thread.paneTitle
  const agentLabel = formatAgentTypeLabel(thread.agentType)
  const showStatusPreview =
    !compactMode &&
    renderedResponsePreview.length > 0 &&
    renderedResponsePreview !== taskTitle &&
    renderedResponsePreview !== workspaceTitle
  return (
    <div
      data-current={selected ? 'true' : undefined}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        // Why: markdown responses can contain links; keyboard activation on a nested link follows the link instead of selecting the row.
        if (isEventFromNestedInteractiveElement(event.target, event.currentTarget)) {
          return
        }
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
      className={cn(
        // Why (WorktreeCard cues): selected = tint+shadow, beats hover; unread = weight + left bar only; stacking all three confused selected vs unread on hover.
        // Why (asymmetric padding): title leading-snug adds ~3px above cap-height; smaller top pad evens the row.
        'group relative flex w-full cursor-pointer flex-col gap-1 border-b border-border px-3 pt-2.5 pb-3 text-left transition-colors',
        selected
          ? 'bg-black/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.04)] dark:bg-white/[0.10] dark:shadow-[0_1px_2px_rgba(0,0,0,0.03)]'
          : 'hover:bg-accent/40'
      )}
    >
      {thread.unread ? (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r-full bg-primary" />
      ) : null}
      <div className="flex min-w-0 items-start gap-2">
        <span className="inline-flex shrink-0 items-start gap-1">
          <ThreadAgentStateIndicator thread={thread} />
          <span className="inline-flex shrink-0 pt-px">
            <AgentIcon agent={agentTypeToIconAgent(thread.agentType)} size={14} />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0 flex-1 space-y-0.5">
              <ActivityProjectLabel repo={thread.repo} />
              <div
                className={cn(
                  'min-w-0 text-[13px] leading-snug',
                  compactMode ? 'truncate' : 'line-clamp-2 break-words',
                  thread.unread ? 'font-semibold text-foreground' : 'font-medium text-foreground'
                )}
                title={workspaceTitle}
              >
                {workspaceTitle}
              </div>
              {taskTitle !== workspaceTitle ? (
                <div
                  className={cn(
                    'min-w-0 text-[12px] leading-snug text-muted-foreground',
                    compactMode ? 'truncate' : 'line-clamp-2 break-words'
                  )}
                  title={taskTitle}
                >
                  {taskTitle}
                </div>
              ) : null}
              {showStatusPreview ? (
                <CommentMarkdown
                  content={renderedResponsePreview}
                  className={cn(
                    'h-[1lh] min-w-0 overflow-hidden truncate whitespace-nowrap text-[11px] font-normal leading-snug text-muted-foreground/80',
                    '[&_*]:inline [&_*]:!m-0 [&_*]:!p-0 [&_*]:!whitespace-nowrap [&_br]:hidden [&_ol]:list-none [&_ul]:list-none'
                  )}
                  title={thread.responsePreview}
                />
              ) : null}
              <div className="flex min-w-0 items-center gap-1.5 pt-0.5">
                <span className="shrink-0 text-[10px] text-muted-foreground/80">{agentLabel}</span>
                {canJump ? (
                  <span
                    className={cn(
                      'ml-auto inline-flex shrink-0 items-center transition-opacity',
                      'can-hover:pointer-events-none can-hover:invisible can-hover:opacity-0',
                      'group-hover:pointer-events-auto group-hover:visible group-hover:opacity-100'
                    )}
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-xs"
                          aria-label={translate(
                            'auto.components.activity.ActivityPrototypePage.4616ea39fd',
                            'Jump to workspace'
                          )}
                          onClick={(event) => {
                            event.stopPropagation()
                            onJump()
                          }}
                          onMouseDown={(event) => event.stopPropagation()}
                        >
                          <ExternalLink className="size-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        {translate(
                          'auto.components.activity.ActivityPrototypePage.4616ea39fd',
                          'Jump to workspace'
                        )}
                      </TooltipContent>
                    </Tooltip>
                  </span>
                ) : null}
              </div>
            </div>
            <span className="inline-flex shrink-0 items-center gap-1.5 pt-px">
              <span className="inline-flex size-4 shrink-0 items-center justify-center">
                {thread.unread ? (
                  <FilledBellIcon
                    className="size-[13px] shrink-0 text-amber-500 drop-shadow-sm"
                    aria-label={translate(
                      'auto.components.activity.ActivityPrototypePage.beb2c19173',
                      'Unread'
                    )}
                  />
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation()
                          onMarkUnread()
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                        className={cn(
                          'group/unread flex size-4 shrink-0 cursor-pointer items-center justify-center rounded transition-all',
                          'hover:bg-accent/80 active:scale-95',
                          'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
                        )}
                        aria-label={translate(
                          'auto.components.activity.ActivityPrototypePage.59b131fbd9',
                          'Mark thread unread'
                        )}
                      >
                        <Bell className="size-3 text-muted-foreground/40 can-hover:opacity-0 transition-opacity group-hover:opacity-100 group-hover/unread:opacity-100" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      {translate(
                        'auto.components.activity.ActivityPrototypePage.59b131fbd9',
                        'Mark thread unread'
                      )}
                    </TooltipContent>
                  </Tooltip>
                )}
              </span>
              <EventTime timestamp={thread.latestTimestamp} />
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

