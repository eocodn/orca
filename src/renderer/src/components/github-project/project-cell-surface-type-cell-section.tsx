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
import { ProjectCell, TitleCell, SingleSelectCell, IterationCell, IterationRow, TextCell, DateCell, LabelChip, UserChip, AssigneesCell, LabelsCell, EmptyCellPrompt, colorHex, SINGLE_SELECT_HEX, chipStyle, singleSelectChipColors, labelChipColors, rgbToHsl, hslToCss } from './project-cell-surface'
import type { Props, ChipColors } from './project-cell-surface'
export function TypeCell({
  row,
  editable,
  sourceHost,
  sourceSettings,
  onEditIssueType
}: {
  row: GitHubProjectRow
  editable: boolean
  sourceHost?: string
  sourceSettings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  onEditIssueType?: (issueType: GitHubIssueType | null) => void
}): React.JSX.Element {
  // Why: for issues we surface the repo's `issueType` (Bug/Feature/Task etc)
  // when set — that's the editable taxonomy. PR/Draft/Restricted rows render
  // the static itemType glyph because there's no equivalent editable type.
  if (row.itemType === 'ISSUE') {
    return (
      <IssueTypeCell
        row={row}
        editable={editable}
        sourceHost={sourceHost}
        sourceSettings={sourceSettings}
        onEditIssueType={onEditIssueType}
      />
    )
  }
  const meta =
    row.itemType === 'PULL_REQUEST'
      ? {
          Icon: GitPullRequest,
          label: translate('auto.components.github.project.ProjectCell.d0d0e13a5a', 'PR')
        }
      : row.itemType === 'DRAFT_ISSUE'
        ? {
            Icon: FileText,
            label: translate('auto.components.github.project.ProjectCell.6efdc0d920', 'Draft')
          }
        : {
            Icon: Lock,
            label: translate('auto.components.github.project.ProjectCell.8d669084f6', 'Restricted')
          }
  const { Icon, label } = meta
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </span>
  )
}
export function IssueTypeCell({
  row,
  editable,
  sourceHost,
  sourceSettings,
  onEditIssueType
}: {
  row: GitHubProjectRow
  editable: boolean
  sourceHost?: string
  sourceSettings: Pick<GlobalSettings, 'activeRuntimeEnvironmentId'> | null | undefined
  onEditIssueType?: (issueType: GitHubIssueType | null) => void
}): React.JSX.Element {
  const issueType = row.content.issueType
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<GitHubIssueType[]>([])
  const [loading, setLoading] = useState(false)
  const [owner, repo] = (row.content.repository ?? '').split('/')
  const { lookupSlug } = useRepoSlugIndex()
  const matchedRepo = useMemo(
    () => lookupSlug(row.content.repository, sourceHost)[0] ?? null,
    [lookupSlug, row.content.repository, sourceHost]
  )
  const ownerSettings = useAppStore(
    useShallow((s) => getSettingsForRepoRuntimeOwner(s, matchedRepo?.id ?? null))
  )

  React.useEffect(() => {
    if (!open || !owner || !repo) {
      return
    }
    let cancelled = false
    setLoading(true)
    const target = getActiveRuntimeTarget(matchedRepo ? ownerSettings : sourceSettings)
    const request =
      target.kind === 'environment'
        ? callRuntimeRpc<ListIssueTypesBySlugResult>(
            target,
            'github.project.listIssueTypesBySlug',
            { owner, repo, ...(sourceHost ? { host: sourceHost } : {}) },
            { timeoutMs: 30_000 }
          )
        : window.api.gh.listIssueTypesBySlug({
            owner,
            repo,
            ...(sourceHost ? { host: sourceHost } : {})
          })
    request
      .then((res) => {
        if (cancelled) {
          return
        }
        if (res.ok) {
          setOptions(res.types)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [matchedRepo, open, owner, ownerSettings, repo, sourceHost, sourceSettings])

  const trigger = (
    <span className="inline-flex items-center gap-1 text-xs">
      <CircleDot className="size-3.5 shrink-0 text-muted-foreground" />
      {issueType ? (
        (() => {
          const colors = singleSelectChipColors(issueType.color ?? '')
          return (
            <span
              className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium leading-none text-[var(--github-project-chip-fg-light)] dark:text-[var(--github-project-chip-fg-dark)]"
              style={chipStyle(colors)}
            >
              {issueType.name}
            </span>
          )
        })()
      ) : (
        <span className="text-muted-foreground">
          {translate('auto.components.github.project.ProjectCell.c5f949e489', 'Issue')}
        </span>
      )}
    </span>
  )

  if (!editable) {
    return <div>{trigger}</div>
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={translate(
            'auto.components.github.project.ProjectCell.c7b059cf07',
            'Issue type'
          )}
          className="flex h-full w-full cursor-pointer items-center px-1 text-left"
        >
          {trigger}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-64 p-1" align="start">
        {!owner || !repo ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {translate(
              'auto.components.github.project.ProjectCell.54cac64427',
              'Row has no repo slug.'
            )}
          </div>
        ) : loading ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {translate('auto.components.github.project.ProjectCell.2219e945ef', 'Loading…')}
          </div>
        ) : options.length === 0 ? (
          <div className="px-2 py-1 text-xs text-muted-foreground">
            {translate(
              'auto.components.github.project.ProjectCell.943b3dadc9',
              'This repo has no Issue Types.'
            )}
          </div>
        ) : (
          options.map((t) => (
            <button
              key={t.id}
              type="button"
              className="flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs hover:bg-muted/50"
              onClick={() => {
                onEditIssueType?.(t)
                setOpen(false)
              }}
            >
              <span
                className="mt-1 inline-block size-2 shrink-0 rounded-full"
                style={{ background: colorHex(t.color ?? '') || '#8b949e' }}
              />
              <span className="min-w-0">
                <span className="block truncate">{t.name}</span>
                {t.description ? (
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {t.description}
                  </span>
                ) : null}
              </span>
            </button>
          ))
        )}
        {issueType ? (
          <button
            type="button"
            className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted/50"
            onClick={() => {
              onEditIssueType?.(null)
              setOpen(false)
            }}
          >
            {translate('auto.components.github.project.ProjectCell.ebde486e3c', 'Clear')}
          </button>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
