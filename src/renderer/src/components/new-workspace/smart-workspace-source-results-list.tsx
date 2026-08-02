import React from 'react'
import { Button } from '@/components/ui/button'
import { CommandGroup, CommandItem, CommandList } from '@/components/ui/command'
import { translate } from '@/i18n/i18n'
import { RowIcon, RowLabel } from './smart-workspace-name-field-presentation'
import type { RowEntry } from './smart-workspace-name-field-source-render'

const ROW_ITEM_CLASS_NAME = 'gap-2 px-3 py-2 text-xs'

function isTypedTextSourceRow(row: RowEntry): boolean {
  return row.kind === 'use-name' || row.kind === 'create-branch'
}

function rowClassName(row: RowEntry, pinnedAction = false): string {
  return `${ROW_ITEM_CLASS_NAME}${pinnedAction && isTypedTextSourceRow(row) ? ' bg-muted/35' : ''}`
}

export function SmartWorkspaceSourceResultsList({ context }: { context: Record<string, any> }): React.JSX.Element {
  const {
    handleSelect,
    jiraConnectionStatus,
    jiraSource,
    linearStatus,
    linearStatusChecked,
    loading,
    mode,
    mrStateFilter,
    mrStateFilters,
    searchResultRows,
    showJiraSiteContext,
    typedTextActionRow
  } = context
  return (
    <>
      {mode === 'gitlab' ? (
        <div className="flex shrink-0 items-center gap-1 border-b border-border/40 px-2 py-1.5" onMouseDown={(event) => event.preventDefault()}>
          {mrStateFilters.map(({ id, label }: any) => (
            <Button key={id} type="button" variant={mrStateFilter === id ? 'secondary' : 'ghost'} size="sm" onClick={() => context.setMrStateFilter(id)} className="h-6 px-2 text-xs">
              {label}
            </Button>
          ))}
        </div>
      ) : null}
      <CommandList className="!max-h-none min-h-0 flex-1 scrollbar-sleek">
        {typedTextActionRow ? (
          <div className="sticky top-0 z-10 border-b border-border/40 bg-popover p-1" onMouseDown={(event) => event.preventDefault()}>
            <CommandItem value={typedTextActionRow.value} onSelect={() => handleSelect(typedTextActionRow)} className={rowClassName(typedTextActionRow, true)}>
              <RowIcon row={typedTextActionRow} />
              <RowLabel row={typedTextActionRow} />
            </CommandItem>
          </div>
        ) : null}
        {jiraSource.errorKind ? null : loading && searchResultRows.length === 0 ? (
          <div className="space-y-1 p-1">{[0, 1, 2].map((index) => <div key={index} className="h-8 animate-pulse rounded bg-muted/40" />)}</div>
        ) : searchResultRows.length === 0 && !typedTextActionRow ? (
          <div className="px-3 py-6 text-center text-xs text-muted-foreground">
            {jiraSource.intent ? null : mode === 'linear' && linearStatusChecked && !linearStatus.connected
              ? translate('auto.components.new.workspace.SmartWorkspaceNameField.3e8bb1176a', 'Connect Linear in Settings to search issues.')
              : context.getSmartWorkspaceEmptyHint(mode)}
          </div>
        ) : searchResultRows.length > 0 ? (
          <CommandGroup className="p-1">
            {searchResultRows.map((row: any) => (
              <CommandItem key={row.value} value={row.value} onSelect={() => handleSelect(row)} className={rowClassName(row)}>
                <RowIcon row={row} />
                <RowLabel
                  row={row}
                  jiraSite={showJiraSiteContext && row.kind === 'jira' ? (jiraConnectionStatus?.sites?.find((site: any) => site.id === row.issue.siteId) ?? null) : null}
                  showJiraSiteContext={showJiraSiteContext}
                />
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
    </>
  )
}
