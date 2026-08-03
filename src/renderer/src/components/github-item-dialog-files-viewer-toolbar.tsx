import type { Dispatch, SetStateAction } from 'react'
import { PanelLeftOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'

export function PRFilesCombinedDiffViewerToolbar({
  viewedFileCount,
  fileCount,
  fileTreeCollapsed,
  onFileTreeCollapsedChange,
  allSectionsCollapsed,
  onAllSectionsCollapsedChange,
  sideBySide,
  onSideBySideChange
}: {
  viewedFileCount: number
  fileCount: number
  fileTreeCollapsed: boolean
  onFileTreeCollapsedChange: (collapsed: boolean) => void
  allSectionsCollapsed: boolean
  onAllSectionsCollapsedChange: (collapsed: boolean) => void
  sideBySide: boolean
  onSideBySideChange: Dispatch<SetStateAction<boolean>>
}): React.JSX.Element {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border bg-background/50 px-3 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        {fileTreeCollapsed && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={translate(
                  'auto.components.GitHubItemDialog.1257d1435d',
                  'Show file tree'
                )}
                onClick={() => onFileTreeCollapsedChange(false)}
              >
                <PanelLeftOpen className="size-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {translate('auto.components.GitHubItemDialog.1257d1435d', 'Show file tree')}
            </TooltipContent>
          </Tooltip>
        )}
        <span className="truncate text-xs text-muted-foreground">
          {viewedFileCount} / {fileCount}{' '}
          {translate('auto.components.GitHubItemDialog.f2d02cdf8c', 'files viewed')}
        </span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          className="w-20 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => onAllSectionsCollapsedChange(!allSectionsCollapsed)}
        >
          {allSectionsCollapsed
            ? translate('auto.components.GitHubItemDialog.3c19ec3069', 'Expand All')
            : translate('auto.components.GitHubItemDialog.d00a0a7f8f', 'Collapse All')}
        </button>
        <button
          type="button"
          className="w-24 rounded border border-border px-2 py-0.5 text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => onSideBySideChange((prev) => !prev)}
        >
          {sideBySide
            ? translate('auto.components.GitHubItemDialog.6e43a16435', 'Inline')
            : translate('auto.components.GitHubItemDialog.31770bef03', 'Side by Side')}
        </button>
      </div>
    </div>
  )
}
