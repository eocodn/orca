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

import { ThreadReadFilter, ActivityGroupBy, ActivityEventState, ActivityLiveAgentState, ActivityStatusGroupId, ActivityEvent, ActivityLiveAgentSnapshot, AgentPaneThread, ActivityThreadGroup, ActivityTerminalPortalReadiness, ActivityTerminalPortalDomStatus, ActivityTerminalPortalSlotId, ACTIVITY_TERMINAL_LOADING_LABEL_DELAY_MS, ACTIVITY_THREAD_RESPONSE_RENDER_PREVIEW_MAX_LENGTH, ACTIVITY_STATUS_GROUP_ORDER, STANDALONE_ACTIVITY_WORKTREE_REPO_ID, absoluteDateFormatter, relativeTimeFormatter, formatAbsoluteDate, formatRelativeTime, findActivityTerminalPane, hasInlineDisplayNoneBetween, hasUnhiddenSiblingPane, truncatePreservingSurrogates, activityThreadResponseRenderPreview, getSelectedActivityTerminalPortalStatus } from './activity-prototype-page-model-thread-read-filter-section'
import { useActivityTerminalPortalStatus, otherActivityTerminalSlot, useActivityTerminalLoadingLabel, agentTitle, agentSummary, agentMeta, paneTitleForEntry, paneTitleForEvent, statusPreviewForEntry, isActivityEventState, isActivityLiveAgentState, freshActivityLiveAgentState, standaloneActivityWorktree, EVENTS_PER_PANE_CAP, historyEntrySnapshot } from './activity-prototype-page-model-use-activity-terminal-portal-status-section'
import { appendActivityEvent, appendActivityEventsForEntry, buildActivityEvents } from './activity-prototype-page-model-append-activity-event-section'
import { buildAgentPaneThreads } from './activity-prototype-page-model-build-agent-pane-threads-section'

export { ACTIVITY_TERMINAL_LOADING_LABEL_DELAY_MS, ACTIVITY_THREAD_RESPONSE_RENDER_PREVIEW_MAX_LENGTH, ACTIVITY_STATUS_GROUP_ORDER, STANDALONE_ACTIVITY_WORKTREE_REPO_ID, absoluteDateFormatter, relativeTimeFormatter, formatAbsoluteDate, formatRelativeTime, findActivityTerminalPane, hasInlineDisplayNoneBetween, hasUnhiddenSiblingPane, truncatePreservingSurrogates, activityThreadResponseRenderPreview, getSelectedActivityTerminalPortalStatus, useActivityTerminalPortalStatus, otherActivityTerminalSlot, useActivityTerminalLoadingLabel, agentTitle, agentSummary, agentMeta, paneTitleForEntry, paneTitleForEvent, statusPreviewForEntry, isActivityEventState, isActivityLiveAgentState, freshActivityLiveAgentState, standaloneActivityWorktree, EVENTS_PER_PANE_CAP, historyEntrySnapshot, appendActivityEvent, appendActivityEventsForEntry, buildActivityEvents, buildAgentPaneThreads }
export type { ThreadReadFilter, ActivityGroupBy, ActivityEventState, ActivityLiveAgentState, ActivityStatusGroupId, ActivityEvent, ActivityLiveAgentSnapshot, AgentPaneThread, ActivityThreadGroup, ActivityTerminalPortalReadiness, ActivityTerminalPortalDomStatus, ActivityTerminalPortalSlotId }
