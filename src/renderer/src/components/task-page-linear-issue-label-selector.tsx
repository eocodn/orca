import type React from 'react'
import { Check, ChevronDown, LoaderCircle, Tag } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { translate } from '@/i18n/i18n'
import type { LinearLabel } from '../../../shared/types'
import type { MetadataState } from '@/hooks/issue-metadata-state'
type Setter<T> = React.Dispatch<React.SetStateAction<T>>

export type TaskPageLinearIssueLabelSelectorProps = {
  newLinearIssueSubmitting: boolean
  newLinearLabels: MetadataState<LinearLabel[]>
  newLinearIssueLabelIds: string[]
  setNewLinearIssueLabelIds: Setter<string[]>
}

export function TaskPageLinearIssueLabelSelector({
  newLinearIssueSubmitting,
  newLinearLabels,
  newLinearIssueLabelIds,
  setNewLinearIssueLabelIds
}: TaskPageLinearIssueLabelSelectorProps): React.JSX.Element {
  return (
    <>
      {/* Labels Selector */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={newLinearIssueSubmitting}
            className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs border border-border/80 bg-muted/15 hover:bg-muted/50 active:bg-muted transition-colors text-foreground/80 cursor-pointer disabled:opacity-50"
          >
            <Tag className="size-3.5 text-muted-foreground/70" />
            <span>
              {newLinearIssueLabelIds.length === 0
                ? translate('auto.components.TaskPage.d0ca4aa1d0', 'Labels')
                : translate('auto.components.TaskPage.eff9800d4b', '{{value0}} label{{value1}}', {
                    value0: newLinearIssueLabelIds.length,
                    value1: newLinearIssueLabelIds.length > 1 ? 's' : ''
                  })}
            </span>
            <ChevronDown className="size-3 text-muted-foreground/70" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-64 p-1">
          <div className="text-[10px] font-semibold text-muted-foreground px-2 py-1 uppercase tracking-wider">
            {translate('auto.components.TaskPage.d0ca4aa1d0', 'Labels')}
          </div>
          {newLinearLabels.loading ? (
            <div className="flex items-center justify-center p-4">
              <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="max-h-60 overflow-y-auto scrollbar-sleek">
              {newLinearLabels.data.map((l) => {
                const isSelected = newLinearIssueLabelIds.includes(l.id)
                return (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      if (isSelected) {
                        setNewLinearIssueLabelIds(
                          newLinearIssueLabelIds.filter((id) => id !== l.id)
                        )
                      } else {
                        setNewLinearIssueLabelIds([...newLinearIssueLabelIds, l.id])
                      }
                    }}
                    className={`w-full flex items-center justify-between text-left px-2 py-1.5 text-xs rounded-sm hover:bg-muted transition-colors ${
                      isSelected ? 'bg-muted font-medium text-foreground' : 'text-foreground/80'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="size-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: l.color || '#a3a3a3' }}
                      />
                      <span>{l.name}</span>
                    </div>
                    {isSelected && <Check className="size-3 text-foreground" />}
                  </button>
                )
              })}
            </div>
          )}
        </PopoverContent>
      </Popover>
    </>
  )
}
