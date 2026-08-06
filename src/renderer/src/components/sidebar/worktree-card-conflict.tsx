import React from 'react'
import { AlertTriangle } from 'lucide-react'
import { translate } from '@/i18n/i18n'

export function WorktreeCardConflict({
  remoteBranchConflict
}: {
  remoteBranchConflict?: { remote: string; branchName: string } | null
}): React.ReactElement | null {
  if (!remoteBranchConflict) {
    return null
  }
  return (
    <div className="mt-0.5 flex items-start gap-1.5 rounded border border-amber-500/25 bg-amber-500/5 px-1.5 py-1 text-[10.5px] leading-snug text-amber-700 dark:text-amber-300">
      <AlertTriangle className="mt-[1px] size-3 shrink-0" />
      <span className="min-w-0 flex-1">
        {translate(
          'auto.components.sidebar.WorktreeCard.a88c92d0e3',
          '{{value0}}/{{value1}} already exists.',
          {
            value0: remoteBranchConflict.remote,
            value1: remoteBranchConflict.branchName
          }
        )}
      </span>
    </div>
  )
}
