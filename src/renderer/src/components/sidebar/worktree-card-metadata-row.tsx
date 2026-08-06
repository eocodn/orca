import React from 'react'
import { Badge } from '@/components/ui/badge'
import CacheTimer from './CacheTimer'
import { DetachedHeadBadge } from '@/components/DetachedHeadBadge'
import { RepoBadgeMark } from '@/components/repo/RepoBadgeLabel'
import { TruncatedSidebarLabel } from './truncated-sidebar-label'
import { CONFLICT_OPERATION_LABELS } from './WorktreeCardHelpers'
import { GitMerge } from 'lucide-react'
import type { Repo, Worktree } from '../../../../shared/types'
import type { getWorktreeGitIdentityDisplay } from '@/lib/worktree-git-identity-display'

export type WorktreeCardMetadataRowProps = {
  hasMetaRow: boolean
  repo: Repo | undefined
  worktree: Worktree
  showRepoBadgeInMetaRow: boolean
  showHostContextBadge: boolean
  hostContextLabel?: string
  showIdentityInNewCard: boolean
  identityDisplay?: string
  hasHoverDetails: boolean
  isFolder: boolean
  newCardStyle: boolean
  showBranch: boolean
  branch: string
  showDetachedHeadInMetaRow: boolean
  detachedHeadDisplay: NonNullable<ReturnType<typeof getWorktreeGitIdentityDisplay>>
  showConflictOperationBadge: boolean
  conflictOperation: keyof typeof CONFLICT_OPERATION_LABELS
  cacheStartedAt: number | null | undefined
  cacheTtlMs: number
  showMetaRowDetails: boolean
  detailsAndPorts: React.ReactNode
}

export function WorktreeCardMetadataRow({
  hasMetaRow,
  repo,
  worktree,
  showRepoBadgeInMetaRow,
  showHostContextBadge,
  hostContextLabel,
  showIdentityInNewCard,
  identityDisplay,
  hasHoverDetails,
  isFolder,
  newCardStyle,
  showBranch,
  branch,
  showDetachedHeadInMetaRow,
  detachedHeadDisplay,
  showConflictOperationBadge,
  conflictOperation,
  cacheStartedAt,
  cacheTtlMs,
  showMetaRowDetails,
  detailsAndPorts
}: WorktreeCardMetadataRowProps): React.ReactElement | null {
  if (!hasMetaRow) {
    return null
  }
  return (
    <div className="flex items-center gap-1.5 min-w-0" data-worktree-card-meta-row="">
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        {showRepoBadgeInMetaRow && repo && (
          <div className="flex items-center gap-1.5 shrink-0 px-1.5 py-0.5 rounded-[4px] bg-accent border border-border dark:bg-accent/50 dark:border-border/60">
            <RepoBadgeMark color={repo.badgeColor} />
            <span className="text-[10px] font-semibold text-foreground truncate max-w-[6rem] leading-none lowercase">
              {repo.displayName}
            </span>
          </div>
        )}
        {showHostContextBadge && (
          <Badge
            variant="secondary"
            className="h-[16px] max-w-[7rem] shrink-0 rounded border border-border bg-accent px-1.5 text-[10px] font-medium leading-none text-muted-foreground dark:bg-accent/80 dark:border-border/50"
          >
            <span className="truncate">{hostContextLabel}</span>
          </Badge>
        )}
        {showIdentityInNewCard ? (
          <TruncatedSidebarLabel
            text={identityDisplay!}
            className="text-[11px] text-muted-foreground leading-none"
            tooltipEnabled={!hasHoverDetails}
          />
        ) : isFolder && !newCardStyle ? (
          <span
            className="min-w-0 truncate font-mono text-[11px] leading-none text-muted-foreground"
            title={worktree.path}
          >
            {worktree.path.split(/[\\/]+/).at(-1) || worktree.path}
          </span>
        ) : showBranch ? (
          <TruncatedSidebarLabel
            text={branch}
            className="text-[11px] text-muted-foreground leading-none"
            tooltipEnabled={!hasHoverDetails}
          />
        ) : showDetachedHeadInMetaRow && detachedHeadDisplay ? (
          <DetachedHeadBadge
            display={detachedHeadDisplay}
            label="sidebar"
            side="right"
            className="h-[16px]"
          />
        ) : null}
        {showConflictOperationBadge && (
          <Badge
            variant="outline"
            className="h-[16px] px-1.5 text-[10px] font-medium rounded shrink-0 gap-1 text-amber-600 border-amber-500/30 bg-amber-500/5 dark:text-amber-400 dark:border-amber-400/30 dark:bg-amber-400/5 leading-none"
          >
            <GitMerge className="size-2.5" />
            {CONFLICT_OPERATION_LABELS[conflictOperation]}
          </Badge>
        )}
        {cacheStartedAt != null && <CacheTimer startedAt={cacheStartedAt} ttlMs={cacheTtlMs} />}
      </div>
      {showMetaRowDetails && (
        <div className="ml-auto flex shrink-0 items-center gap-1 pr-1.5">{detailsAndPorts}</div>
      )}
    </div>
  )
}
