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
import { ProjectCell, TitleCell, TypeCell, IssueTypeCell, SingleSelectCell, IterationCell, IterationRow, TextCell, DateCell, LabelChip, UserChip, SINGLE_SELECT_HEX, chipStyle, singleSelectChipColors, labelChipColors, rgbToHsl, hslToCss } from './project-cell-surface'
import type { Props, ChipColors } from './project-cell-surface'
export function AssigneesCell({
  row,
  editable,
  sourceHost,
  sourceSettings,
  onEditAssignees
}: {
  row: GitHubProjectRow
  editable: boolean
  sourceHost?: string
  sourceSettings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  onEditAssignees?: (add: string[], remove: string[]) => void
}): React.JSX.Element {
  const assignees = row.content.assignees
  const [open, setOpen] = useState(false)

  const [owner, repo] = (row.content.repository ?? '').split('/')

  // Why: stabilize the assignee identity used as the seed list. `assignees`
  // is a fresh array every parent render, so depending on it directly would
  // refire the IPC on every unrelated re-render while the popover is open
  // (the same call the rate-limit pill is meant to discourage). Joining the
  // sorted logins gives us a stable string identity.
  const seedKey = React.useMemo(
    () =>
      assignees
        .map((a) => a.login)
        .sort()
        .join(','),
    [assignees]
  )

  const metadata = useRepoAssigneesBySlug(
    open ? owner : null,
    open ? repo : null,
    seedKey ? seedKey.split(',') : [],
    sourceSettings,
    sourceHost
  )

  const labelContent =
    assignees.length === 0 ? null : assignees.map((u) => <UserChip key={u.login} user={u} />)

  if (!editable) {
    return (
      <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
        {labelContent}
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={translate(
            'auto.components.github.project.ProjectCell.f7cdb78efb',
            'Assignees'
          )}
          className={cn(
            'flex h-full w-full flex-wrap items-center gap-1 cursor-pointer px-1 text-xs text-muted-foreground hover:text-foreground'
          )}
        >
          {labelContent ?? (
            <EmptyCellPrompt
              label={translate('auto.components.github.project.ProjectCell.36341ffc66', 'Assign')}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1">
        {!owner || !repo ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {translate(
              'auto.components.github.project.ProjectCell.54cac64427',
              'Row has no repo slug.'
            )}
          </div>
        ) : metadata.loading ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {translate('auto.components.github.project.ProjectCell.2219e945ef', 'Loading…')}
          </div>
        ) : (
          metadata.data.map((u) => {
            const isOn = assignees.some((a) => a.login === u.login)
            return (
              <button
                key={u.login}
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50"
                onClick={() => {
                  if (isOn) {
                    onEditAssignees?.([], [u.login])
                  } else {
                    onEditAssignees?.([u.login], [])
                  }
                }}
              >
                <span
                  className={cn(
                    'inline-block size-2 rounded-full',
                    isOn ? 'bg-primary' : 'bg-muted-foreground/40'
                  )}
                />
                {u.avatarUrl ? (
                  <img src={u.avatarUrl} alt="" className="size-4 rounded-full" />
                ) : null}
                {u.login}
              </button>
            )
          })
        )}
      </PopoverContent>
    </Popover>
  )
}
export function LabelsCell({
  row,
  editable,
  sourceHost,
  sourceSettings,
  onEditLabels
}: {
  row: GitHubProjectRow
  editable: boolean
  sourceHost?: string
  sourceSettings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  onEditLabels?: (add: string[], remove: string[]) => void
}): React.JSX.Element {
  const labels = row.content.labels
  const [open, setOpen] = useState(false)

  const [owner, repo] = (row.content.repository ?? '').split('/')
  const metadata = useRepoLabelsBySlug(
    open ? owner : null,
    open ? repo : null,
    sourceSettings,
    sourceHost
  )

  const labelContent =
    labels.length === 0 ? null : labels.map((l) => <LabelChip key={l.name} label={l} />)

  if (!editable) {
    return <div className="flex flex-wrap items-center gap-1">{labelContent}</div>
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={translate('auto.components.github.project.ProjectCell.8ae56a88a6', 'Labels')}
          className={cn('flex h-full w-full flex-wrap items-center gap-1 cursor-pointer px-1')}
        >
          {labelContent ?? (
            <EmptyCellPrompt
              label={translate(
                'auto.components.github.project.ProjectCell.2e26a06c70',
                'Add label'
              )}
            />
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1">
        {!owner || !repo ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {translate(
              'auto.components.github.project.ProjectCell.54cac64427',
              'Row has no repo slug.'
            )}
          </div>
        ) : metadata.loading ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {translate('auto.components.github.project.ProjectCell.2219e945ef', 'Loading…')}
          </div>
        ) : metadata.data.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {translate(
              'auto.components.github.project.ProjectCell.4b5b871da8',
              'No labels in this repo.'
            )}
          </div>
        ) : (
          metadata.data.map((name) => {
            const isOn = labels.some((l) => l.name === name)
            return (
              <button
                key={name}
                type="button"
                className="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50"
                onClick={() => {
                  if (isOn) {
                    onEditLabels?.([], [name])
                  } else {
                    onEditLabels?.([name], [])
                  }
                }}
              >
                <span
                  className={cn(
                    'inline-block size-2 rounded-full',
                    isOn ? 'bg-primary' : 'bg-muted-foreground/40'
                  )}
                />
                {name}
              </button>
            )
          })
        )}
      </PopoverContent>
    </Popover>
  )
}
export function EmptyCellPrompt({ label }: { label: string }): React.JSX.Element {
  return (
    <span className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-dashed border-border/70 bg-input/30 px-2 text-xs text-muted-foreground/80 shadow-xs hover:border-border hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:hover:bg-input/50">
      <Plus className="size-3 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  )
}
export function colorHex(color: string): string {
  if (!color) {
    return 'inherit'
  }
  if (color.startsWith('#')) {
    return color
  }
  // GitHub returns 6-hex without `#`.
  if (/^[0-9a-fA-F]{6}$/.test(color)) {
    return `#${color}`
  }
  return color
}

// Why: GitHub single-select fields return color as a keyword like "RED" or
// "PURPLE", not a hex value. Map to Primer's dark-mode option palette so we
// can reuse labelChipColors for the chip styling.
