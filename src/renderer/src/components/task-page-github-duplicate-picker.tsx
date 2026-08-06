import type React from 'react'
import { CheckCircle2, CircleDot, ChevronLeft, Copy, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { translate } from '@/i18n/i18n'
import type { GitHubWorkItem } from '../../../shared/types'

export type TaskPageGitHubDuplicatePickerProps = {
  title: string
  search: string
  onSearchChange: (value: string) => void
  error: string | null
  directTarget: number | null
  candidates: GitHubWorkItem[]
  onSubmitSearch: () => void
  onSelectDuplicate: (number: number) => void
  onBack: () => void
}

export function TaskPageGitHubDuplicatePicker({
  title,
  search,
  onSearchChange,
  error,
  directTarget,
  candidates,
  onSubmitSearch,
  onSelectDuplicate,
  onBack
}: TaskPageGitHubDuplicatePickerProps): React.JSX.Element {
  return (
    <div>
      <div className="flex items-center gap-2 px-1 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="size-7"
          onClick={onBack}
          aria-label={translate('auto.components.TaskPage.backToCloseReasons', 'Back')}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <span className="min-w-0 truncate text-[12px] font-semibold">{title}</span>
      </div>
      <div className="relative px-1 pb-2">
        <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input
          autoFocus
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onSubmitSearch()
            }
          }}
          placeholder={translate('auto.components.TaskPage.searchIssues', 'Search issues')}
          className="h-9 pl-8 text-[12px]"
          aria-invalid={error ? true : undefined}
        />
      </div>
      {error ? <p className="px-2 pb-2 text-[11px] text-destructive">{error}</p> : null}
      <div className="scrollbar-sleek max-h-72 overflow-y-auto pr-1">
        {directTarget ? (
          <button
            type="button"
            onClick={() => onSelectDuplicate(directTarget)}
            className="flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left hover:bg-accent"
          >
            <Copy className="size-4 text-primary" />
            <span className="min-w-0 flex-1 text-[12px] font-medium">
              {translate('auto.components.TaskPage.useIssueNumber', 'Use issue #{{value0}}', {
                value0: directTarget
              })}
            </span>
          </button>
        ) : null}
        {candidates.map((candidate) => (
          <button
            key={`${candidate.repoId}:${candidate.number}`}
            type="button"
            onClick={() => onSelectDuplicate(candidate.number)}
            className="flex w-full items-start gap-2 rounded-sm px-2 py-2 text-left hover:bg-accent"
          >
            {candidate.state === 'closed' ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
            ) : (
              <CircleDot className="mt-0.5 size-4 shrink-0 text-emerald-500" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-medium leading-snug">{candidate.title}</span>
            </span>
            <span className="shrink-0 text-[12px] text-muted-foreground">#{candidate.number}</span>
          </button>
        ))}
        {!directTarget && candidates.length === 0 ? (
          <p className="px-2 py-3 text-[12px] text-muted-foreground">
            {translate(
              'auto.components.TaskPage.noMatchingIssuesLoaded',
              'No matching issues loaded.'
            )}
          </p>
        ) : null}
      </div>
    </div>
  )
}
