import React from 'react'
import { Button } from '@/components/ui/button'
import { LoaderCircle, RefreshCw, X, Send, ExternalLink } from 'lucide-react'
import { isScreenSubmitShortcut } from '@/lib/screen-submit-shortcut'
import { translate } from '@/i18n/i18n'

type GitLabItemDialogViewContext = Record<string, any>

export function GitLabItemDialogFooter({ context }: { context: GitLabItemDialogViewContext }): React.JSX.Element {
  const {
    actionInFlight,
    canClose,
    canMerge,
    canReopen,
    canSubmitComment,
    commentDraft,
    commentSubmitting,
    handleClose,
    handleMerge,
    handleReopen,
    handleSubmitComment,
    item,
    onCreateWorkspace,
    prefix,
    updateCommentDraft,
  } = context
  return (
            <footer className="flex-none space-y-3 border-t border-border/40 px-5 py-3">
              {/* Why: comment composer at the top of the footer so the
                  primary actions row stays visually grouped at the bottom. */}
              <div className="flex items-end gap-2">
                <textarea
                  value={commentDraft}
                  onChange={(e) => updateCommentDraft(e.target.value)}
                  placeholder={translate(
                    'auto.components.GitLabItemDialog.c08e1d5a57',
                    'Comment on {{value0}}{{value1}}…',
                    { value0: prefix, value1: item.number }
                  )}
                  rows={2}
                  disabled={commentSubmitting}
                  className="min-h-9 w-full resize-none rounded-md border border-input bg-transparent px-2.5 py-1.5 text-sm shadow-xs focus:border-ring focus:outline-none focus:ring-[3px] focus:ring-ring/50"
                  onKeyDown={(e) => {
                    // Why: this is local textarea submit behavior; Settings
                    // keybindings only cover app commands.
                    if (isScreenSubmitShortcut(e) && canSubmitComment && !commentSubmitting) {
                      e.preventDefault()
                      void handleSubmitComment()
                    }
                  }}
                />
                <Button
                  size="sm"
                  disabled={!canSubmitComment || commentSubmitting}
                  onClick={() => void handleSubmitComment()}
                  className="shrink-0 gap-1.5"
                >
                  {commentSubmitting ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                  {translate('auto.components.GitLabItemDialog.84012fa8fb', 'Comment')}
                </Button>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void window.api.shell.openUrl(item.url)}
                  className="gap-1.5"
                >
                  <ExternalLink className="size-3.5" />
                  {translate('auto.components.GitLabItemDialog.f2e64d1c20', 'Open in GitLab')}
                </Button>
                <div className="flex items-center gap-2">
                  {onCreateWorkspace ? (
                    <Button variant="outline" size="sm" onClick={() => onCreateWorkspace(item)}>
                      {translate('auto.components.GitLabItemDialog.131865e231', 'Create workspace')}
                    </Button>
                  ) : null}
                  {canMerge ? (
                    <Button
                      size="sm"
                      disabled={actionInFlight !== null}
                      onClick={() => void handleMerge()}
                    >
                      {actionInFlight === 'merge' ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : null}
                      {translate('auto.components.GitLabItemDialog.16b3412570', 'Merge')}
                    </Button>
                  ) : null}
                  {canClose ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionInFlight !== null}
                      onClick={() => void handleClose()}
                    >
                      {actionInFlight === 'close' ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : null}
                      {translate('auto.components.GitLabItemDialog.a199eb364b', 'Close')}
                    </Button>
                  ) : null}
                  {canReopen ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={actionInFlight !== null}
                      onClick={() => void handleReopen()}
                    >
                      {actionInFlight === 'reopen' ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : null}
                      {translate('auto.components.GitLabItemDialog.65e784c1f1', 'Reopen')}
                    </Button>
                  ) : null}
                </div>
              </div>
            </footer>
  )
}
