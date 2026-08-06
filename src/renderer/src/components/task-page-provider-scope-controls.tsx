import type { ComponentProps } from 'react'
import { AlertCircle, ExternalLink } from 'lucide-react'

import { LinearScopeSelector } from '@/components/linear-scope-selector'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

type TaskPageProviderScopeControlsProps = {
  showLinearScope: boolean
  linearScopeProps: ComponentProps<typeof LinearScopeSelector>
  selectedLinearTeamForExternalLink: { name: string; url: string } | null
  showJiraSiteSelector: boolean
  jiraSites: readonly { id: string; displayName: string }[]
  selectedJiraSiteId: string | null
  onJiraSiteChange: (siteId: string) => void
  taskSourceAvailabilityNotice: { title: string; label: string } | null
}

export function TaskPageProviderScopeControls({
  showLinearScope,
  linearScopeProps,
  selectedLinearTeamForExternalLink,
  showJiraSiteSelector,
  jiraSites,
  selectedJiraSiteId,
  onJiraSiteChange,
  taskSourceAvailabilityNotice
}: TaskPageProviderScopeControlsProps): React.JSX.Element {
  return (
    <>
      {showLinearScope ? (
        <div className="flex items-center gap-2">
          <LinearScopeSelector {...linearScopeProps} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => {
                  if (selectedLinearTeamForExternalLink?.url) {
                    void window.api.shell.openUrl(selectedLinearTeamForExternalLink.url)
                  }
                }}
                disabled={!selectedLinearTeamForExternalLink}
                aria-label={
                  selectedLinearTeamForExternalLink
                    ? translate(
                        'auto.components.TaskPage.246bd64aed',
                        'Open {{value0}} in Linear',
                        {
                          value0: selectedLinearTeamForExternalLink.name
                        }
                      )
                    : translate(
                        'auto.components.TaskPage.8029e2bd4d',
                        'Select one Linear team to open in Linear'
                      )
                }
                className="h-8 w-8 rounded-md border-border/50 bg-muted/50 text-foreground shadow-sm transition hover:bg-muted/50"
              >
                <ExternalLink className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {selectedLinearTeamForExternalLink
                ? translate('auto.components.TaskPage.246bd64aed', 'Open {{value0}} in Linear', {
                    value0: selectedLinearTeamForExternalLink.name
                  })
                : translate(
                    'auto.components.TaskPage.2af3ab5c58',
                    'Select one team to open in Linear'
                  )}
            </TooltipContent>
          </Tooltip>
        </div>
      ) : null}
      {showJiraSiteSelector ? (
        <div className="flex items-center gap-2">
          {jiraSites.length > 1 ? (
            <Select value={selectedJiraSiteId ?? undefined} onValueChange={onJiraSiteChange}>
              <SelectTrigger className="h-8 w-[220px] rounded-md border-border/50 bg-muted/50 text-xs font-medium shadow-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {translate('auto.components.TaskPage.e592d99051', 'All Jira sites')}
                </SelectItem>
                {jiraSites.map((site) => (
                  <SelectItem key={site.id} value={site.id}>
                    {site.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      ) : null}
      {taskSourceAvailabilityNotice ? (
        <div
          role="status"
          className="flex max-w-3xl items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
          title={taskSourceAvailabilityNotice.title}
        >
          <AlertCircle className="size-3.5 flex-none" />
          <span className="min-w-0 truncate">{taskSourceAvailabilityNotice.label}</span>
        </div>
      ) : null}
    </>
  )
}
