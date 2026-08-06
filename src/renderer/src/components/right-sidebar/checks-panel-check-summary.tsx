import React from 'react'
import { CircleCheck, CircleDashed, CircleX, ChevronDown, LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'

export function ChecksSummary({
  checksCount,
  checksExpanded,
  onToggle,
  passingCount,
  failingCount,
  pendingCount,
  neutralCount,
  checksLoading
}: {
  checksCount: number
  checksExpanded: boolean
  onToggle: () => void
  passingCount: number
  failingCount: number
  pendingCount: number
  neutralCount: number
  checksLoading: boolean
}): React.JSX.Element | null {
  if (checksCount === 0) {
    return null
  }
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left text-[10px] text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground"
      onClick={onToggle}
      aria-expanded={checksExpanded}
    >
      <ChevronDown
        className={cn('size-3 shrink-0 transition-transform', !checksExpanded && '-rotate-90')}
      />
      {passingCount > 0 && (
        <span className="flex items-center gap-1">
          <CircleCheck className="size-3 text-emerald-500" />
          {passingCount}{' '}
          {translate('auto.components.right.sidebar.checks.panel.content.02ca4f9074', 'passing')}
        </span>
      )}
      {failingCount > 0 && (
        <span className="flex items-center gap-1">
          <CircleX className="size-3 text-rose-500" />
          {failingCount}{' '}
          {translate('auto.components.right.sidebar.checks.panel.content.5e52f4ef7f', 'failing')}
        </span>
      )}
      {pendingCount > 0 && (
        <span className="flex items-center gap-1">
          <LoaderCircle className="size-3 text-amber-500" />
          {pendingCount}{' '}
          {translate('auto.components.right.sidebar.checks.panel.content.9ad98f2a17', 'pending')}
        </span>
      )}
      {/* Why: without this chip a list of only unresolved checks rendered a header with no
              counts at all, so nothing said why the pill was grey. */}
      {neutralCount > 0 && (
        <span className="flex items-center gap-1">
          <CircleDashed className="size-3 text-muted-foreground" />
          {neutralCount}{' '}
          {translate(
            'auto.components.right.sidebar.checks.panel.content.checksUnresolvedChip',
            'unresolved'
          )}
        </span>
      )}
      <span className="flex-1" />
      {checksLoading && <LoaderCircle className="size-3 animate-spin text-muted-foreground" />}
    </button>
  )
}
