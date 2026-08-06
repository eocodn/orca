import React from 'react'
import { PRCommentsList } from './checks-panel-content'
import type { ComponentProps } from 'react'

export type ChecksPanelCommentsSectionProps = ComponentProps<typeof PRCommentsList>

export function ChecksPanelCommentsSection(
  props: ChecksPanelCommentsSectionProps
): React.JSX.Element {
  return <PRCommentsList {...props} />
}
