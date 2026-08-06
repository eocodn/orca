import React, { useCallback, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'

export function MergeabilityRecalculationCommandBox({
  commands
}: {
  commands: string
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const copiedResetTimerRef = useRef<number | null>(null)
  const isMountedRef = useRef(false)

  const clearCopiedResetTimer = useCallback((): void => {
    if (copiedResetTimerRef.current !== null) {
      window.clearTimeout(copiedResetTimerRef.current)
      copiedResetTimerRef.current = null
    }
  }, [])

  const setCopyButtonRef = useCallback(
    (node: HTMLButtonElement | null) => {
      isMountedRef.current = node !== null
      if (node === null) {
        clearCopiedResetTimer()
      }
    },
    [clearCopiedResetTimer]
  )

  const copyCommands = useCallback((): void => {
    void window.api.ui
      .writeClipboardText(commands)
      .then(() => {
        if (!isMountedRef.current) {
          return
        }
        clearCopiedResetTimer()
        setCopied(true)
        copiedResetTimerRef.current = window.setTimeout(() => {
          copiedResetTimerRef.current = null
          setCopied(false)
        }, 1500)
      })
      .catch(() => {
        /* best-effort */
      })
  }, [clearCopiedResetTimer, commands])

  return (
    <div className="mt-3 rounded-md border border-border bg-accent/20 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-medium text-muted-foreground">
          {translate(
            'auto.components.right.sidebar.checks.panel.content.5bc9bda2af',
            'Run from this worktree'
          )}
        </div>
        <Button
          ref={setCopyButtonRef}
          type="button"
          variant="outline"
          size="xs"
          onClick={copyCommands}
          aria-label={translate(
            'auto.components.right.sidebar.checks.panel.content.e87fb3d929',
            'Copy mergeability refresh commands'
          )}
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied
            ? translate('auto.components.right.sidebar.checks.panel.content.1e53e45072', 'Copied')
            : translate(
                'auto.components.right.sidebar.checks.panel.content.084c516efb',
                'Copy commands'
              )}
        </Button>
      </div>
      <pre className="scrollbar-sleek mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-all rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[10px] leading-4 text-foreground">
        {commands}
      </pre>
    </div>
  )
}
