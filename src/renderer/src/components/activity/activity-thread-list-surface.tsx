import React from 'react'
import { MoreVertical } from 'lucide-react'
import { AgentStateDot, agentStateLabel } from '@/components/AgentStateDot'
import { formatAgentTypeLabel } from '@/lib/agent-status'
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
import { isClipboardTextByteLengthOverLimit } from '../../../../shared/clipboard-text'
import type { AgentStatusState } from '../../../../shared/agent-status-types'
import type { Repo } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import { getAgentRowPrimaryText } from '@/lib/agent-row-primary-text'
import {
  type ActivityGroupBy,
  type ActivityStatusGroupId,
  type ActivityThreadGroup,
  ACTIVITY_STATUS_GROUP_ORDER,
  type AgentPaneThread,
  agentMeta,
  agentSummary,
  agentTitle
} from './activity-prototype-page-model'
import { getActivityThreadWorkspaceTitle } from '@/lib/activity-thread-display'
import { threadAgentState, threadAgentStateLabel } from './activity-thread-state'

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

export function ActivityStatusGroupHeader({
  group
}: {
  group: ActivityThreadGroup
}): React.JSX.Element {
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

export { ThreadAgentStateIndicator, ThreadRow } from './activity-thread-row'
