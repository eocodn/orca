import type { ComponentType } from 'react'
import { ArrowDownUp, ChevronLeft, Eye, List, SlidersHorizontal } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { cn } from '@/lib/utils'
import type {
  LinearDisplayProperty,
  LinearGroupBy,
  LinearOrderBy,
  LinearViewMode
} from '@/components/task-page-localized-options'

type IconOption<Id extends string> = {
  id: Id
  label: string
  Icon: ComponentType<{ className?: string }>
}

type TaskPageLinearIssueHeaderProps = {
  activeLinearIssueContextLabel: string | null
  onBack: () => void
  linearViewOptions: readonly IconOption<LinearViewMode>[]
  linearViewMode: LinearViewMode
  onViewModeChange: (mode: LinearViewMode) => void
  linearGroupOptions: readonly { id: LinearGroupBy; label: string }[]
  linearGroupBy: LinearGroupBy
  onGroupByChange: (groupBy: LinearGroupBy) => void
  linearOrderOptions: readonly { id: LinearOrderBy; label: string }[]
  linearOrderBy: LinearOrderBy
  onOrderByChange: (orderBy: LinearOrderBy) => void
  linearDisplayPropertyOptions: readonly { id: LinearDisplayProperty; label: string }[]
  effectiveLinearDisplayProperties: ReadonlySet<LinearDisplayProperty>
  onToggleDisplayProperty: (property: LinearDisplayProperty) => void
  shownIssueCount: number
}

export function TaskPageLinearIssueHeader({
  activeLinearIssueContextLabel,
  onBack,
  linearViewOptions,
  linearViewMode,
  onViewModeChange,
  linearGroupOptions,
  linearGroupBy,
  onGroupByChange,
  linearOrderOptions,
  linearOrderBy,
  onOrderByChange,
  linearDisplayPropertyOptions,
  effectiveLinearDisplayProperties,
  onToggleDisplayProperty,
  shownIssueCount
}: TaskPageLinearIssueHeaderProps): React.JSX.Element {
  return (
    <div className="flex h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3">
      <div className="flex min-w-0 items-center gap-2">
        {activeLinearIssueContextLabel ? (
          <Button
            variant="ghost"
            size="icon-xs"
            onClick={onBack}
            aria-label={translate('auto.components.TaskPage.f397d513e3', 'Back')}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
        ) : null}
        <div className="min-w-0 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {activeLinearIssueContextLabel ??
            translate('auto.components.TaskPage.60f68a2ef4', 'Linear issues')}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <div
          className="hidden items-center rounded-md border border-border/50 bg-background/70 p-0.5 md:flex"
          aria-label={translate('auto.components.TaskPage.d47248df4d', 'Linear view mode')}
        >
          {linearViewOptions.map(({ id, label, Icon }) => {
            const active = linearViewMode === id
            return (
              <Tooltip key={id}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onViewModeChange(id)}
                    aria-label={translate(
                      'auto.components.TaskPage.af377b13b1',
                      '{{value0}} view',
                      { value0: label }
                    )}
                    aria-pressed={active}
                    className={cn(
                      'inline-flex size-6 items-center justify-center rounded text-muted-foreground transition hover:text-foreground',
                      active && 'bg-accent text-accent-foreground shadow-xs'
                    )}
                  >
                    <Icon className="size-3.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={6}>
                  {translate('auto.components.TaskPage.af377b13b1', '{{value0}} view', {
                    value0: label
                  })}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="xs"
              className="gap-1 border-border/50 bg-background/70 text-[11px]"
            >
              <SlidersHorizontal className="size-3.5" />
              {translate('auto.components.TaskPage.9c57663908', 'View')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="flex items-center gap-2">
              <List className="size-3.5" />
              {translate('auto.components.TaskPage.9c57663908', 'View')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={linearViewMode}
              onValueChange={(value) => onViewModeChange(value as LinearViewMode)}
            >
              {linearViewOptions.map(({ id, label, Icon }) => (
                <DropdownMenuRadioItem key={id} value={id}>
                  <Icon className="size-3.5" />
                  {label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2">
              <SlidersHorizontal className="size-3.5" />
              {translate('auto.components.TaskPage.5659da12fc', 'Grouping')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={linearGroupBy}
              onValueChange={(value) => onGroupByChange(value as LinearGroupBy)}
            >
              {linearGroupOptions.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2">
              <ArrowDownUp className="size-3.5" />
              {translate('auto.components.TaskPage.5d2d835467', 'Ordering')}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={linearOrderBy}
              onValueChange={(value) => onOrderByChange(value as LinearOrderBy)}
            >
              {linearOrderOptions.map((option) => (
                <DropdownMenuRadioItem key={option.id} value={option.id}>
                  {option.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="flex items-center gap-2">
              <Eye className="size-3.5" />
              {translate('auto.components.TaskPage.a26a48252e', 'Display properties')}
            </DropdownMenuLabel>
            {linearDisplayPropertyOptions.map((property) => (
              <DropdownMenuCheckboxItem
                key={property.id}
                checked={effectiveLinearDisplayProperties.has(property.id)}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={() => onToggleDisplayProperty(property.id)}
              >
                {property.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="text-[11px] text-muted-foreground">
          {shownIssueCount} {translate('auto.components.TaskPage.b7bae28b6a', 'shown')}
        </div>
      </div>
    </div>
  )
}
