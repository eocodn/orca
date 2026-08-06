/* Render-only checks panel surface. */
import React from 'react'
import { renderChecksPanelEmpty } from './checks-panel-runtime-empty'
import { renderChecksPanelReview } from './checks-panel-runtime-review'

export function renderChecksPanel(context: Record<string, unknown>): React.JSX.Element {
  const { activeWorktree, isFolder, activeReview } = context
  if (!activeWorktree || isFolder || !activeReview) {
    return renderChecksPanelEmpty(context)
  }
  return renderChecksPanelReview(context)
}
