/* Render-only checks panel surface. */
import React from 'react'
import type { ChecksPanelRenderContext } from './checks-panel-runtime-render-types'
import { renderChecksPanelEmpty } from './checks-panel-runtime-empty'
import { renderChecksPanelReview } from './checks-panel-runtime-review'

export function renderChecksPanel<T extends Record<string, unknown>>(context: ChecksPanelRenderContext<T>): React.JSX.Element {
  const { activeWorktree, isFolder, activeReview } = context
  if (!activeWorktree || isFolder || !activeReview) {
    return renderChecksPanelEmpty(context)
  }
  return renderChecksPanelReview(context)
}
