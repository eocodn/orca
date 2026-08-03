import React from 'react'
import { ArrowRight, Check, ChevronDown, ChevronLeft, ChevronRight, CircleDashed, CircleDot, Copy, FolderKanban, LoaderCircle, Pencil, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { GitHubLabelsSettingsLink } from './github-item-dialog-labels-link'
import type { GitHubAssignableUser, GitHubWorkItem } from '../../../shared/types'

type GitHubItemEditLayoutProps = {
  item: GitHubWorkItem
  localState: GitHubWorkItem['state']
  localLabels: string[]
  localAssignees: string[]
  attachedWorkspaceLabel?: string | null
  hasAttachedWorkspace: boolean
  isPending: (key: 'state' | 'labels' | 'assignees') => boolean
  repoLabels: { loading: boolean; error?: string | null; data: string[] }
  repoAssignees: { loading: boolean; error?: string | null; data: GitHubAssignableUser[] }
  repositoryLabelsUrl: string | null
  labelPopoverOpen: boolean
  assigneePopoverOpen: boolean
  setLabelPopoverOpen: (open: boolean) => void
  setAssigneePopoverOpen: (open: boolean) => void
  handleLabelToggle: (label: string) => void
  handleAssigneeToggle: (login: string) => void
  handleOpenOrUseWorkspace: () => void
  onUse: (item: GitHubWorkItem) => void
  renderIssueStatusPopover: (variant: 'sidebar' | 'pill') => React.JSX.Element
}

export function GitHubItemEditTopColumns({
  item,
  localState,
  localLabels,
  localAssignees,
  attachedWorkspaceLabel,
  isPending,
  repoLabels,
  repoAssignees,
  repositoryLabelsUrl,
  labelPopoverOpen,
  assigneePopoverOpen,
  setLabelPopoverOpen,
  setAssigneePopoverOpen,
  handleLabelToggle,
  handleAssigneeToggle,
  renderIssueStatusPopover
}: GitHubItemEditLayoutProps): React.JSX.Element {
const checkIcon = (
    <svg className="size-2.5" viewBox="0 0 12 12" fill="none">
      <path
        d="M2 6l3 3 5-5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
  return (
      <aside className="grid grid-cols-2 gap-x-6 gap-y-5 text-[13px] sm:grid-cols-4">
        {/* State */}
        <section className="min-w-0">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            {translate('auto.components.GitHubItemDialog.00ccdf9b5a', 'Status')}
          </div>
          {renderIssueStatusPopover('sidebar')}
        </section>

        {/* Assignees */}
        <section className="min-w-0">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            <span>{translate('auto.components.GitHubItemDialog.83ac703dda', 'Assignees')}</span>
            <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={isPending('assignees') || repoAssignees.loading}
                  aria-label={translate(
                    'auto.components.GitHubItemDialog.76adcf5fe2',
                    'Edit assignees'
                  )}
                  className="rounded p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {isPending('assignees') ? (
                    <LoaderCircle className="size-3 animate-spin" />
                  ) : (
                    <Pencil className="size-3" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="popover-scroll-content scrollbar-sleek w-60 p-1"
                align="end"
              >
                {repoAssignees.error ? (
                  <div className="px-2 py-3 text-center text-[12px] text-destructive">
                    {repoAssignees.error}
                  </div>
                ) : (
                  <div>
                    {repoAssignees.data.map((user) => (
                      <button
                        key={user.login}
                        type="button"
                        onClick={() => handleAssigneeToggle(user.login)}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent"
                      >
                        <span
                          className={cn(
                            'flex size-3.5 items-center justify-center rounded-sm border',
                            localAssignees.includes(user.login)
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input'
                          )}
                        >
                          {localAssignees.includes(user.login) && checkIcon}
                        </span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate">{user.login}</span>
                          {user.name && (
                            <span className="block truncate text-[11px] text-muted-foreground">
                              {user.name}
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </PopoverContent>
            </Popover>
          </div>
          {localAssignees.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">
              {translate('auto.components.GitHubItemDialog.c67de9e2fe', 'No one assigned')}
            </div>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {localAssignees.map((login) => {
                const user = repoAssignees.data.find((u) => u.login === login)
                return (
                  <li key={login} className="flex min-w-0 items-center gap-2">
                    {user?.avatarUrl ? (
                      <img
                        src={user.avatarUrl}
                        alt=""
                        className="size-5 shrink-0 rounded-full border border-border/40 object-cover"
                      />
                    ) : (
                      <div className="size-5 shrink-0 rounded-full bg-muted" />
                    )}
                    <span className="min-w-0 truncate text-[12px] font-medium text-foreground">
                      {login}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Labels */}
        <section className="min-w-0">
          <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            <span>{translate('auto.components.GitHubItemDialog.217e55d87c', 'Labels')}</span>
            <Popover open={labelPopoverOpen} onOpenChange={setLabelPopoverOpen}>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  disabled={isPending('labels') || repoLabels.loading}
                  aria-label={translate(
                    'auto.components.GitHubItemDialog.4ba0132f37',
                    'Edit labels'
                  )}
                  className="rounded p-0.5 text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {isPending('labels') ? (
                    <LoaderCircle className="size-3 animate-spin" />
                  ) : (
                    <Pencil className="size-3" />
                  )}
                </button>
              </PopoverTrigger>
              <PopoverContent
                className="popover-scroll-content scrollbar-sleek w-60 p-1"
                align="end"
              >
                {repoLabels.error ? (
                  <div className="px-2 py-3 text-center text-[12px] text-destructive">
                    {repoLabels.error}
                  </div>
                ) : null}
                {!repoLabels.error ? (
                  <div>
                    {repoLabels.data.map((label) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => handleLabelToggle(label)}
                        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent"
                      >
                        <span
                          className={cn(
                            'flex size-3.5 items-center justify-center rounded-sm border',
                            localLabels.includes(label)
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-input'
                          )}
                        >
                          {localLabels.includes(label) && checkIcon}
                        </span>
                        {label}
                      </button>
                    ))}
                  </div>
                ) : null}
                <GitHubLabelsSettingsLink
                  url={repositoryLabelsUrl}
                  separated={!repoLabels.error && repoLabels.data.length > 0}
                  onOpen={() => setLabelPopoverOpen(false)}
                />
              </PopoverContent>
            </Popover>
          </div>
          {localLabels.length === 0 ? (
            <div className="text-[12px] text-muted-foreground">
              {translate('auto.components.GitHubItemDialog.886a64b081', 'None yet')}
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {localLabels.map((name) => (
                <span
                  key={name}
                  className="inline-flex items-center rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground"
                >
                  {name}
                </span>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0">
          {/* Why: property columns are metadata only; the primary open/start CTA lives solely in the issue header. */}
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-foreground">
            {translate('auto.components.GitHubItemDialog.2e4d806c92', 'Workspace')}
          </div>
          {attachedWorkspaceLabel ? (
            <div className="flex min-w-0 items-center gap-1.5 text-[12px] text-muted-foreground">
              <FolderKanban className="size-3.5 shrink-0" />
              <span className="truncate">{attachedWorkspaceLabel}</span>
            </div>
          ) : (
            <div className="text-[12px] text-muted-foreground">
              {translate('auto.components.GitHubItemDialog.886a64b081', 'None yet')}
            </div>
          )}
        </section>
      </aside>
  )
}

export function GitHubItemEditToolbar({
  item,
  localState,
  localLabels,
  localAssignees,
  attachedWorkspaceLabel,
  hasAttachedWorkspace,
  isPending,
  repoLabels,
  repoAssignees,
  repositoryLabelsUrl,
  labelPopoverOpen,
  assigneePopoverOpen,
  setLabelPopoverOpen,
  setAssigneePopoverOpen,
  handleLabelToggle,
  handleAssigneeToggle,
  handleOpenOrUseWorkspace,
  onUse,
  renderIssueStatusPopover
}: GitHubItemEditLayoutProps): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/60 px-4 py-2.5">
      {/* State */}
      {renderIssueStatusPopover('pill')}

      {/* Labels */}
      <Popover open={labelPopoverOpen} onOpenChange={setLabelPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isPending('labels') || repoLabels.loading}
            className="group/labels inline-flex items-center gap-1 rounded-full border border-border/30 bg-muted/20 px-2 py-0.5 text-[11px] transition hover:brightness-125 hover:ring-1 hover:ring-white/10 disabled:opacity-50"
          >
            {localLabels.length === 0 ? (
              <span className="text-muted-foreground">
                {translate('auto.components.GitHubItemDialog.f41ec96c13', '+ Label')}
              </span>
            ) : (
              localLabels.map((name) => (
                <span key={name} className="text-[10px] text-muted-foreground">
                  {name}
                </span>
              ))
            )}
            {isPending('labels') ? (
              <LoaderCircle className="size-3 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDown className="size-2.5 opacity-50" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="popover-scroll-content scrollbar-sleek w-52 p-1" align="start">
          {repoLabels.error ? (
            <div className="px-2 py-3 text-center text-[12px] text-destructive">
              {repoLabels.error}
            </div>
          ) : null}
          {!repoLabels.error ? (
            <div>
              {repoLabels.data.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => handleLabelToggle(label)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent"
                >
                  <span
                    className={cn(
                      'flex size-3.5 items-center justify-center rounded-sm border',
                      localLabels.includes(label)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input'
                    )}
                  >
                    {localLabels.includes(label) && checkIcon}
                  </span>
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          <GitHubLabelsSettingsLink
            url={repositoryLabelsUrl}
            separated={!repoLabels.error && repoLabels.data.length > 0}
            onOpen={() => setLabelPopoverOpen(false)}
          />
        </PopoverContent>
      </Popover>

      {/* Assignees */}
      <Popover open={assigneePopoverOpen} onOpenChange={setAssigneePopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={isPending('assignees') || repoAssignees.loading}
            className="group/assignees inline-flex items-center gap-1 rounded-full border border-border/30 bg-muted/20 px-2 py-0.5 text-[11px] transition hover:brightness-125 hover:ring-1 hover:ring-white/10 disabled:opacity-50"
          >
            {localAssignees.length === 0 ? (
              <span className="text-muted-foreground">
                {translate('auto.components.GitHubItemDialog.c6f37a563d', '+ Assignee')}
              </span>
            ) : (
              localAssignees.map((login) => (
                <span key={login} className="text-[10px] text-muted-foreground">
                  {login}
                </span>
              ))
            )}
            {isPending('assignees') ? (
              <LoaderCircle className="size-3 animate-spin text-muted-foreground" />
            ) : (
              <ChevronDown className="size-2.5 opacity-50" />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent className="popover-scroll-content scrollbar-sleek w-52 p-1" align="start">
          {repoAssignees.error ? (
            <div className="px-2 py-3 text-center text-[12px] text-destructive">
              {repoAssignees.error}
            </div>
          ) : (
            <div>
              {repoAssignees.data.map((user) => (
                <button
                  key={user.login}
                  type="button"
                  onClick={() => handleAssigneeToggle(user.login)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[12px] hover:bg-accent"
                >
                  <span
                    className={cn(
                      'flex size-3.5 items-center justify-center rounded-sm border',
                      localAssignees.includes(user.login)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input'
                    )}
                  >
                    {localAssignees.includes(user.login) && checkIcon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{user.login}</span>
                    {user.name && (
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {user.name}
                      </span>
                    )}
                  </span>
                </button>
              ))}
            </div>
          )}
        </PopoverContent>
      </Popover>

      <div className="ml-auto flex min-w-0 items-center gap-2">
        {attachedWorkspaceLabel ? (
          <span className="inline-flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
            <FolderKanban className="size-3 shrink-0" />
            <span className="truncate">{attachedWorkspaceLabel}</span>
          </span>
        ) : null}
        {hasAttachedWorkspace ? (
          <DropdownMenu modal={false}>
            <ButtonGroup>
              <Button
                type="button"
                size="sm"
                onClick={handleOpenOrUseWorkspace}
                className="gap-2"
                aria-label={translate(
                  'auto.components.GitHubItemDialog.84855fedd0',
                  'Open workspace attached to issue'
                )}
              >
                {translate('auto.components.GitHubItemDialog.726db41722', 'Open workspace')}
                <ArrowRight className="size-4" />
              </Button>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  size="icon-sm"
                  aria-label={translate(
                    'auto.components.GitHubItemDialog.fe6ff12dc2',
                    'More issue workspace actions'
                  )}
                >
                  <ChevronDown className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
            </ButtonGroup>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => onUse(item)}>
                <Plus className="size-4" />
                {translate('auto.components.GitHubItemDialog.36182aa57f', 'Start new workspace')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button
            type="button"
            size="sm"
            onClick={() => onUse(item)}
            className="gap-2"
            aria-label={translate(
              'auto.components.GitHubItemDialog.0ab4664a8b',
              'Start workspace from issue'
            )}
          >
            {translate('auto.components.GitHubItemDialog.0ab4664a8b', 'Start workspace from issue')}
            <ArrowRight className="size-4" />
          </Button>
        )}
      </div>
    </div>
  )
}
