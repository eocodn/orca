// Concrete surface implementation for ProjectCell.tsx
/* oxlint-disable react-doctor/no-adjust-state-on-prop-change -- Why: Project field details are fetched from provider metadata IPC after the concrete field/value identity is known. */
// Why: one cell per visible column. Dispatch on `field.dataType` first (so
// built-in ASSIGNEES/LABELS cells render their dedicated content) and fall
// through to `fieldValuesByFieldId[field.id].kind` as a safety net so a
// fetched value is never silently dropped.
import React, { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CircleDot, FileText, GitPullRequest, Lock, Plus } from 'lucide-react'
import { TYPE_FIELD_DATA_TYPE } from './columns'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { useRepoAssigneesBySlug, useRepoLabelsBySlug } from '@/hooks/useGitHubSlugMetadata'
import { useAppStore } from '@/store'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { useRepoSlugIndex } from '@/lib/repo-slug-index'
import { getSettingsForRepoRuntimeOwner } from '@/lib/repo-runtime-owner'
import type {
  GitHubIssueType,
  GitHubProjectField,
  GitHubProjectFieldMutationValue,
  GitHubProjectLabel,
  GitHubProjectRow,
  GitHubProjectUser,
  ListIssueTypesBySlugResult
} from '../../../../shared/github-project-types'
import type { GlobalSettings } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'
import { ProjectCell, TitleCell, TypeCell, IssueTypeCell, SingleSelectCell, IterationCell, IterationRow, AssigneesCell, LabelsCell, EmptyCellPrompt, colorHex, SINGLE_SELECT_HEX, chipStyle, singleSelectChipColors, labelChipColors, rgbToHsl, hslToCss } from './project-cell-surface'
import type { Props, ChipColors } from './project-cell-surface'
export function TextCell({
  value,
  editable,
  numeric,
  placeholder,
  onCommit
}: {
  value: string
  editable: boolean
  numeric?: boolean
  placeholder: string
  onCommit: (next: string) => void
}): React.JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  if (!editable) {
    return <span className="truncate text-xs">{value}</span>
  }
  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(value)
          setEditing(true)
        }}
        className="flex h-full w-full cursor-pointer items-center px-1 text-left text-xs hover:underline"
      >
        {value || <EmptyCellPrompt label={placeholder} />}
      </button>
    )
  }
  return (
    <Input
      autoFocus
      type={numeric ? 'number' : 'text'}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false)
        if (draft !== value) {
          onCommit(draft)
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          setEditing(false)
          if (draft !== value) {
            onCommit(draft)
          }
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setEditing(false)
          setDraft(value)
        }
      }}
      className="h-6 text-xs"
    />
  )
}
export function DateCell({
  value,
  editable,
  onCommit
}: {
  value: string
  editable: boolean
  onCommit: (next: string) => void
}): React.JSX.Element {
  // Why: a date <input> fires onChange on every digit/spinner adjustment.
  // Committing on each fires a GraphQL mutation per keystroke. Buffer the
  // edit locally and commit on blur or Enter — same UX as TextCell.
  const sourceValue = value ?? ''
  const [draftState, setDraftState] = React.useState(() => ({
    sourceValue,
    draft: sourceValue
  }))
  if (draftState.sourceValue !== sourceValue) {
    setDraftState({ sourceValue, draft: sourceValue })
  }
  const draft = draftState.sourceValue === sourceValue ? draftState.draft : sourceValue
  const setDraft = (nextDraft: string): void => setDraftState({ sourceValue, draft: nextDraft })
  if (!editable) {
    return <span className="text-xs">{value}</span>
  }
  return (
    <input
      type="date"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== sourceValue) {
          onCommit(draft)
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          ;(e.target as HTMLInputElement).blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setDraft(sourceValue)
          ;(e.target as HTMLInputElement).blur()
        }
      }}
      className="h-6 cursor-pointer rounded border border-border/50 bg-background px-1 text-xs"
    />
  )
}
export function LabelChip({ label }: { label: GitHubProjectLabel }): React.JSX.Element {
  // Why: match GitHub's dark-mode label rendering — translucent fill of the
  // label color with a brighter foreground derived from the same hue. The
  // outline-only chip we had before was hard to read against the dark UI.
  const colors = labelChipColors(label.color)
  return (
    <span
      className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--github-project-chip-fg-light)] dark:text-[var(--github-project-chip-fg-dark)]"
      style={chipStyle(colors)}
    >
      {label.name}
    </span>
  )
}
export function UserChip({ user }: { user: GitHubProjectUser }): React.JSX.Element {
  if (user.avatarUrl) {
    return (
      <img
        src={user.avatarUrl}
        alt={user.login}
        title={user.login}
        className="size-5 rounded-full border border-border/40"
      />
    )
  }
  return (
    <span
      title={user.login}
      className="inline-flex size-5 items-center justify-center rounded-full bg-muted text-[10px]"
    >
      {user.login.slice(0, 1).toUpperCase()}
    </span>
  )
}
