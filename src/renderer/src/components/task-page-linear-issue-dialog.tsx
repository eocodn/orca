import type React from 'react'
import { Check, ChevronDown, LoaderCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type { LinearTeam } from '../../../shared/types'
import {
  TaskPageLinearIssueForm,
  type TaskPageLinearIssueFormContext
} from './task-page-linear-issue-form'

type Setter<T> = React.Dispatch<React.SetStateAction<T>>

export type TaskPageLinearIssueDialogContext = TaskPageLinearIssueFormContext & {
  newLinearIssueOpen: boolean
  setNewLinearIssueOpen: Setter<boolean>
  isScreenSubmitShortcut: (event: React.KeyboardEvent) => boolean
  handleCreateNewLinearIssue: () => Promise<void>
  availableTeams: LinearTeam[]
  newLinearIssueTargetTeam: LinearTeam | null
  newLinearIssueTeamId: string | null
  setNewLinearIssueTeamId: Setter<string | null>
}

export function TaskPageLinearIssueDialog({
  context
}: {
  context: TaskPageLinearIssueDialogContext
}): React.JSX.Element {
  const {
    newLinearIssueOpen,
    setNewLinearIssueOpen,
    newLinearIssueSubmitting,
    isScreenSubmitShortcut,
    handleCreateNewLinearIssue,
    availableTeams,
    newLinearIssueTargetTeam,
    newLinearIssueTeamId
  } = context

  return (
    <Dialog
      open={newLinearIssueOpen}
      onOpenChange={(open) => {
        if (!newLinearIssueSubmitting) {
          setNewLinearIssueOpen(open)
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="flex flex-col gap-0 overflow-hidden rounded-xl border-border bg-background p-0 shadow-2xl sm:max-w-2xl"
        onKeyDown={(event) => {
          if (isScreenSubmitShortcut(event)) {
            event.preventDefault()
            void handleCreateNewLinearIssue()
          }
        }}
      >
        <div className="flex items-center justify-between border-b border-border/60 bg-muted/10 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {translate('auto.components.TaskPage.c11105dac5', 'New Issue')}
            </span>
            <span className="text-xs text-muted-foreground/40">/</span>
            {availableTeams.length > 1 ? (
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="h-7 gap-1 px-2 text-xs font-medium text-foreground hover:bg-muted"
                  >
                    {newLinearIssueTargetTeam?.key ??
                      translate('auto.components.TaskPage.d7f16d0e32', 'Select Team')}
                    <ChevronDown className="size-3 text-muted-foreground" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-64 p-1">
                  <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {translate('auto.components.TaskPage.4f3cb99f41', 'Switch Team')}
                  </div>
                  {availableTeams.map((team) => (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => context.setNewLinearIssueTeamId(team.id)}
                      className={cn(
                        'flex w-full items-center justify-between rounded-sm px-2 py-1.5 text-left text-xs transition-colors hover:bg-muted',
                        newLinearIssueTeamId === team.id ? 'bg-muted font-medium' : ''
                      )}
                    >
                      <span>
                        {team.key} — {team.name}
                      </span>
                      {newLinearIssueTeamId === team.id ? <Check className="size-3" /> : null}
                    </button>
                  ))}
                </PopoverContent>
              </Popover>
            ) : (
              <span className="text-xs font-medium text-foreground">
                {newLinearIssueTargetTeam?.key ?? ''} — {newLinearIssueTargetTeam?.name ?? ''}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={() => setNewLinearIssueOpen(false)}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground"
            disabled={newLinearIssueSubmitting}
          >
            <X className="size-4" />
          </button>
        </div>

        <TaskPageLinearIssueForm context={context} />

        <div className="flex items-center justify-between border-t border-border/60 bg-muted/5 px-6 py-4">
          <span className="text-[10px] font-medium text-muted-foreground/60">
            {context.submitShortcutLabel}{' '}
            {translate('auto.components.TaskPage.fc0d8a1fa4', 'to submit.')}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNewLinearIssueOpen(false)}
              disabled={newLinearIssueSubmitting}
              className="h-8 text-xs text-muted-foreground hover:text-foreground"
            >
              {translate('auto.components.TaskPage.ff69a30681', 'Cancel')}
            </Button>
            <Button
              size="sm"
              onClick={() => void handleCreateNewLinearIssue()}
              disabled={
                !newLinearIssueTargetTeam ||
                !context.newLinearIssueTitle.trim() ||
                newLinearIssueSubmitting
              }
              className="h-8 bg-foreground text-xs text-background hover:bg-foreground/90 disabled:opacity-50"
            >
              {newLinearIssueSubmitting ? (
                <>
                  <LoaderCircle className="mr-1 size-3.5 animate-spin" />
                  {translate('auto.components.TaskPage.8ff6fdc368', 'Creating…')}
                </>
              ) : (
                translate('auto.components.TaskPage.e15ba2d2eb', 'Create issue')
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
