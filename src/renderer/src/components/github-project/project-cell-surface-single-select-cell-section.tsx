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
import { ProjectCell, TitleCell, TypeCell, IssueTypeCell, TextCell, DateCell, LabelChip, UserChip, AssigneesCell, LabelsCell, EmptyCellPrompt, colorHex, SINGLE_SELECT_HEX, chipStyle, singleSelectChipColors, labelChipColors, rgbToHsl, hslToCss } from './project-cell-surface'
import type { Props, ChipColors } from './project-cell-surface'
export function SingleSelectCell({
  row,
  field,
  editable,
  onEditField
}: {
  row: GitHubProjectRow
  field: GitHubProjectField
  editable: boolean
  onEditField?: (fieldId: string, value: GitHubProjectFieldMutationValue | null) => void
}): React.JSX.Element {
  const value = row.fieldValuesByFieldId[field.id]
  const [open, setOpen] = useState(false)
  const options = field.kind === 'single-select' ? field.options : []
  // Why: GitHub single-select options ship a hue that is too dark to read on
  // the app's dark background when used as plain text. Reuse the label-chip
  // dark-mode mapping (translucent fill + brightened hue text) so status pills
  // stay readable across the same color palette.
  const label =
    value?.kind === 'single-select'
      ? (() => {
          const colors = singleSelectChipColors(value.color)
          return (
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium leading-none text-[var(--github-project-chip-fg-light)] dark:text-[var(--github-project-chip-fg-dark)]',
                editable && 'cursor-pointer'
              )}
              style={chipStyle(colors)}
            >
              {value.name}
            </span>
          )
        })()
      : null
  if (!editable) {
    return <div>{label}</div>
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={field.name}
          className="flex h-full w-full cursor-pointer items-center px-1 text-left"
        >
          {label ?? (
            <EmptyCellPrompt
              label={translate('auto.components.github.project.ProjectCell.e369bf4fec', 'Select')}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-1">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-sm hover:bg-muted/50"
            onClick={() => {
              onEditField?.(field.id, { kind: 'single-select', optionId: o.id })
              setOpen(false)
            }}
          >
            <span
              className="inline-block size-2 rounded-full"
              style={{ background: colorHex(o.color) }}
            />
            {o.name}
          </button>
        ))}
        <button
          type="button"
          className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/50"
          onClick={() => {
            onEditField?.(field.id, null)
            setOpen(false)
          }}
        >
          {translate('auto.components.github.project.ProjectCell.ebde486e3c', 'Clear')}
        </button>
      </PopoverContent>
    </Popover>
  )
}
export function IterationCell({
  row,
  field,
  editable,
  onEditField
}: {
  row: GitHubProjectRow
  field: GitHubProjectField
  editable: boolean
  onEditField?: (fieldId: string, value: GitHubProjectFieldMutationValue | null) => void
}): React.JSX.Element {
  const value = row.fieldValuesByFieldId[field.id]
  const [open, setOpen] = useState(false)
  const iterations = field.kind === 'iteration' ? field.iterations : []
  const completed = iterations.filter((it) => it.completed)
  const active = iterations.filter((it) => !it.completed)
  const label =
    value?.kind === 'iteration' ? (
      <span className="inline-flex items-center gap-1 rounded-md border border-border/50 bg-muted/40 px-1.5 py-0.5 text-xs">
        {value.title}
      </span>
    ) : null
  if (!editable) {
    return <div>{label}</div>
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={field.name}
          className="flex h-full w-full cursor-pointer items-center px-1 text-left"
        >
          {label ?? (
            <EmptyCellPrompt
              label={translate('auto.components.github.project.ProjectCell.e369bf4fec', 'Select')}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1">
        {completed.length > 0 ? (
          <div className="px-2 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {translate('auto.components.github.project.ProjectCell.e17bb96881', 'Completed')}
          </div>
        ) : null}
        {completed.map((it) => (
          <IterationRow
            key={it.id}
            iteration={it}
            onClick={() => {
              onEditField?.(field.id, { kind: 'iteration', iterationId: it.id })
              setOpen(false)
            }}
          />
        ))}
        {active.length > 0 ? (
          <div className="px-2 pt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            {translate(
              'auto.components.github.project.ProjectCell.191905e20e',
              'Current & upcoming'
            )}
          </div>
        ) : null}
        {active.map((it) => (
          <IterationRow
            key={it.id}
            iteration={it}
            onClick={() => {
              onEditField?.(field.id, { kind: 'iteration', iterationId: it.id })
              setOpen(false)
            }}
          />
        ))}
        <button
          type="button"
          className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/50"
          onClick={() => {
            onEditField?.(field.id, null)
            setOpen(false)
          }}
        >
          {translate('auto.components.github.project.ProjectCell.ebde486e3c', 'Clear')}
        </button>
      </PopoverContent>
    </Popover>
  )
}
export function IterationRow({
  iteration,
  onClick
}: {
  iteration: { title: string; startDate: string; duration: number }
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex w-full flex-col items-start rounded px-2 py-1 hover:bg-muted/50"
      onClick={onClick}
    >
      <span className="text-sm">{iteration.title}</span>
      <span className="text-[10px] text-muted-foreground">
        {iteration.startDate} · {iteration.duration}d
      </span>
    </button>
  )
}
