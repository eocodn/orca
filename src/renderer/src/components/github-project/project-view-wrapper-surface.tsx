// Concrete surface implementation for ProjectViewWrapper.tsx
// Top-level Project-mode container; interaction states per the design doc.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ExternalLink,
  RefreshCw,
  KanbanSquare,
  Map as MapIcon,
  Search,
  Table as TableIcon,
  X
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import GitHubItemDialog, { type GitHubItemDialogProjectOrigin } from '@/components/GitHubItemDialog'
import { GhAuthErrorHelp } from '@/components/github-project/GhAuthErrorHelp'
import { launchWorkItemDirect } from '@/lib/launch-work-item-direct'
import { useRepoSlugIndex } from '@/lib/repo-slug-index'
import { cn } from '@/lib/utils'
import { callRuntimeRpc, getActiveRuntimeTarget } from '@/runtime/runtime-rpc-client'
import { useProjectViewController } from './use-project-view-controller'
import { ProjectViewWrapperView } from './project-view-wrapper-view'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { projectViewCacheKey } from '@/store/slices/github'
import type {
  GetProjectViewTableResult,
  GitHubIssueType,
  GitHubProjectFieldMutationValue,
  GitHubProjectRow,
  GitHubProjectTable,
  GitHubProjectViewError,
  GitHubProjectViewSummary,
  ListProjectViewsResult
} from '../../../../shared/github-project-types'
import type { GitHubWorkItem } from '../../../../shared/types'
import ProjectPicker, { type ResolvedProjectSelection } from './ProjectPicker'
import ProjectViewList from './ProjectViewList'
import ProjectItemSlugDialog from './ProjectItemSlugDialog'
import {
  filterProjectTableRowsBySelectedRepos,
  resolveSelectedProjectRowRepo
} from './project-row-filtering'
import {
  resolveMissingRepoProjectDialogState,
  resolveRepoBackedProjectDialogState
} from './project-dialog-state'
import {
  getSelectedRepoFingerprint,
  getNextVisibleProjectTableCache,
  getVisibleProjectTable,
  type CachedVisibleProjectTable
} from './project-visible-table-cache'
import { translate } from '@/i18n/i18n'
import { buildTaskSourceContextFromRepo } from '../../../../shared/task-source-context'
import {
  githubProjectHost,
  githubProjectIdentityKey
} from '../../../../shared/github-project-identity'

export type Props = {
  selectedRepoIds: ReadonlySet<string>
}

const ORCA_FEATURE_REQUEST_URL = 'https://github.com/stablyai/orca/issues/new'

export function listProjectViewsForRuntime(
  settings: Parameters<typeof getActiveRuntimeTarget>[0],
  args: {
    owner: string
    ownerType: 'organization' | 'user'
    projectNumber: number
    host?: string
  }
): Promise<ListProjectViewsResult> {
  const target = getActiveRuntimeTarget(settings)
  return target.kind === 'environment'
    ? callRuntimeRpc<ListProjectViewsResult>(target, 'github.project.listViews', args, {
        timeoutMs: 30_000
      })
    : window.api.gh.listProjectViews(args)
}

export function getProjectViewSourceScope(settings: Parameters<typeof getActiveRuntimeTarget>[0]): string {
  const target = getActiveRuntimeTarget(settings)
  return target.kind === 'environment' ? `runtime:${target.environmentId}` : 'local'
}

export function buildProjectWorkItem(
  row: GitHubProjectRow,
  repoId: string,
  host?: string
): GitHubWorkItem | null {
  if (row.itemType !== 'ISSUE' && row.itemType !== 'PULL_REQUEST') {
    return null
  }
  if (row.content.number == null || !row.content.url) {
    return null
  }
  const [owner, repo] = row.content.repository?.split('/') ?? []
  // Why: Project rows can reach mutation controls before detail hydration, so
  // preserve their host-bearing repository identity on the initial item.
  const prRepo = owner && repo ? { owner, repo, host: githubProjectHost(host) } : undefined
  return {
    id: `${row.itemType === 'PULL_REQUEST' ? 'pr' : 'issue'}:${row.content.number}`,
    type: row.itemType === 'PULL_REQUEST' ? 'pr' : 'issue',
    number: row.content.number,
    title: row.content.title,
    state:
      row.content.state === 'MERGED'
        ? 'merged'
        : row.content.state === 'CLOSED'
          ? 'closed'
          : row.content.isDraft
            ? 'draft'
            : 'open',
    url: row.content.url,
    labels: row.content.labels.map((label) => label.name),
    updatedAt: row.updatedAt,
    author: null,
    repoId,
    prRepo
  }
}

export default function ProjectViewWrapper({ selectedRepoIds }: Props): React.JSX.Element {
  const controller = useProjectViewController(selectedRepoIds)
  return <ProjectViewWrapperView {...controller} />
}

// Why: keeps the input string local so typing doesn't re-render the parent/table; the parent only learns it on apply (Enter/blur/clear).
export function ProjectSearchInput({
  viewFilter,
  appliedOverride,
  onApply
}: {
  viewFilter: string
  appliedOverride: string | undefined
  onApply: (nextOverride: string | undefined) => void
}): React.JSX.Element {
  const initial = appliedOverride !== undefined ? appliedOverride : viewFilter
  const [value, setValue] = useState<string>(initial)
  const inputRef = useRef<HTMLInputElement>(null)
  const applied = appliedOverride !== undefined ? appliedOverride : viewFilter
  const dirty = value !== applied

  const apply = (next: string): void => {
    // Why: reverting to the view's stored filter drops the override so the cache key collapses to the unfiltered entry.
    onApply(next === viewFilter ? undefined : next)
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const isMac = navigator.userAgent.includes('Mac')
      const modifierPressed = isMac ? event.metaKey : event.ctrlKey
      if (!modifierPressed || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'f') {
        return
      }
      if (document.querySelector('[role="dialog"]')) {
        return
      }

      const input = inputRef.current
      if (!input) {
        return
      }
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target !== input &&
        (target instanceof HTMLInputElement ||
          target instanceof HTMLTextAreaElement ||
          target.isContentEditable)
      ) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      input.focus()
      input.select()
    }

    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [])

  return (
    <div className="relative min-w-0 max-w-xl flex-1 basis-64">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        ref={inputRef}
        data-github-project-search-input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            if (e.nativeEvent.isComposing) {
              return
            }
            e.preventDefault()
            apply(value)
          } else if (e.key === 'Escape') {
            setValue(applied)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        onBlur={() => {
          if (dirty) {
            apply(value)
          }
        }}
        placeholder={
          viewFilter ||
          translate(
            'auto.components.github.project.ProjectViewWrapper.067119985c',
            'GitHub search, e.g. assignee:@me is:open'
          )
        }
        title={
          viewFilter
            ? translate(
                'auto.components.github.project.ProjectViewWrapper.c5bc7ec007',
                'View filter: {{value0}}',
                { value0: viewFilter }
              )
            : undefined
        }
        className={cn(
          'h-7 rounded-md border-border/50 bg-background pl-8 pr-7 text-[11px]',
          dirty && 'border-amber-500/50'
        )}
      />
      {value ? (
        <button
          type="button"
          aria-label={translate(
            'auto.components.github.project.ProjectViewWrapper.7245c3d7ac',
            'Clear search'
          )}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setValue('')
            apply('')
          }}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  )
}

export function ViewTabStrip({
  views,
  activeViewId,
  onPick
}: {
  views: GitHubProjectViewSummary[]
  activeViewId: string | null
  onPick: (viewId: string) => void
}): React.JSX.Element {
  // Why: emulate GitHub Projects' tab strip; non-table layouts stay visible but disabled.
  return (
    <div className="project-view-tab-strip flex min-h-[41px] min-w-0 flex-none items-end gap-1 overflow-x-auto overflow-y-hidden border-b border-border/50 bg-muted/20 px-3 pt-3">
      {views.map((v) => {
        const supported = v.layout === 'TABLE_LAYOUT'
        const active = v.id === activeViewId
        const layoutLabel =
          v.layout === 'BOARD_LAYOUT'
            ? 'Board'
            : v.layout === 'ROADMAP_LAYOUT'
              ? 'Roadmap'
              : 'Table'
        const Icon =
          v.layout === 'BOARD_LAYOUT'
            ? KanbanSquare
            : v.layout === 'ROADMAP_LAYOUT'
              ? MapIcon
              : TableIcon
        const tab = (
          <button
            key={v.id}
            type="button"
            disabled={!supported}
            onClick={() => onPick(v.id)}
            title={
              supported
                ? v.name
                : translate(
                    'auto.components.github.project.ProjectViewWrapper.2edf5e7e77',
                    "{{value0}} — Orca doesn't support {{value1}} project views yet. File a feature request at {{value2}}.",
                    { value0: v.name, value1: layoutLabel, value2: ORCA_FEATURE_REQUEST_URL }
                  )
            }
            className={cn(
              'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-t-md border-x border-t px-3 py-1.5 text-xs',
              active
                ? '-mb-px border-border/60 bg-background text-foreground'
                : 'border-transparent text-muted-foreground hover:bg-background/40 hover:text-foreground',
              !supported &&
                'pointer-events-none cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground'
            )}
          >
            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
            <span className={cn(active && 'font-medium')}>{v.name}</span>
          </button>
        )
        if (supported) {
          return tab
        }
        const unsupportedMessage = `Orca doesn't support ${layoutLabel} project views yet.`
        return (
          <HoverCard key={v.id} openDelay={200} closeDelay={100}>
            <HoverCardTrigger asChild>
              <span
                tabIndex={0}
                aria-label={translate(
                  'auto.components.github.project.ProjectViewWrapper.55de4fb57a',
                  '{{value0}}. {{value1}} File a feature request at {{value2}}.',
                  { value0: v.name, value1: unsupportedMessage, value2: ORCA_FEATURE_REQUEST_URL }
                )}
                className="inline-flex shrink-0 cursor-not-allowed rounded-t-md outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {tab}
              </span>
            </HoverCardTrigger>
            <HoverCardContent side="bottom" align="start" sideOffset={8} className="w-72 p-3">
              <div className="space-y-2">
                <p className="text-xs leading-5 text-muted-foreground">
                  {unsupportedMessage}{' '}
                  {translate(
                    'auto.components.github.project.ProjectViewWrapper.1bf8c01c8b',
                    'Switch to a Table view to work with this project in Orca.'
                  )}
                </p>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => void window.api.shell.openUrl(ORCA_FEATURE_REQUEST_URL)}
                >
                  {translate(
                    'auto.components.github.project.ProjectViewWrapper.4d2a77a119',
                    'File feature request'
                  )}
                  <ExternalLink className="size-3" />
                </Button>
              </div>
            </HoverCardContent>
          </HoverCard>
        )
      })}
    </div>
  )
}

export function ErrorState({
  error,
  totalCount,
  host,
  onOpenInGitHub
}: {
  error: GitHubProjectViewError
  totalCount?: number
  host?: string
  onOpenInGitHub: () => void
}): React.JSX.Element {
  // Auth/scope errors get a richer `gh auth status` remediation UI; bail early before the generic block.
  if (error.type === 'auth_required' || error.type === 'scope_missing') {
    return (
      <div className="flex flex-1 flex-col items-start gap-3 p-6 text-sm">
        <GhAuthErrorHelp
          error={error as GitHubProjectViewError & { type: 'auth_required' | 'scope_missing' }}
          host={host}
        />
        <Button size="sm" variant="outline" onClick={onOpenInGitHub}>
          <ExternalLink className="mr-1 size-3.5" />{' '}
          {translate(
            'auto.components.github.project.ProjectViewWrapper.23b87ba9f7',
            'Open in GitHub'
          )}
        </Button>
      </div>
    )
  }
  const copy =
    error.type === 'too_large'
      ? `This view has ${totalCount ?? 'many'} items — too large to render in Orca. Narrow the view's filter on GitHub.`
      : error.type === 'unsupported_layout'
        ? 'Orca only renders table views yet. This is a Board or Roadmap view.'
        : error.type === 'not_found'
          ? 'Could not find this project or view.'
          : error.type === 'schema_drift'
            ? 'Could not read this project view.'
            : error.message
  return (
    <div className="flex flex-1 flex-col items-start gap-3 p-6 text-sm">
      <div className="text-muted-foreground">{copy}</div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={onOpenInGitHub}>
          <ExternalLink className="mr-1 size-3.5" />{' '}
          {translate(
            'auto.components.github.project.ProjectViewWrapper.23b87ba9f7',
            'Open in GitHub'
          )}
        </Button>
      </div>
    </div>
  )
}

// Why: mirror ProjectViewList's header + 12 rows so the table doesn't jump in height when real data lands.
export function ProjectTableSkeleton(): React.JSX.Element {
  const headerCols = 6
  const bodyCols = 5
  return (
    <div
      aria-busy="true"
      aria-label={translate(
        'auto.components.github.project.ProjectViewWrapper.463f1205c0',
        'Loading project view'
      )}
      className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      <div className="grid items-center gap-3 border-b border-border/60 bg-background/95 px-3 py-2">
        <div
          className="grid items-center gap-3"
          style={{
            gridTemplateColumns: `repeat(${headerCols}, minmax(0, 1fr))`
          }}
        >
          {Array.from({ length: headerCols }).map((_, i) => (
            <div key={i} className="h-3 w-20 animate-pulse rounded bg-muted/70" />
          ))}
        </div>
      </div>
      <div className="divide-y divide-border/30">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="grid min-h-10 items-center gap-3 px-3 py-2"
            style={{ gridTemplateColumns: `repeat(${bodyCols}, minmax(0, 1fr))` }}
          >
            <div className="h-4 w-3/5 animate-pulse rounded bg-muted/70" />
            <div className="h-4 w-4/5 animate-pulse rounded bg-muted/70" />
            <div className="h-4 w-2/5 animate-pulse rounded-full bg-muted/60" />
            <div className="h-4 w-3/5 animate-pulse rounded bg-muted/60" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-muted/60" />
          </div>
        ))}
      </div>
    </div>
  )
}
