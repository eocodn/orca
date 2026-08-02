/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: Linear drawer state hydrates full issue details and comments from provider IPC for the selected issue. */
import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowRight,
  ChevronDown,
  ExternalLink,
  Gauge,
  LoaderCircle,
  Send,
  Tag,
  UserRound,
  X
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LinearIssueTextEditor } from '@/components/LinearIssueTextEditor'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { VisuallyHidden } from 'radix-ui'
import CommentMarkdown from '@/components/sidebar/CommentMarkdown'
import { cn } from '@/lib/utils'
import {
  getCommentBodySubmitState,
  hasBoundedCommentBodyText
} from '@/lib/comment-body-submit-state'
import { useAppStore } from '@/store'
import { getScreenSubmitShortcutLabel, isScreenSubmitShortcut } from '@/lib/screen-submit-shortcut'
import { createBrowserUuid } from '@/lib/browser-uuid'
import {
  useTeamStates,
  useTeamLabels,
  useTeamMembers,
  useImmediateMutation
} from '@/hooks/useIssueMetadata'
import {
  getLinearStateMarkerStyle,
  getLinearStatePillStyle
} from '@/components/linear-state-pill-style'
import { LinearPriorityIcon } from '@/components/linear-priority-icon'
import type { LinearIssue, LinearComment } from '../../../shared/types'
import type { TaskSourceContext } from '../../../shared/task-source-context'
import {
  linearAddIssueComment,
  linearGetIssue,
  linearIssueComments,
  linearUpdateIssue
} from '@/runtime/runtime-linear-client'
import { translate } from '@/i18n/i18n'
export function LinearIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className} fill="currentColor">
      <path d="M2.886 4.18A11.982 11.982 0 0 1 11.99 0C18.624 0 24 5.376 24 12.009c0 3.64-1.62 6.903-4.18 9.105L2.887 4.18ZM1.817 5.626l16.556 16.556c-.524.33-1.075.62-1.65.866L.951 7.277c.247-.575.537-1.126.866-1.65ZM.322 9.163l14.515 14.515c-.71.172-1.443.282-2.195.322L0 11.358a12 12 0 0 1 .322-2.195Zm-.17 4.862 9.823 9.824a12.02 12.02 0 0 1-9.824-9.824Z" />
    </svg>
  )
}

export const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low'
}

export const LINEAR_EDIT_CHIP_CLASS =
  'inline-flex h-6 min-w-0 max-w-[14rem] cursor-pointer items-center gap-1.5 rounded-full border border-border/70 bg-background/70 px-2.5 text-[11px] font-medium leading-none text-muted-foreground shadow-xs transition-[background-color,border-color,color,box-shadow] hover:border-border hover:bg-accent hover:text-accent-foreground hover:[--linear-state-pill-current-background:var(--linear-state-pill-hover-background)] hover:[--linear-state-pill-current-border:var(--linear-state-pill-hover-border)] hover:[--linear-state-pill-current-foreground:var(--linear-state-pill-hover-foreground)] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-80'

export const LINEAR_EDIT_MENU_ITEM_CLASS =
  'flex w-full cursor-pointer items-center rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent'

export const LINEAR_EDIT_MENU_ITEM_WITH_ICON_CLASS =
  'flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent'

export const LINEAR_ESTIMATE_PRESETS = [1, 2, 3, 5, 8] as const

export function formatLinearEstimateLabel(estimate: number | null | undefined): string {
  return estimate === null || estimate === undefined ? 'Set estimate' : `Estimate ${estimate}`
}

export function formatLinearEstimateInput(estimate: number | null | undefined): string {
  return estimate === null || estimate === undefined ? '' : String(estimate)
}

export function LinearEditChipAdornment({
  loading,
  pending
}: {
  loading?: boolean
  pending?: boolean
}): React.JSX.Element {
  if (loading || pending) {
    return <LoaderCircle className="size-3 shrink-0 animate-spin opacity-70" />
  }

  return <ChevronDown className="size-3 shrink-0 opacity-55" />
}

function formatRelativeTime(input: string): string {
  const date = new Date(input)
  if (Number.isNaN(date.getTime())) {
    return 'recently'
  }
  const diffMs = date.getTime() - Date.now()
  const diffMinutes = Math.round(diffMs / 60_000)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (Math.abs(diffMinutes) < 60) {
    return formatter.format(diffMinutes, 'minute')
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return formatter.format(diffHours, 'hour')
  }
  const diffDays = Math.round(diffHours / 24)
  return formatter.format(diffDays, 'day')
}
