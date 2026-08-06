import React from 'react'
import {
  ChecksList,
  ConflictingFilesSection,
  MergeConflictNotice,
  PRTriageStrip
} from './checks-panel-content'
import type { PRCheckDetail, PRCheckRunDetails } from '../../../../shared/types'
import type { ChecksPanelReview } from './checks-panel-review'

export type ChecksPanelChecksSectionProps = {
  review: ChecksPanelReview
  conflictReview: ChecksPanelReview | null
  checks: PRCheckDetail[]
  checksLoading: boolean
  contextKey: string
  conflictDetailsRefreshing: boolean
  showTriage: boolean
  aiVisible: boolean
  resolvingConflicts: boolean
  fixingChecks: boolean
  aiDisabledReason: string | null
  onResolveConflicts: () => void
  onFixChecks: () => void
  onLoadCheckDetails: (check: PRCheckDetail) => Promise<PRCheckRunDetails | null>
}

export function ChecksPanelChecksSection({
  review,
  conflictReview,
  checks,
  checksLoading,
  contextKey,
  conflictDetailsRefreshing,
  showTriage,
  aiVisible,
  resolvingConflicts,
  fixingChecks,
  aiDisabledReason,
  onResolveConflicts,
  onFixChecks,
  onLoadCheckDetails
}: ChecksPanelChecksSectionProps): React.JSX.Element {
  return (
    <>
      {showTriage && aiVisible && (
        <PRTriageStrip
          review={conflictReview ?? review}
          reviewKind={review.provider === 'gitlab' ? 'MR' : 'PR'}
          checks={checks}
          isResolvingConflictsWithAI={resolvingConflicts}
          onResolveConflictsWithAI={onResolveConflicts}
          resolveConflictsDisabled={Boolean(aiDisabledReason)}
          resolveConflictsDisabledReason={aiDisabledReason}
          isFixingChecksWithAI={fixingChecks}
          onFixChecksWithAI={onFixChecks}
          fixChecksDisabled={Boolean(aiDisabledReason)}
          fixChecksDisabledReason={aiDisabledReason}
        />
      )}
      {conflictReview && (
        <>
          <ConflictingFilesSection pr={conflictReview} />
          <MergeConflictNotice
            pr={conflictReview}
            isRefreshingConflictDetails={conflictDetailsRefreshing}
          />
        </>
      )}
      {!(conflictReview && checks.length === 0 && !checksLoading) && (
        <ChecksList
          checks={checks}
          checksLoading={checksLoading}
          checkDetailsContextKey={contextKey}
          onLoadCheckDetails={onLoadCheckDetails}
        />
      )}
    </>
  )
}
