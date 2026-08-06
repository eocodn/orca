import React from 'react'
import { AlertTriangle, LoaderCircle, MemoryStick, Terminal } from 'lucide-react'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { AppState } from '../../store'
import { DaemonActionDialog } from '../shared/useDaemonActions'
import type { ResourceUsageStatusContentProps } from './resource-usage-status-content'
import { ResourceUsageStatusContent } from './resource-usage-status-content'
import type { UnifiedSessionRow } from './resource-usage-merge-types'
import { STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS } from './status-bar-context-menu-policy'
import { translate } from '@/i18n/i18n'

export type ResourceUsageStatusViewProps = ResourceUsageStatusContentProps & {
  open: boolean
  setOpen: React.Dispatch<React.SetStateAction<boolean>>
  recordFeatureInteraction: AppState['recordFeatureInteraction']
  iconOnly: boolean
  memBadgeLabel: string
  triggerSessionCount: number
  resourceManagerTooltipLines: string[]
  killConfirm: UnifiedSessionRow | null
  killing: boolean
  setKillConfirm: React.Dispatch<React.SetStateAction<UnifiedSessionRow | null>>
  runKillConfirmed: () => Promise<void>
}

export function ResourceUsageStatusView({
  open,
  setOpen,
  recordFeatureInteraction,
  daemonUnreachable,
  resourceManagerAriaLabel,
  spaceScanReady,
  iconOnly,
  memBadgeLabel,
  triggerSessionCount,
  orphanCount,
  resourceManagerTooltipLines,
  daemonActions,
  killConfirm,
  killing,
  setKillConfirm,
  runKillConfirmed,
  ...contentProps
}: ResourceUsageStatusViewProps): React.JSX.Element {
  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          recordFeatureInteraction('resource-manager')
        }
        setOpen(nextOpen)
      }}
    >
      <Tooltip delayDuration={150}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              {...STATUS_BAR_CONTEXT_MENU_EXEMPT_PROPS}
              className="relative inline-flex cursor-pointer items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent/70"
              aria-label={
                daemonUnreachable
                  ? translate(
                      'auto.components.status.bar.ResourceUsageStatusSegment.59f178fe11',
                      '{{value0}}, daemon unreachable',
                      { value0: resourceManagerAriaLabel }
                    )
                  : resourceManagerAriaLabel
              }
            >
              {spaceScanReady ? (
                <span
                  className="absolute -right-0.5 -top-0.5 size-1.5 rounded-full bg-primary"
                  aria-hidden="true"
                />
              ) : null}
              <MemoryStick className="size-3 text-muted-foreground" />
              {!iconOnly && (
                <>
                  <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
                    {memBadgeLabel}
                  </span>
                  <span className="text-muted-foreground/50">·</span>
                  <Terminal className="size-3 text-muted-foreground" />
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {triggerSessionCount}
                    {orphanCount > 0 && (
                      <span className="ml-0.5 text-yellow-500">({orphanCount})</span>
                    )}
                  </span>
                </>
              )}
              {iconOnly && triggerSessionCount > 0 && (
                <span className="text-[11px] tabular-nums text-muted-foreground">
                  {triggerSessionCount}
                </span>
              )}
              {daemonUnreachable && (
                <AlertTriangle
                  className="size-3 text-yellow-500"
                  aria-label={translate(
                    'auto.components.status.bar.ResourceUsageStatusSegment.ca95d077db',
                    'Daemon unreachable'
                  )}
                />
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          <div className="space-y-0.5">
            {resourceManagerTooltipLines.map((line, index) => (
              <div
                key={`${index}:${line}`}
                className={line === 'Space scan ready' ? 'text-primary' : ''}
              >
                {line}
              </div>
            ))}
          </div>
        </TooltipContent>
      </Tooltip>
      <ResourceUsageStatusContent
        {...contentProps}
        daemonUnreachable={daemonUnreachable}
        resourceManagerAriaLabel={resourceManagerAriaLabel}
        spaceScanReady={spaceScanReady}
        orphanCount={orphanCount}
      />
      <Dialog
        open={killConfirm !== null}
        onOpenChange={(next) => {
          if (!next && !killing) {
            setKillConfirm(null)
          }
        }}
      >
        <DialogContent
          className="max-w-md"
          showCloseButton={!killing}
          onPointerDownOutside={(event) => {
            if (killing) {
              event.preventDefault()
            }
          }}
          onEscapeKeyDown={(event) => {
            if (killing) {
              event.preventDefault()
            }
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-sm">
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.e9a5d3c2b1f0',
                'Kill {{value0}}?',
                {
                  value0:
                    killConfirm?.label ??
                    translate(
                      'auto.components.status.bar.ResourceUsageStatusSegment.138b99bd80',
                      'this session'
                    )
                }
              )}
            </DialogTitle>
            <DialogDescription className="text-xs">
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.67c4ecda49',
                "Force-quits this terminal. Any unsaved work in the pane is lost. This can't be undone."
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKillConfirm(null)} disabled={killing}>
              {translate(
                'auto.components.status.bar.ResourceUsageStatusSegment.946d9f94d0',
                'Cancel'
              )}
            </Button>
            <Button
              variant="destructive"
              onClick={() => void runKillConfirmed()}
              disabled={killing}
            >
              {killing ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {killing
                ? translate(
                    'auto.components.status.bar.ResourceUsageStatusSegment.41ae4fa725',
                    'Killing…'
                  )
                : translate(
                    'auto.components.status.bar.ResourceUsageStatusSegment.b10695d6ce',
                    'Kill session'
                  )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DaemonActionDialog api={daemonActions} />
    </Popover>
  )
}
