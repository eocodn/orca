import React from 'react'
import { Command } from '@/components/ui/command'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { getSmartWorkspaceEmptyHint, type SmartNameMode, type SmartWorkspaceSourceRow } from './smart-workspace-source-results'
import { SmartWorkspaceSourceInput } from './smart-workspace-source-input'
import { SmartWorkspaceSourceOverlay } from './smart-workspace-source-overlay'
import { SmartWorkspaceSourceResultsList } from './smart-workspace-source-results-list'
import type { JiraSite } from '../../../../shared/types'

export type RowEntry = SmartWorkspaceSourceRow | { kind: 'jira-account'; value: string; site: JiraSite }

export function SmartWorkspaceNameFieldSourceRender({ context }: { context: Record<string, any> }): React.JSX.Element {
  const {
    availableModes,
    cancelLocalInputFocusFrame,
    disabled,
    handleSourcePopoverOpenChange,
    isQueryStale,
    localInputFocusFrameRef,
    localInputRef,
    markSourcePopoverUserEngaged,
    mode,
    onActiveSourceModeChange,
    open,
    selectedSource,
    setMode,
    setOpen,
    setCommandValue,
    tabsListRef,
    resolvedCommandValue
  } = context
  const searchResultRows = context.searchResultRows ?? context.rows ?? []
  const typedTextActionRow = context.typedTextActionRow ?? null
  const sourceContext = {
    ...context,
    getSmartWorkspaceEmptyHint: context.getSmartWorkspaceEmptyHint ?? getSmartWorkspaceEmptyHint,
    searchResultRows,
    typedTextActionRow
  }
  return (
    <div className="min-w-0 space-y-1.5">
      {context.textOnly ? null : (
        <div className="flex min-w-0 items-center gap-2 border-b border-border/40">
          <Tabs
            value={mode}
            onValueChange={(next) => {
              const nextMode = next as SmartNameMode
              onActiveSourceModeChange?.(nextMode)
              setMode(nextMode)
              if (!disabled && nextMode !== 'text' && selectedSource === null) {
                markSourcePopoverUserEngaged()
                setOpen(true)
              } else {
                setOpen(false)
              }
              cancelLocalInputFocusFrame()
              localInputFocusFrameRef.current = requestAnimationFrame(() => {
                localInputFocusFrameRef.current = null
                localInputRef.current?.focus({ preventScroll: true })
              })
            }}
            className="min-w-0 flex-1 gap-0"
          >
            <TabsList
              ref={tabsListRef}
              variant="line"
              className="h-7 w-full justify-start gap-4 overflow-x-auto overflow-y-hidden px-0 scrollbar-sleek"
              onFocusCapture={(event) => {
                const previous = event.relatedTarget as HTMLElement | null
                const list = tabsListRef.current
                const input = localInputRef.current
                if (!list || !input || (!previous || previous === input || list.contains(previous))) return
                event.stopPropagation()
                input.focus({ preventScroll: true })
              }}
            >
              {availableModes.map(({ id, label, Icon }: any) => (
                <TabsTrigger key={id} value={id} tabIndex={-1} data-smart-name-mode={id} className="flex-none gap-1.5 px-0 text-xs">
                  <Icon className="size-3.5" />
                  <span>{label}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}
      <Popover open={!disabled && open && mode !== 'text' && selectedSource === null} onOpenChange={handleSourcePopoverOpenChange}>
        <Command
          value={resolvedCommandValue}
          onValueChange={(next) => {
            if (!isQueryStale) setCommandValue(next)
          }}
          shouldFilter={false}
          className="overflow-visible bg-transparent"
        >
          <PopoverAnchor asChild>
            <div className="relative min-w-0">
              <SmartWorkspaceSourceInput context={sourceContext} />
            </div>
          </PopoverAnchor>
          <PopoverContent
            data-workspace-source-suggestions="true"
            align="start"
            side="bottom"
            sideOffset={4}
            avoidCollisions={false}
            className="popover-scroll-content flex w-[var(--radix-popover-trigger-width)] flex-col p-0"
            style={{ maxHeight: 'min(var(--radix-popover-content-available-height,7rem),7rem)' }}
            onOpenAutoFocus={(event) => event.preventDefault()}
            onPointerDownOutside={(event) => {
              const target = event.target as Node
              if (localInputRef.current?.contains(target) || tabsListRef.current?.contains(target)) event.preventDefault()
            }}
            onFocusOutside={(event) => {
              const target = event.target as Node
              if (localInputRef.current?.contains(target) || tabsListRef.current?.contains(target)) event.preventDefault()
            }}
          >
            <SmartWorkspaceSourceResultsList context={sourceContext} />
          </PopoverContent>
        </Command>
      </Popover>
      <SmartWorkspaceSourceOverlay context={sourceContext} />
    </div>
  )
}
