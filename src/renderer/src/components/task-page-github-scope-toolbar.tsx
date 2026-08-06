import type { ComponentProps } from 'react'
import { ExternalLink } from 'lucide-react'

import TaskProjectSourceCombobox from '@/components/task-project-source-combobox'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type { GitHubModeButton, GitHubTaskKind } from './task-page-localized-options'

type PickerProps = ComponentProps<typeof TaskProjectSourceCombobox>
type GitHubMode = GitHubModeButton['id']

type TaskPageGitHubScopeToolbarProps = {
  projectModeVisible: boolean
  githubModeButtons: readonly GitHubModeButton[]
  githubMode: 'items' | 'project'
  activeGithubTaskKind: GitHubTaskKind
  onModeChange: (mode: GitHubMode) => void
  groups: PickerProps['groups']
  selected: PickerProps['selected']
  getRepoHostLabel: PickerProps['getRepoHostLabel']
  onRepoSelectionChange: PickerProps['onChange']
  onSelectAll: PickerProps['onSelectAll']
  selectedGitHubRepoExternalLink: { label: string; url: string } | null
  onOpenExternal: () => void
}

export function TaskPageGitHubScopeToolbar({
  projectModeVisible,
  githubModeButtons,
  githubMode,
  activeGithubTaskKind,
  onModeChange,
  groups,
  selected,
  getRepoHostLabel,
  onRepoSelectionChange,
  onSelectAll,
  selectedGitHubRepoExternalLink,
  onOpenExternal
}: TaskPageGitHubScopeToolbarProps): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      {projectModeVisible ? (
        <div className="flex items-center gap-1 text-xs">
          {githubModeButtons.map((mode) => {
            const active =
              mode.id === 'project'
                ? githubMode === 'project'
                : githubMode === 'items' && activeGithubTaskKind === mode.id
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => onModeChange(mode.id)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs transition',
                  active
                    ? 'border-border/50 bg-foreground/90 text-background'
                    : 'border-border/50 bg-transparent text-foreground hover:bg-muted/50'
                )}
              >
                {mode.label}
              </button>
            )
          })}
        </div>
      ) : null}
      {/* Why: Project rows are repo-scoped, so the selection must stay visible in both GitHub modes. */}
      <div className="min-w-0 max-w-[220px] shrink-0">
        <TaskProjectSourceCombobox
          groups={groups}
          selected={selected}
          getRepoHostLabel={getRepoHostLabel}
          onChange={onRepoSelectionChange}
          onSelectAll={onSelectAll}
          triggerClassName="h-8 w-auto max-w-[220px] rounded-md border border-border/50 bg-muted/50 px-2 text-xs font-medium shadow-sm transition hover:bg-muted/50 focus:ring-2 focus:ring-ring/20 focus:outline-none"
        />
      </div>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            onClick={onOpenExternal}
            aria-label={
              selectedGitHubRepoExternalLink
                ? translate('auto.components.TaskPage.8d1e17a3ef', 'Open {{value0}} in GitHub', {
                    value0: selectedGitHubRepoExternalLink.label
                  })
                : translate(
                    'auto.components.TaskPage.d1132848f8',
                    'Select one GitHub project to open in GitHub'
                  )
            }
            className="h-8 w-8 rounded-md border-border/50 bg-muted/50 text-foreground shadow-sm transition hover:bg-muted/50"
          >
            <ExternalLink className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {selectedGitHubRepoExternalLink
            ? translate('auto.components.TaskPage.8d1e17a3ef', 'Open {{value0}} in GitHub', {
                value0: selectedGitHubRepoExternalLink.label
              })
            : translate(
                'auto.components.TaskPage.bc46d8204e',
                'Select one project to open in GitHub'
              )}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
