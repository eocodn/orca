import React from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Repo } from '../../../../shared/types'
import { translate } from '@/i18n/i18n'

// Why: pinned repo icon and compact inline badge share this chip shell so both repo cues read as the same affordance.
export function RepoIdentityChip({
  repo,
  children
}: {
  repo: Repo
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-worktree-sidebar-border bg-worktree-sidebar-accent/55"
          aria-label={translate(
            'auto.components.sidebar.WorktreeCard.35ccfe2475',
            'Project {{value0}}',
            { value0: repo.displayName }
          )}
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {repo.displayName}
      </TooltipContent>
    </Tooltip>
  )
}
