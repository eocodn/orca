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
import { TypeCell, IssueTypeCell, SingleSelectCell, IterationCell, IterationRow, TextCell, DateCell, LabelChip, UserChip, AssigneesCell, LabelsCell, EmptyCellPrompt, colorHex, SINGLE_SELECT_HEX, chipStyle, singleSelectChipColors, labelChipColors, rgbToHsl, hslToCss } from './project-cell-surface'
import type { ChipColors } from './project-cell-surface'
export type Props = {
  row: GitHubProjectRow
  field: GitHubProjectField
  editable: boolean
  onEditField?: (fieldId: string, value: GitHubProjectFieldMutationValue | null) => void
  /** Called with add/remove login deltas when the inline assignees picker
   *  commits a change. The parent routes this through `patchProjectIssueOrPr`
   *  so the mutation uses the row's slug — never the active workspace repo. */
  onEditAssignees?: (add: string[], remove: string[]) => void
  /** Called with add/remove label-name deltas when the inline labels picker
   *  commits a change. Routed through `patchProjectIssueOrPr` so the mutation
   *  uses the row's slug — never the active workspace repo. */
  onEditLabels?: (add: string[], remove: string[]) => void
  onEditIssueType?: (issueType: GitHubIssueType | null) => void
  onOpenDialog?: () => void
  sourceHost?: string
  sourceSettings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
}
export default function ProjectCell({
  row,
  field,
  editable,
  onEditField,
  onEditAssignees,
  onEditLabels,
  onEditIssueType,
  onOpenDialog,
  sourceHost,
  sourceSettings
}: Props): React.JSX.Element {
  const value = row.fieldValuesByFieldId[field.id]
  const isRedacted = row.itemType === 'REDACTED'

  // Built-in dataType dispatch first.
  if (field.dataType === 'TITLE') {
    return <TitleCell row={row} onOpenDialog={onOpenDialog} />
  }
  if (field.dataType === TYPE_FIELD_DATA_TYPE) {
    const editableHere = editable && !isRedacted && row.itemType === 'ISSUE'
    return (
      <TypeCell
        row={row}
        editable={editableHere}
        sourceHost={sourceHost}
        sourceSettings={sourceSettings}
        onEditIssueType={onEditIssueType}
      />
    )
  }
  if (field.dataType === 'ASSIGNEES') {
    const editableHere = editable && !isRedacted && row.itemType !== 'DRAFT_ISSUE'
    return (
      <AssigneesCell
        row={row}
        editable={editableHere}
        sourceHost={sourceHost}
        sourceSettings={sourceSettings}
        onEditAssignees={onEditAssignees}
      />
    )
  }
  if (field.dataType === 'LABELS') {
    const editableHere = editable && !isRedacted && row.itemType !== 'DRAFT_ISSUE'
    return (
      <LabelsCell
        row={row}
        editable={editableHere}
        sourceHost={sourceHost}
        sourceSettings={sourceSettings}
        onEditLabels={onEditLabels}
      />
    )
  }
  if (field.dataType === 'REPOSITORY') {
    return (
      <span className="truncate text-xs text-muted-foreground">{row.content.repository ?? ''}</span>
    )
  }
  if (field.dataType === 'PARENT_ISSUE') {
    return (
      <span className="truncate text-xs text-muted-foreground">
        {row.content.parentIssue ? `#${row.content.parentIssue.number}` : ''}
      </span>
    )
  }

  // Why: dispatch on the field's kind/dataType — not the value's kind — so an
  // unset cell still renders the appropriate editor and the user can assign a
  // value from scratch (e.g. set Status when it's currently empty).
  if (field.kind === 'single-select') {
    return (
      <SingleSelectCell
        row={row}
        field={field}
        editable={editable && !isRedacted}
        onEditField={onEditField}
      />
    )
  }
  if (field.kind === 'iteration') {
    return (
      <IterationCell
        row={row}
        field={field}
        editable={editable && !isRedacted}
        onEditField={onEditField}
      />
    )
  }
  if (field.dataType === 'TEXT') {
    const text = value?.kind === 'text' ? value.text : ''
    return (
      <TextCell
        value={text}
        editable={editable && !isRedacted}
        placeholder={translate('auto.components.github.project.ProjectCell.9cb1a0c984', 'Add text')}
        onCommit={(next) => {
          if (next === '') {
            onEditField?.(field.id, null)
          } else {
            onEditField?.(field.id, { kind: 'text', text: next })
          }
        }}
      />
    )
  }
  if (field.dataType === 'NUMBER') {
    const num = value?.kind === 'number' ? String(value.number) : ''
    return (
      <TextCell
        value={num}
        editable={editable && !isRedacted}
        numeric
        placeholder={translate(
          'auto.components.github.project.ProjectCell.bb7ebc11e3',
          'Add number'
        )}
        onCommit={(next) => {
          if (next === '') {
            onEditField?.(field.id, null)
            return
          }
          const parsed = Number(next)
          if (Number.isFinite(parsed)) {
            onEditField?.(field.id, { kind: 'number', number: parsed })
          }
        }}
      />
    )
  }
  if (field.dataType === 'DATE') {
    const date = value?.kind === 'date' ? value.date : ''
    return (
      <DateCell
        value={date}
        editable={editable && !isRedacted}
        onCommit={(next) => {
          if (!next) {
            onEditField?.(field.id, null)
          } else {
            onEditField?.(field.id, { kind: 'date', date: next })
          }
        }}
      />
    )
  }
  // Read-only fallback for value kinds that aren't user-editable inline
  // (labels/users baked into custom fields, plus any unknown shape).
  if (value?.kind === 'labels') {
    return (
      <div className="flex flex-wrap gap-1">
        {value.labels.map((l) => (
          <LabelChip key={l.name} label={l} />
        ))}
      </div>
    )
  }
  if (value?.kind === 'users') {
    return (
      <div className="flex flex-wrap gap-1">
        {value.users.map((u) => (
          <UserChip key={u.login} user={u} />
        ))}
      </div>
    )
  }
  return <span />
}
export function TitleCell({
  row,
  onOpenDialog
}: {
  row: GitHubProjectRow
  onOpenDialog?: () => void
}): React.JSX.Element {
  if (row.itemType === 'REDACTED') {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Lock className="size-3.5" />
        <span className="italic">
          {translate('auto.components.github.project.ProjectCell.af5d8c912a', 'Restricted item')}
        </span>
      </div>
    )
  }
  // Why: only PRs get a type icon. The CircleDot used for issues/drafts added
  // visual noise without disambiguating anything (issue numbers + titles
  // already read as issues), so it's omitted.
  const content = (
    <div className="flex min-w-0 items-center gap-2">
      {row.itemType === 'PULL_REQUEST' ? (
        <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" />
      ) : null}
      {row.content.number != null ? (
        <span className="shrink-0 text-xs text-muted-foreground">#{row.content.number}</span>
      ) : null}
      <span className="truncate text-sm font-medium">{row.content.title}</span>
    </div>
  )
  if (row.itemType === 'DRAFT_ISSUE') {
    // Why: non-interactive for drafts. Body preview is rendered in a hover
    // card (not wired here to avoid pulling in another component; see parent).
    return <div className="flex items-center gap-2">{content}</div>
  }
  return (
    <button
      type="button"
      onClick={onOpenDialog}
      className="flex h-full w-full min-w-0 cursor-pointer items-center text-left hover:underline"
    >
      {content}
    </button>
  )
}
