import React from 'react'
import { AlertCircle, Check, Loader2 } from 'lucide-react'
import { Button } from './ui/button'
import { translate } from '@/i18n/i18n'

export function UpdateCardCompactContent({
  icon,
  text,
  onClose,
  action
}: {
  icon: 'spinner' | 'check' | 'error'
  text: string
  onClose?: () => void
  action?: { label: string; url: string }
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 p-3">
      <div className="shrink-0 text-muted-foreground">
        {icon === 'spinner' && <Loader2 className="size-4 animate-spin" />}
        {icon === 'check' && <Check className="size-4" />}
        {icon === 'error' && <AlertCircle className="size-4" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{text}</p>
        {action && (
          <button
            className="mt-0.5 text-xs text-muted-foreground underline hover:text-foreground"
            onClick={() => void window.api.shell.openUrl(action.url)}
          >
            {action.label}
          </button>
        )}
      </div>
      {onClose && (
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={onClose}
          aria-label={translate('auto.components.UpdateCard.a726967bd3', 'Dismiss')}
        >
          <span aria-hidden="true">×</span>
        </Button>
      )}
    </div>
  )
}
