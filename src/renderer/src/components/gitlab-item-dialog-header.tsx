import React from 'react'
import { Button } from '@/components/ui/button'
import { SheetClose } from '@/components/ui/sheet'
import { LoaderCircle, RefreshCw, X, Send, ExternalLink } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { CommentCard, PipelineJobRow, StateBadge, parseGitLabLabelDraft } from './gitlab-item-dialog-content'

type GitLabItemDialogViewContext = Record<string, any>

export function GitLabItemDialogHeader({ context }: { context: GitLabItemDialogViewContext }): React.JSX.Element {
  const {
    Icon,
    handleRefresh,
    item,
    loading,
    prefix,
    visibleLabels,
    visibleTitle,
  } = context
  return (
            <header className="flex-none border-b border-border/40 px-5 py-4">
              <div className="flex items-start gap-3">
                <Icon className="mt-0.5 size-5 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono">
                      {prefix}
                      {item.number}
                    </span>
                    <StateBadge state={item.state} />
                    {item.author ? (
                      <span>
                        {translate('auto.components.GitLabItemDialog.9bfb4a24d7', 'by')}{' '}
                        {item.author}
                      </span>
                    ) : null}
                  </div>
                  <h2 className="mt-1.5 text-lg font-semibold leading-tight text-foreground">
                    {visibleTitle}
                  </h2>
                  {visibleLabels.length > 0 ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {visibleLabels.map((label) => (
                        <span
                          key={label}
                          className="rounded-full border border-border/50 bg-muted/40 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          {label}
                        </span>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={translate('auto.components.GitLabItemDialog.b3c156dd51', 'Refresh')}
                    disabled={loading}
                    onClick={handleRefresh}
                    className="size-7"
                  >
                    {loading ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <RefreshCw className="size-3.5" />
                    )}
                  </Button>
                  <SheetClose asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7"
                      aria-label={translate('auto.components.GitLabItemDialog.a199eb364b', 'Close')}
                    >
                      <X className="size-3.5" />
                    </Button>
                  </SheetClose>
                </div>
              </div>
            </header>
  )
}
