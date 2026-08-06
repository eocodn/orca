import React from 'react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { ChevronDown, Workflow } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

export type WorktreeCardLineageProps = {
  newCardStyle: boolean
  showLineageChildChip: boolean
  lineageChildAriaLabel: string
  lineageCollapsed: boolean
  onLineageToggle?: (event: React.MouseEvent<HTMLButtonElement>) => void
  childWorkspaceShortLabel: string
  lineageChildren?: React.ReactNode
}

export function WorktreeCardLineage({
  newCardStyle,
  showLineageChildChip,
  lineageChildAriaLabel,
  lineageCollapsed,
  onLineageToggle,
  childWorkspaceShortLabel,
  lineageChildren
}: WorktreeCardLineageProps): React.ReactElement {
  return (
    <>
      {showLineageChildChip && (
        <div
          className={cn('relative mt-1 flex min-w-0 justify-start', !newCardStyle && '-ml-1')}
          style={{
            color: 'color-mix(in srgb, var(--muted-foreground) 42%, var(--worktree-sidebar))'
          }}
        >
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                className="relative z-10 h-[18px] max-w-[8rem] gap-1 rounded-md border border-worktree-sidebar-border bg-worktree-sidebar px-1.5 text-[10px] font-medium leading-none text-muted-foreground shadow-none hover:bg-worktree-sidebar-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-worktree-sidebar-ring"
                aria-label={lineageChildAriaLabel}
                aria-expanded={!lineageCollapsed}
                onClick={onLineageToggle}
              >
                <Workflow className="size-2.5" />
                <span className="truncate">{childWorkspaceShortLabel}</span>
                <ChevronDown
                  className={cn('size-2.5 transition-transform', lineageCollapsed && '-rotate-90')}
                />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8}>
              {lineageCollapsed
                ? translate(
                    'auto.components.sidebar.WorktreeCard.8cb634cda6',
                    'Show child workspaces'
                  )
                : translate(
                    'auto.components.sidebar.WorktreeCard.57eaa61b55',
                    'Hide child workspaces'
                  )}
            </TooltipContent>
          </Tooltip>
        </div>
      )}

      {!newCardStyle && lineageChildren && (
        <div className="-ml-[1.125rem] mt-1.5 w-[calc(100%+1.125rem)] space-y-1">
          {lineageChildren}
        </div>
      )}
    </>
  )
}
