import React from 'react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Star, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

export type WorktreeCardHeaderActionsProps = {
  showHeaderActions: boolean
  showTitleRowPrimary: boolean
  showDeleteQuickAction: boolean
  stopQuickActionPointerPropagation: (event: React.PointerEvent<HTMLButtonElement>) => void
  handleWorkspaceQuickAction: (event: React.MouseEvent<HTMLButtonElement>) => void
}

export function WorktreeCardHeaderActions({
  showHeaderActions,
  showTitleRowPrimary,
  showDeleteQuickAction,
  stopQuickActionPointerPropagation,
  handleWorkspaceQuickAction
}: WorktreeCardHeaderActionsProps): React.ReactElement | null {
  if (!showHeaderActions) {
    return null
  }
  return (
    <div className="ml-auto flex shrink-0 items-center justify-center gap-1 pr-1.5">
      {showTitleRowPrimary && (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              className="shrink-0 inline-flex items-center"
              aria-label={translate(
                'auto.components.sidebar.WorktreeCard.0d224eff10',
                'Primary worktree'
              )}
            >
              <Star className="size-3 fill-amber-400 text-amber-400" />
            </span>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {translate(
              'auto.components.sidebar.WorktreeCard.0777de5970',
              'Primary worktree (original clone directory)'
            )}
          </TooltipContent>
        </Tooltip>
      )}

      {showDeleteQuickAction && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              data-workspace-board-preserve-open=""
              onPointerDown={stopQuickActionPointerPropagation}
              onClick={handleWorkspaceQuickAction}
              className={cn(
                'inline-flex size-4 items-center justify-center rounded bg-transparent opacity-0 transition-colors transition-opacity',
                'group-hover/worktree-card:opacity-100 group-focus-within/worktree-card:opacity-100 focus-visible:opacity-100',
                'text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:bg-destructive/10 focus-visible:text-destructive'
              )}
              aria-label={translate(
                'auto.components.sidebar.WorktreeCard.6f09f58541',
                'Delete workspace'
              )}
            >
              <Trash2 className="size-3.5" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" sideOffset={8}>
            {translate('auto.components.sidebar.WorktreeCard.6f09f58541', 'Delete workspace')}
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
